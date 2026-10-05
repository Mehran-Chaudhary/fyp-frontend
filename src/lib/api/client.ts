import { markReachable, markUnreachable } from '@/lib/connectivity';
import { API_BASE_URL } from '@/lib/env';
import { createEmitter } from '@/lib/events';
import { filenameFromDisposition } from './content-disposition';
import {
  ApiError,
  networkError,
  readJson,
  readRateLimit,
  REFRESHABLE_401,
  SESSION_ENDING_401,
  timeoutError,
  toApiError,
} from './errors';
import { currentSessionEpoch, endSession, getAccessToken, peekAccessToken, refreshAccessToken } from './token-manager';
import type { ApiResult, Paginated, ResponseMeta } from './types';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  /**
   * Sets X-Organization-Id. The header wins over the path on the server, so build
   * workspace calls with `workspacePath()`, which derives both from one value
   * (Phase 1 spec §5 "One context source"). Never set it globally.
   */
  workspaceId?: string;
  /** Send the Bearer token. Default true. Public calls never carry a stale token. */
  auth?: boolean;
  /**
   * Use this exact access token and never refresh (sign-out, which already holds
   * the auth lock and must not wait for it again).
   */
  bearer?: string;
  /** Refresh and replay once after an expired-token 401. Default true. */
  authRetry?: boolean;
  /** Let the global handler react (permission toasts, workspace gate). Default true. */
  globalErrors?: boolean;
  /**
   * Error codes the caller handles itself; the global handler ignores them. Some
   * codes mean "you lost access" on most calls but are an ordinary refusal on a
   * few: MFA_REQUIRED from "require two-step verification" refuses that change,
   * and MEMBERSHIP_SUSPENDED from an invitation is about the invitee.
   */
  localCodes?: readonly string[];
  /** Cancels the request (navigation, workspace switch). Never shown as an error. */
  signal?: AbortSignal;
  /** The server gives up at 30 s; wait slightly longer so its answer arrives. */
  timeoutMs?: number;
}

/** Fired for every failed request (unless `globalErrors: false`). */
export const apiEvents = createEmitter<{
  error: { error: ApiError; options: RequestOptions; path: string };
}>();

const DEFAULT_TIMEOUT_MS = 35_000;

/** A fresh correlation id for every HTTP attempt, replays included (spec §3). */
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

function unexpectedResponse(res: Response): ApiError {
  return new ApiError({
    status: res.status,
    code: 'UNEXPECTED_RESPONSE',
    message: "AgentVault's API sent an answer this app can't read. Check the API address it is configured with.",
    source: 'client',
  });
}

type Parser<T> = (res: Response) => Promise<ApiResult<T>>;

/** Success must be the API's JSON envelope; anything else (an HTML page) is an error. */
const parseJson = async <T>(res: Response): Promise<ApiResult<T>> => {
  const rateLimit = readRateLimit(res.headers);
  if (res.status === 204) return { data: null as T, meta: metaFromHeaders(res), rateLimit };
  const json = (await readJson(res)) as { success?: unknown; data?: T; meta?: ResponseMeta } | null;
  if (!json || typeof json !== 'object' || json.success !== true || !('data' in json)) {
    throw unexpectedResponse(res);
  }
  return { data: json.data as T, meta: json.meta ?? metaFromHeaders(res), rateLimit };
};

class SessionChangedError extends ApiError {
  constructor() {
    super({
      status: 0,
      code: 'SESSION_CHANGED',
      message: 'Your session changed while this request was waiting, so it was not sent again.',
      source: 'client',
    });
  }
}

async function send<T>(path: string, options: RequestOptions, parse: Parser<T>, retried = false): Promise<ApiResult<T>> {
  const {
    method = 'GET',
    body,
    workspaceId,
    auth = true,
    bearer,
    authRetry = true,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;
  // A replay belongs to the session it started in (spec §4 "Renewal and replay").
  const epoch = currentSessionEpoch();

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Request-Id': newRequestId(),
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (workspaceId) headers['X-Organization-Id'] = workspaceId;

  let usedToken: string | null = null;
  if (bearer) {
    usedToken = bearer;
  } else if (auth) {
    try {
      usedToken = await getAccessToken();
    } catch (error) {
      // The refresh itself failed transiently (429 / 5xx / network / timeout).
      throw report(asApiError(error), options, path);
    }
    if (!usedToken) {
      throw new ApiError({ status: 401, code: 'AUTH_TOKEN_MISSING', message: 'Please sign in to continue.', source: 'client' });
    }
  }
  if (usedToken) headers.Authorization = `Bearer ${usedToken}`;
  signal?.throwIfAborted();

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
    if (signal?.aborted) throw cause; // the caller cancelled: not an error to show
    if (timeout.aborted) throw report(timeoutError(), options, path);
    markUnreachable();
    throw report(networkError(), options, path);
  }

  if (res.ok) {
    markReachable();
    try {
      return await parse(res);
    } catch (error) {
      throw report(asApiError(error), options, path);
    }
  }

  const { error, isEnvelope } = await toApiError(res);
  if (!isEnvelope && res.status >= 500) markUnreachable();
  else markReachable();

  if (auth && !bearer && res.status === 401 && isEnvelope) {
    if (SESSION_ENDING_401.has(error.code)) {
      endSession(error.code);
      throw error;
    }
    if (authRetry && REFRESHABLE_401.has(error.code)) {
      if (retried) {
        // A brand-new token was refused too: the session is gone.
        endSession(error.code);
        throw error;
      }
      // Another request may already have renewed while this one was in flight.
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
      // The refresh ended the session and announced why; nothing more to do here.
      if (!next) throw error;
      if (currentSessionEpoch() !== epoch || signal?.aborted) throw new SessionChangedError();
      return send(path, options, parse, true);
    }
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
 * A raw file download (not enveloped). Errors are still enveloped JSON, and are
 * thrown as ApiError like any other call.
 */
export async function download(
  path: string,
  options: RequestOptions = {},
): Promise<{ blob: Blob; filename: string | null }> {
  let filename: string | null = null;
  const { data } = await send<Blob>(path, options, async (res) => {
    filename = filenameFromDisposition(res.headers.get('content-disposition'));
    return { data: await res.blob(), meta: metaFromHeaders(res) };
  });
  return { blob: data, filename };
}

/**
 * Builds a workspace-scoped path and its matching header from the same id, so the
 * two can never disagree (Phase 1 spec §5). Pass the canonical UUID.
 */
export function workspacePath(workspaceId: string, subpath = ''): [string, { workspaceId: string }] {
  return [`/organizations/${encodeURIComponent(workspaceId)}${subpath}`, { workspaceId }];
}
