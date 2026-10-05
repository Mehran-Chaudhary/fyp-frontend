import type { ApiErrorBody, ErrorCode, ResponseMeta } from './types';

/** X-RateLimit-* headers (Phase 1 spec §3): the reset is Unix SECONDS on the wire. */
export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  /** When the window resets, as epoch milliseconds (converted from seconds). */
  resetAt?: number;
}

/**
 * Codes the client makes up when the API gave no usable answer. They never come
 * from the server, never carry a request id, and are marked `source: 'client'`
 * (spec §3: "Never invent a backend error code/request ID for a network failure").
 */
export type ClientErrorCode =
  /** The request never got an answer: offline, DNS, CORS, connection refused. */
  | 'NETWORK_ERROR'
  /** No answer within the client's timeout. The server may still have acted on it. */
  | 'NETWORK_TIMEOUT'
  /** An answer that isn't the API's JSON envelope: an HTML page from a proxy, a misrouted base URL. */
  | 'UNEXPECTED_RESPONSE'
  /** The session changed (sign-out, another account) while the request waited to be replayed. */
  | 'SESSION_CHANGED';

/**
 * Every failed call surfaces as an ApiError. Branch on `code`, never on `message`
 * (spec §3). `status` is 0 when the request never reached the API.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | ClientErrorCode | (string & {});
  readonly details?: Record<string, unknown>;
  /** The server's request id: only present when the server actually answered. */
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;
  readonly rateLimit?: RateLimitInfo;
  /** 'server': the API answered with an error envelope. 'client': it didn't. */
  readonly source: 'server' | 'client';
  /** Set when a global handler already told the user (toast, gate state). */
  handledGlobally = false;

  constructor(init: {
    status: number;
    code: ErrorCode | ClientErrorCode | (string & {});
    message: string;
    details?: Record<string, unknown>;
    requestId?: string;
    retryAfterSeconds?: number;
    rateLimit?: RateLimitInfo;
    source?: 'server' | 'client';
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.rateLimit = init.rateLimit;
    this.source = init.source ?? 'server';
  }

  is(...codes: Array<ErrorCode | ClientErrorCode>): boolean {
    return codes.includes(this.code as ErrorCode);
  }

  /**
   * `details.fields` of a 422 VALIDATION_FAILED. The server keys them by property
   * path (`email`, `newPassword`, `settings.defaultChunkSize`); an unknown property
   * arrives under its own name with "property x should not exist".
   *
   * With `fields`, keys are matched to those form fields (case-insensitively, or
   * through `aliases`); anything else goes to FORM_ERROR_KEY so it still reaches
   * the user. Without `fields`, the server's keys are returned as they are.
   */
  fieldErrors(
    options: { fields?: readonly string[]; aliases?: Record<string, string>; passwordField?: string } = {},
  ): Record<string, string> {
    const raw = this.details?.fields;
    if (!raw || typeof raw !== 'object') return {};
    const known = new Map((options.fields ?? []).map((field) => [field.toLowerCase(), field]));
    const out: Record<string, string> = {};

    for (const [rawKey, value] of Object.entries(raw as Record<string, unknown>)) {
      const messages = (Array.isArray(value) ? value : [value]).filter(
        (message): message is string => typeof message === 'string' && message.length > 0,
      );
      if (messages.length === 0) continue;

      // Older builds keyed password-policy failures by the message's first word.
      const key =
        options.aliases?.[rawKey] ??
        (options.passwordField && (rawKey === 'Password' || rawKey === 'That') ? options.passwordField : rawKey);

      let target: string;
      if (!options.fields) {
        target = key;
      } else {
        target = known.get(key.toLowerCase()) ?? FORM_ERROR_KEY;
        if (target === FORM_ERROR_KEY && import.meta.env.DEV && messages.some((m) => m.includes('should not exist'))) {
          // A client bug, not a user mistake: the form sent a field the API doesn't take.
          console.error('[api] The server rejected a field the client sent:', messages.join(' '));
        }
      }
      out[target] = [out[target], ...messages].filter(Boolean).join(' ');
    }
    return out;
  }

  get retryAt(): number | undefined {
    return this.retryAfterSeconds ? Date.now() + this.retryAfterSeconds * 1000 : undefined;
  }

  /**
   * When a throttled call may be retried (epoch ms): Retry-After first, then the
   * window reset, then a fallback.
   */
  retryDeadline(fallbackSeconds = 60): number {
    if (this.retryAfterSeconds) return Date.now() + this.retryAfterSeconds * 1000;
    if (this.rateLimit?.resetAt && this.rateLimit.resetAt > Date.now()) return this.rateLimit.resetAt;
    return Date.now() + fallbackSeconds * 1000;
  }

  /** ACCOUNT_LOCKED: `details.lockedUntil` as epoch ms, or 15 minutes from now. */
  lockDeadline(): number {
    const until = Date.parse(String(this.details?.lockedUntil ?? ''));
    return Number.isFinite(until) ? until : Date.now() + 15 * 60_000;
  }
}

/** Key used for errors that belong to the form as a whole. */
export const FORM_ERROR_KEY = '_form';

/**
 * 401s from the authentication guard that a refresh can fix (spec §4 "Renewal and
 * replay"). `AUTH_TOKEN_REVOKED` is here as the controlled exception: the backend
 * uses it both for a revoked session and for an access token cut off by a password
 * change made from this browser, and only a refresh can tell the two apart. If the
 * session really was revoked, that refresh fails and ends it.
 * `AUTH_TOKEN_INVALID` is not here: a malformed or forged token ends the session.
 */
