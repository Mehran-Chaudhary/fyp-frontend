import { markReachable, markUnreachable } from '@/lib/connectivity';
import { API_BASE_URL } from '@/lib/env';
import { createEmitter } from '@/lib/events';
import { ApiError, networkError, REFRESHABLE_401, toApiError } from './errors';
import { endSession, getAccessToken, peekAccessToken, refreshAccessToken } from './token-manager';
import type { ApiResult, ApiSuccess, Paginated, ResponseMeta } from './types';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  /**
   * Sets X-Organization-Id (spec §3.4). The server resolves the workspace from this
   * header, not the path, so use `workspacePath()` to build both from one value.
   */
  workspaceId?: string;
  /** Send the Bearer token. Default true. */
  auth?: boolean;
  /** Refresh and retry once on an expired/revoked token. Default true. */
  authRetry?: boolean;
  /** Let the global handler react (permission toasts, workspace gate). Default true. */
  globalErrors?: boolean;
  /**
   * Error codes the caller handles itself; the global handler ignores them. Some
   * codes mean "you lost access" on most calls but are an ordinary refusal on a
   * few: MFA_REQUIRED from "require two-step verification" (E30) refuses that
   * change, and MEMBERSHIP_SUSPENDED from an invitation (E46) is about the invitee.
   */
  localCodes?: readonly string[];
  signal?: AbortSignal;
  /** The server gives up at 30 s; wait slightly longer so its answer arrives (§3.7). */
  timeoutMs?: number;
}

/** Fired for every failed request (unless `globalErrors: false`). */
export const apiEvents = createEmitter<{
  error: { error: ApiError; options: RequestOptions; path: string };
}>();

const DEFAULT_TIMEOUT_MS = 35_000;

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `av-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

function metaFromHeaders(res: Response): ResponseMeta {
  return {
    requestId: res.headers.get('x-request-id') ?? '',
    timestamp: new Date().toISOString(),
  };
}

function report(error: ApiError, options: RequestOptions, path: string): ApiError {
  if (options.globalErrors !== false && !options.localCodes?.includes(error.code)) {
    apiEvents.emit('error', { error, options, path });
  }
  return error;
}

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : networkError();
}

type Parser<T> = (res: Response) => Promise<ApiResult<T>>;

const parseJson = async <T>(res: Response): Promise<ApiResult<T>> => {
  if (res.status === 204) return { data: null as T, meta: metaFromHeaders(res) };
  const json = (await res.json().catch(() => null)) as ApiSuccess<T> | null;
  if (json && typeof json === 'object' && 'data' in json) {
    return { data: json.data, meta: json.meta ?? metaFromHeaders(res) };
  }
  return { data: json as T, meta: metaFromHeaders(res) };
};

async function send<T>(path: string, options: RequestOptions, parse: Parser<T>, retried = false): Promise<ApiResult<T>> {
  const {
    method = 'GET',
    body,
    workspaceId,
    auth = true,
    authRetry = true,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Request-Id': newRequestId(),
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (workspaceId) headers['X-Organization-Id'] = workspaceId;

  let usedToken: string | null = null;
  if (auth) {
    try {
      usedToken = await getAccessToken();
    } catch (error) {
      // The refresh itself failed transiently (429 / 5xx / network).
      throw report(asApiError(error), options, path);
    }
    if (!usedToken) {
      throw new ApiError({ status: 401, code: 'AUTH_TOKEN_MISSING', message: 'Please sign in to continue.' });
    }
    headers.Authorization = `Bearer ${usedToken}`;
  }

  const timeout = AbortSignal.timeout(timeoutMs);
  let res: Response;
  try {
    res = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (cause) {
    if (signal?.aborted) throw cause; // the caller cancelled (e.g. a query unmounted)
    if (timeout.aborted) {
      throw report(
        new ApiError({ status: 408, code: 'REQUEST_TIMEOUT', message: 'The request took too long. Try again.' }),
        options,
        path,
      );
    }
    markUnreachable();
    throw report(networkError(), options, path);
  }

  if (res.ok) {
    markReachable();
    return parse(res);
  }

  const { error, isEnvelope } = await toApiError(res);
  if (!isEnvelope && res.status >= 500) markUnreachable();
  else markReachable();

  if (auth && authRetry && res.status === 401 && REFRESHABLE_401.has(error.code)) {
    if (!retried) {
      // Another request may already have refreshed while this one was in flight.
      const current = peekAccessToken();
      let next: string | null;
      if (current && current !== usedToken) {
        next = current;
      } else {
        try {
          next = await refreshAccessToken();
        } catch (refreshError) {
          throw report(asApiError(refreshError), options, path);
        }
      }
      if (next) return send(path, options, parse, true);
      // The refresh ended the session and announced why; nothing more to do here.
      throw error;
    }
    // A brand-new token was refused too: the session is gone.
    endSession(error.code);
    throw error;
  }

  throw report(error, options, path);
}

/** A JSON call. Resolves with `data` and `meta` of the envelope. */
export function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  return send<T>(path, options, parseJson);
}

/** A JSON call that returns only `data`. */
export async function call<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return (await request<T>(path, options)).data;
}

/** A paginated list: `data` is the array, pagination lives in `meta.pagination`. */
export async function callPaginated<T>(path: string, options: RequestOptions = {}): Promise<Paginated<T>> {
  const { data, meta } = await request<T[]>(path, options);
  const items = Array.isArray(data) ? data : [];
  return {
    items,
    pagination: meta.pagination ?? {
      page: 1,
      limit: items.length,
      totalItems: items.length,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false,
    },
  };
}

/**
 * A raw file download (E21 is not enveloped). Errors are still enveloped JSON, and
 * are thrown as ApiError like any other call.
 */
export async function download(
  path: string,
  options: RequestOptions = {},
): Promise<{ blob: Blob; filename: string | null }> {
  let filename: string | null = null;
  const { data } = await send<Blob>(path, options, async (res) => {
    const disposition = res.headers.get('content-disposition') ?? '';
    const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition);
    const plain = /filename="?([^";]+)"?/i.exec(disposition);
    filename = star ? decodeURIComponent(star[1].replace(/"/g, '')) : (plain?.[1] ?? null);
    return { data: await res.blob(), meta: metaFromHeaders(res) };
  });
  return { blob: data, filename };
}

/**
 * Builds a workspace-scoped path and its matching header from the same id, so the
 * two can never disagree (spec §3.4).
 */
export function workspacePath(workspaceId: string, subpath = ''): [string, { workspaceId: string }] {
  return [`/organizations/${encodeURIComponent(workspaceId)}${subpath}`, { workspaceId }];
}
