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
import { createSseParser, type SseMessage } from './sse';
import { currentSessionEpoch, endSession, getAccessToken, peekAccessToken, refreshAccessToken } from './token-manager';
import type { ApiResult, Paginated, ResponseMeta } from './types';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  /**
   * JSON by default. A `FormData` body is sent as multipart/form-data: the browser
   * sets the Content-Type with its boundary, so none is set here (Phase 3 spec §2).
   */
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
  /**
   * The server gives up at 30 s; wait slightly longer so its answer arrives. `null`:
   * no total timeout (event streams, which use an idle watchdog instead).
   */
  timeoutMs?: number | null;
  /** The Accept header. JSON unless a call says otherwise (event streams). */
  accept?: string;
  /**
   * Bytes sent so far, 0…1. `fetch` can't report upload progress, so a request with
   * this callback travels over XMLHttpRequest instead, through the same pipeline
   * (token, refresh-and-replay, request id, error envelope, global handler).
   */
  onUploadProgress?: (fraction: number) => void;
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

interface TransportInit {
  method: HttpMethod;
  headers: Record<string, string>;
  body: BodyInit | undefined;
  signal: AbortSignal;
}

/** Response headers of an XMLHttpRequest, as a Headers object. */
export function parseResponseHeaders(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim();
    if (!name) continue;
    try {
      headers.append(name, line.slice(colon + 1).trim());
    } catch {
      // A header name the Headers API rejects: skip it rather than fail the request.
    }
  }
  return headers;
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * `fetch` over XMLHttpRequest, for upload progress. Resolves with a real Response so
 * the rest of the pipeline can't tell the difference; rejects like fetch does (a
 * TypeError for a network failure, an AbortError when the signal fires).
 */
function xhrTransport(url: string, init: TransportInit, onProgress: (fraction: number) => void): Promise<Response> {
  return new Promise((resolve, reject) => {
    const aborted = () => new DOMException('The request was cancelled.', 'AbortError');
    if (init.signal.aborted) {
      reject(aborted());
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const cleanUp = () => init.signal.removeEventListener('abort', onAbort);
    init.signal.addEventListener('abort', onAbort, { once: true });

    xhr.open(init.method, url);
    xhr.withCredentials = true;
    xhr.responseType = 'blob';
    for (const [name, value] of Object.entries(init.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(1, event.loaded / event.total));
    };
    xhr.onload = () => {
      cleanUp();
      if (xhr.status < 200 || xhr.status > 599) {
        reject(new TypeError('Network request failed'));
        return;
      }
      const body = NULL_BODY_STATUSES.has(xhr.status) ? null : (xhr.response as Blob | null);
      resolve(
        new Response(body, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: parseResponseHeaders(xhr.getAllResponseHeaders()),
        }),
      );
    };
    xhr.onerror = () => {
      cleanUp();
      reject(new TypeError('Network request failed'));
    };
    xhr.onabort = () => {
      cleanUp();
      reject(aborted());
    };
    xhr.send((init.body ?? null) as XMLHttpRequestBodyInit | null);
  });
}