export const REFRESHABLE_401: ReadonlySet<string> = new Set(['AUTH_TOKEN_EXPIRED', 'AUTH_TOKEN_MISSING', 'AUTH_TOKEN_REVOKED']);

/** 401s that end the session without a refresh. */
export const SESSION_ENDING_401: ReadonlySet<string> = new Set(['AUTH_TOKEN_INVALID']);

/**
 * Codes a workspace-scoped request returns when the workspace itself is closed to
 * you (spec §5, §11). `ACCOUNT_EMAIL_NOT_VERIFIED` belongs here only with
 * `details.requiredBy === 'workspace'`; without it, it is the global gate.
 */
export const WORKSPACE_ACCESS_CODES: ReadonlySet<string> = new Set([
  'ORGANIZATION_NOT_FOUND',
  'ORGANIZATION_SUSPENDED',
  'MEMBERSHIP_SUSPENDED',
  'IP_NOT_ALLOWED',
  'MFA_REQUIRED',
]);

/** True when a workspace call was refused by that workspace's access policy. */
export function isWorkspaceAccessError(error: unknown): error is ApiError {
  if (!isApiError(error)) return false;
  if (WORKSPACE_ACCESS_CODES.has(error.code)) return true;
  return error.code === 'ACCOUNT_EMAIL_NOT_VERIFIED' && error.details?.requiredBy === 'workspace';
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function hasCode(error: unknown, ...codes: Array<ErrorCode | ClientErrorCode>): error is ApiError {
  return isApiError(error) && error.is(...codes);
}

/** The server or network is in trouble; the session itself is fine. */
export function isTransient(error: unknown): boolean {
  if (!isApiError(error)) return false;
  return (
    error.status === 0 ||
    error.status >= 500 ||
    error.status === 408 ||
    error.code === 'NETWORK_ERROR' ||
    error.code === 'NETWORK_TIMEOUT'
  );
}

/**
 * A mutation whose outcome is unknown: it may have been carried out even though
 * no usable answer arrived (no answer, a timeout, or a 5xx after the server may
 * already have written). Never repeat it blindly; re-read state instead
 * (Phase 1 spec §3, Phase 2 spec §9 "5xx/timeout after mutation").
 */
export function isOutcomeUnknown(error: unknown): boolean {
  if (!isApiError(error)) return false;
  return error.code === 'NETWORK_ERROR' || error.code === 'NETWORK_TIMEOUT' || error.status >= 500;
}

export function networkError(message = "Can't reach AgentVault. Check your connection."): ApiError {
  return new ApiError({ status: 0, code: 'NETWORK_ERROR', message, source: 'client' });
}

export function timeoutError(message = 'The server took too long to answer.'): ApiError {
  return new ApiError({ status: 0, code: 'NETWORK_TIMEOUT', message, source: 'client' });
}

/** Reads X-RateLimit-* (reset in Unix seconds). */
export function readRateLimit(headers: Headers): RateLimitInfo | undefined {
  const number = (name: string) => {
    const raw = headers.get(name);
    if (raw === null || raw.trim() === '') return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  const limit = number('x-ratelimit-limit');
  const remaining = number('x-ratelimit-remaining');
  const reset = number('x-ratelimit-reset');
  if (limit === undefined && remaining === undefined && reset === undefined) return undefined;
  return { limit, remaining, resetAt: reset === undefined ? undefined : reset * 1000 };
}

function parseRetryAfter(res: Response, details?: Record<string, unknown>): number | undefined {
  const header = res.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(1, Math.ceil((date - Date.now()) / 1000));
  }
  const fromBody = details?.retryAfterSeconds;
  return typeof fromBody === 'number' && fromBody > 0 ? fromBody : undefined;
}

interface FailureBody {
  success?: false;
  error?: ApiErrorBody;
  meta?: ResponseMeta;
}

/** Parses a body as JSON without ever throwing (HTML error pages, empty bodies). */
export async function readJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Builds an ApiError from a non-2xx response. `isEnvelope` tells the caller whether
 * the API itself answered: a 5xx without an envelope came from a proxy or gateway,
 * which means the backend is unreachable.
 */
export async function toApiError(res: Response): Promise<{ error: ApiError; isEnvelope: boolean }> {
  const body = (await readJson(res)) as FailureBody | null;
  const isEnvelope = !!body && typeof body === 'object' && !!body.error && typeof body.error.code === 'string';
  const rateLimit = readRateLimit(res.headers);

  if (!isEnvelope) {
    const unreachable = res.status >= 500;
    return {
      isEnvelope,
      error: new ApiError({
        status: res.status,
        code: unreachable ? 'NETWORK_ERROR' : 'UNEXPECTED_RESPONSE',
        message: unreachable
          ? "Can't reach AgentVault right now."
          : `The server sent an unexpected answer (HTTP ${res.status}).`,
        retryAfterSeconds: parseRetryAfter(res),
        rateLimit,
        source: 'client',
      }),
    };
  }

  const details = body!.error!.details;
  return {
    isEnvelope,
    error: new ApiError({
      status: res.status,
      code: body!.error!.code,
      message: body!.error!.message || res.statusText,
      details: details && typeof details === 'object' ? details : undefined,
      requestId: body?.meta?.requestId ?? res.headers.get('x-request-id') ?? undefined,
      retryAfterSeconds: parseRetryAfter(res, details),
      rateLimit,
      source: 'server',
    }),
  };
}
