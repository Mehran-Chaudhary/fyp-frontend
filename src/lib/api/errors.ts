import type { ApiErrorBody, ErrorCode, ResponseMeta } from './types';

/**
 * Every failed call surfaces as an ApiError. Branch on `code`, never on `message`
 * (spec §3.2). `status` is 0 when the request never reached the API.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | (string & {});
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;
  /** Set when a global handler already told the user (toast, gate state). */
  handledGlobally = false;

  constructor(init: {
    status: number;
    code: ErrorCode | (string & {});
    message: string;
    details?: Record<string, unknown>;
    requestId?: string;
    retryAfterSeconds?: number;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }

  is(...codes: ErrorCode[]): boolean {
    return codes.includes(this.code as ErrorCode);
  }

  /**
   * `details.fields` of a 422, normalised per spec §3.3 / BF-4. Keys are the first
   * word of each message, so password-policy failures arrive under "Password" or
   * "That" and unknown fields under "property".
   */
  fieldErrors(
    options: { passwordField?: string; fields?: readonly string[]; aliases?: Record<string, string> } = {},
  ): Record<string, string> {
    const raw = this.details?.fields;
    if (!raw || typeof raw !== 'object') return {};
    const known = new Map((options.fields ?? []).map((field) => [field.toLowerCase(), field]));
    const out: Record<string, string> = {};

    for (const [rawKey, value] of Object.entries(raw as Record<string, unknown>)) {
      // Nested server keys such as "settings.defaultChunkOverlap" map onto a form field.
      const key = options.aliases?.[rawKey] ?? rawKey;
      const messages = (Array.isArray(value) ? value : [value]).filter(
        (message): message is string => typeof message === 'string' && message.length > 0,
      );
      if (messages.length === 0) continue;

      let target: string;
      if (options.passwordField && (key === 'Password' || key === 'That')) {
        target = options.passwordField;
      } else if (key === 'property') {
        target = FORM_ERROR_KEY;
        console.error('[api] The server rejected a field the client sent:', messages.join(' '));
      } else {
        target = known.get(key.toLowerCase()) ?? (options.fields ? FORM_ERROR_KEY : key);
      }
      out[target] = [out[target], ...messages].filter(Boolean).join(' ');
    }
    return out;
  }

  get retryAt(): number | undefined {
    return this.retryAfterSeconds ? Date.now() + this.retryAfterSeconds * 1000 : undefined;
  }

  /** When a throttled call may be retried (epoch ms), with a fallback window. */
  retryDeadline(fallbackSeconds = 60): number {
    return Date.now() + (this.retryAfterSeconds ?? fallbackSeconds) * 1000;
  }

  /** ACCOUNT_LOCKED: `details.lockedUntil` as epoch ms, or 15 minutes from now. */
  lockDeadline(): number {
    const until = Date.parse(String(this.details?.lockedUntil ?? ''));
    return Number.isFinite(until) ? until : Date.now() + 15 * 60_000;
  }
}

/** Key used for errors that belong to the form as a whole. */
export const FORM_ERROR_KEY = '_form';

/** 401 codes that mean "your access token is no longer good" (spec §4.3). */
export const REFRESHABLE_401: ReadonlySet<string> = new Set([
  'AUTH_TOKEN_EXPIRED',
  'AUTH_TOKEN_REVOKED',
  'AUTH_TOKEN_INVALID',
  'AUTH_TOKEN_MISSING',
]);

/** Access-state codes returned on workspace-scoped requests (spec §9.2). */
export const WORKSPACE_ACCESS_CODES: ReadonlySet<string> = new Set([
  'ORGANIZATION_NOT_FOUND',
  'ORGANIZATION_SUSPENDED',
  'MEMBERSHIP_SUSPENDED',
  'IP_NOT_ALLOWED',
  'MFA_REQUIRED',
]);

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function hasCode(error: unknown, ...codes: ErrorCode[]): error is ApiError {
  return isApiError(error) && error.is(...codes);
}

/** The server or network is in trouble; the session itself is fine. */
export function isTransient(error: unknown): boolean {
  if (!isApiError(error)) return false;
  return error.status === 0 || error.status >= 500 || error.status === 408 || error.code === 'NETWORK_ERROR';
}

export function networkError(message = "Can't reach AgentVault. Check your connection."): ApiError {
  return new ApiError({ status: 0, code: 'NETWORK_ERROR', message });
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

/**
 * Builds an ApiError from a non-2xx response. `isEnvelope` tells the caller whether
 * the backend itself answered: a 5xx without an envelope came from a proxy or
 * gateway, which means the backend is unreachable.
 */
export async function toApiError(res: Response): Promise<{ error: ApiError; isEnvelope: boolean }> {
  const body = (await res.json().catch(() => null)) as FailureBody | null;
  const isEnvelope = !!body && typeof body === 'object' && !!body.error && typeof body.error.code === 'string';
  const details = isEnvelope ? body!.error!.details : undefined;
  const requestId = body?.meta?.requestId ?? res.headers.get('x-request-id') ?? undefined;

  if (!isEnvelope) {
    const unreachable = res.status >= 500;
    return {
      isEnvelope,
      error: new ApiError({
        status: res.status,
        code: unreachable ? 'NETWORK_ERROR' : res.status === 404 ? 'RESOURCE_NOT_FOUND' : 'BAD_REQUEST',
        message: unreachable ? "Can't reach AgentVault right now." : res.statusText || 'The request failed.',
        requestId,
        retryAfterSeconds: parseRetryAfter(res),
      }),
    };
  }

  return {
    isEnvelope,
    error: new ApiError({
      status: res.status,
      code: body!.error!.code,
      message: body!.error!.message || res.statusText,
      details,
      requestId,
      retryAfterSeconds: parseRetryAfter(res, details),
    }),
  };
}