function serializeBody(body: unknown): BodyInit | undefined {
  if (body === undefined) return undefined;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return body;
  return JSON.stringify(body);
}

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
    Accept: options.accept ?? 'application/json',
    'X-Request-Id': newRequestId(),
  };
  const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
  // Multipart: the browser writes the Content-Type with its boundary.
  if (body !== undefined && !multipart) headers['Content-Type'] = 'application/json';
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

  const timeout = timeoutMs === null ? null : AbortSignal.timeout(timeoutMs);
  const signals = [signal, timeout].filter((item): item is AbortSignal => !!item);
  const combined = signals.length === 1 ? signals[0] : signals.length > 1 ? AbortSignal.any(signals) : new AbortController().signal;
  const url = buildUrl(path, options.query);
  let res: Response;
  try {
    options.onUploadProgress?.(0);
    res = options.onUploadProgress
      ? await xhrTransport(url, { method, headers, body: serializeBody(body), signal: combined }, options.onUploadProgress)
      : await fetch(url, { method, headers, credentials: 'include', body: serializeBody(body), signal: combined });
  } catch (cause) {
    if (signal?.aborted) throw cause; // the caller cancelled: not an error to show
    if (timeout?.aborted) throw report(timeoutError(), options, path);
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

// ── Server-Sent Events over POST (Phase 4 spec §2, §4.4, §4.5) ──────────────

/** The server writes `: keep-alive` every 15 s; three missed ones means the stream is gone. */
export const STREAM_IDLE_TIMEOUT_MS = 45_000;

export interface EventStreamOptions
  extends Omit<RequestOptions, 'method' | 'body' | 'timeoutMs' | 'accept' | 'onUploadProgress'> {
  body: unknown;
  /** Called once per event, in order, with the raw SSE message. */
  onMessage: (message: SseMessage) => void;
  /** No bytes (data or heartbeat) for this long, before or after the stream opens: interrupted. */
  idleTimeoutMs?: number;
}

/**
 * How reading a stream ended. A refusal before the stream opened is not here: it is
 * thrown as an ApiError, like any JSON call.
 */
export type EventStreamEnd =
  /** The server closed the stream. Whether it sent `done` or `error` is the caller's to judge. */
  | { kind: 'closed'; requestId?: string }
  /** The caller's signal fired. `opened`: the server had already answered 200. */
  | { kind: 'aborted'; opened: boolean; requestId?: string }
  /** The connection dropped or went silent. The server may still have stored the turn. */
  | { kind: 'interrupted'; opened: boolean; requestId?: string };

/**
 * POSTs a JSON body and reads the `text/event-stream` answer. It travels through the
 * same pipeline as every other call: bearer token, refresh-and-replay on an expired
 * token (a 401 always arrives as JSON before the stream opens, so the replay is
 * safe), request id, JSON error envelope and global handler. There is no total
 * timeout: answers can take minutes. An idle watchdog ends the read instead.
 * Never reconnects: that would send the question again.
 */
export async function openEventStream(path: string, options: EventStreamOptions): Promise<EventStreamEnd> {
  const { body, onMessage, idleTimeoutMs = STREAM_IDLE_TIMEOUT_MS, signal: callerSignal, ...rest } = options;
  const idle = new AbortController();
  let timer: number | undefined;
  const touch = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => idle.abort(), idleTimeoutMs);
  };
  const signal = callerSignal ? AbortSignal.any([callerSignal, idle.signal]) : idle.signal;
  let opened = false;
  let requestId: string | undefined;

  const read: Parser<EventStreamEnd> = async (res) => {
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('text/event-stream') || !res.body) throw unexpectedResponse(res);
    opened = true;
    requestId = res.headers.get('x-request-id') ?? undefined;
    const parser = createSseParser(onMessage);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const meta = metaFromHeaders(res);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        touch();
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.push(decoder.decode());
      return { data: { kind: 'closed', requestId }, meta };
    } catch {
      // The body read failed: our own abort, or the connection broke.
      const kind = callerSignal?.aborted ? 'aborted' : 'interrupted';
      return { data: { kind, opened: true, requestId }, meta };
    } finally {
      reader.releaseLock();
    }
  };

  touch();
  try {
    const { data } = await send<EventStreamEnd>(
      path,
      { ...rest, method: 'POST', body, accept: 'text/event-stream', timeoutMs: null, signal },
      read,
    );
    return data;
  } catch (error) {
    if (callerSignal?.aborted) return { kind: 'aborted', opened, requestId };
    if (idle.signal.aborted) return { kind: 'interrupted', opened, requestId };
    // A POST that got no answer may still have reached the server: reconcile, never resend.
    if (error instanceof ApiError && (error.code === 'NETWORK_ERROR' && error.source === 'client')) {
      return { kind: 'interrupted', opened, requestId };
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}
