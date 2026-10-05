import { ApiError, networkError, REFRESHABLE_401 } from '../api/errors';
import { endSession, getAccessToken, peekAccessToken, refreshAccessToken } from '../api/token-manager';
import type { ApiErrorBody, UploadDocumentFields, VaultDocument } from '../api/types';
import { API_BASE_URL } from '../env';

/**
 * E68 with upload progress (Phase 3 spec §2.3, Appendix B). `fetch` can't report
 * upload progress, so this uses XMLHttpRequest while keeping the API client's
 * behaviour: bearer token, workspace header, one refresh-and-retry on an expired
 * token, and ApiError on failure. One file per call; run at most 3 at a time.
 */

/** The server allows 120 s for the whole request, including the transfer. */
const UPLOAD_TIMEOUT_MS = 130_000;

export interface UploadOptions {
  workspaceId: string;
  knowledgeBaseId: string;
  file: File;
  fields?: UploadDocumentFields;
  /** 0…1, bytes sent so far. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface UploadRateLimit {
  /** Uploads left in this hour (`x-ratelimit-remaining`). */
  remaining: number | null;
  /** When the hourly budget refills, epoch ms (`x-ratelimit-reset`). */
  resetAt: number | null;
}

export interface UploadResult extends UploadRateLimit {
  document: VaultDocument;
}

/** An upload the server refused, with the rate-limit headers of that answer. */
export class UploadError extends ApiError {
  readonly uploadRateLimit: UploadRateLimit;

  constructor(error: ApiError, rateLimit: UploadRateLimit) {
    super({
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details,
      requestId: error.requestId,
      retryAfterSeconds: error.retryAfterSeconds,
      rateLimit: {
        remaining: rateLimit.remaining ?? undefined,
        resetAt: rateLimit.resetAt ?? undefined,
      },
      source: error.source,
    });
    this.name = 'UploadError';
    this.uploadRateLimit = rateLimit;
  }
}

interface RawResponse {
  status: number;
  text: string;
  requestId: string | null;
  retryAfter: string | null;
  remaining: string | null;
  reset: string | null;
}

export async function uploadDocument(options: UploadOptions, retried = false): Promise<UploadResult> {
  let token: string | null;
  try {
    token = await getAccessToken();
  } catch (error) {
    // The refresh itself failed transiently (429 / 5xx / network): the session is kept.
    throw error instanceof ApiError ? error : networkError();
  }
  if (!token) throw new ApiError({ status: 401, code: 'AUTH_TOKEN_MISSING', message: 'Please sign in to continue.' });

  const form = new FormData();
  form.append('file', options.file, options.file.name);
  const { title, description, classification, tags } = options.fields ?? {};
  if (title?.trim()) form.append('title', title.trim());
  if (description?.trim()) form.append('description', description.trim());
  if (classification) form.append('classification', classification);
  if (tags?.length) form.append('tags', tags.join(','));

  const url =
    `${API_BASE_URL}/organizations/${encodeURIComponent(options.workspaceId)}` +
    `/knowledge-bases/${encodeURIComponent(options.knowledgeBaseId)}/documents`;
  const raw = await send(url, form, token, options);
  const rateLimit = rateLimitOf(raw);

  if (raw.status === 202 || raw.status === 201 || raw.status === 200) {
    const body = parseJson<{ data?: VaultDocument }>(raw.text);
    if (!body?.data) throw new UploadError(unreadable(raw), rateLimit);
    return { document: body.data, ...rateLimit };
  }

  const error = toUploadError(raw);
  if (raw.status === 401 && REFRESHABLE_401.has(error.code)) {
    if (!retried) {
      // Another request may already have refreshed while this one was in flight.
      const current = peekAccessToken();
      const next = current && current !== token ? current : await refreshAccessToken();
      if (next) return uploadDocument(options, true);
      // The refresh ended the session and announced why.
      throw new UploadError(error, rateLimit);
    }
    endSession(error.code);
  }
  throw new UploadError(error, rateLimit);
}

function send(url: string, form: FormData, token: string, options: UploadOptions): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException('Upload cancelled', 'AbortError'));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('X-Organization-Id', options.workspaceId);
    xhr.setRequestHeader('X-Request-Id', newRequestId());
    xhr.setRequestHeader('Accept', 'application/json');
    // No Content-Type: the browser sets multipart/form-data with its boundary.

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) options.onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () =>
      resolve({
        status: xhr.status,
        text: xhr.responseText,
        requestId: xhr.getResponseHeader('x-request-id'),
        retryAfter: xhr.getResponseHeader('retry-after'),
        remaining: xhr.getResponseHeader('x-ratelimit-remaining'),
        reset: xhr.getResponseHeader('x-ratelimit-reset'),
      });
    xhr.onerror = () => reject(networkError());
    xhr.ontimeout = () =>
      reject(
        new ApiError({
          status: 0,
          source: 'client',
          code: 'NETWORK_TIMEOUT',
          message: 'The upload took too long. Try a faster connection or a smaller file.',
        }),
      );
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });

    xhr.send(form);
  });
}

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `av-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null; // not JSON (a proxy's HTML error page, for example)
  }
}

function numberOrNull(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rateLimitOf(raw: RawResponse): UploadRateLimit {
  const reset = numberOrNull(raw.reset);
  return {
    remaining: numberOrNull(raw.remaining),
    // An epoch in seconds (the backend's rate-limit guard).
    resetAt: reset === null ? null : reset * 1000,
  };
}

function unreadable(raw: RawResponse): ApiError {
  return new ApiError({
    status: raw.status,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'The server accepted the upload but its answer could not be read.',
    requestId: raw.requestId ?? undefined,
  });
}

interface ErrorBody {
  error?: ApiErrorBody;
  meta?: { requestId?: string };
}

function retryAfterSeconds(raw: RawResponse, details?: Record<string, unknown>): number | undefined {
  const header = numberOrNull(raw.retryAfter);
  if (header !== null && header > 0) return header;
  if (raw.retryAfter) {
    const date = Date.parse(raw.retryAfter);
    if (!Number.isNaN(date)) return Math.max(1, Math.ceil((date - Date.now()) / 1000));
  }
  const fromBody = details?.retryAfterSeconds;
  return typeof fromBody === 'number' && fromBody > 0 ? fromBody : undefined;
}

function toUploadError(raw: RawResponse): ApiError {
  const body = parseJson<ErrorBody>(raw.text);
  const envelope = body?.error && typeof body.error.code === 'string' ? body.error : null;
  if (!envelope) {
    const unreachable = raw.status >= 500 || raw.status === 0;
    return new ApiError({
      status: raw.status,
      code: unreachable ? 'NETWORK_ERROR' : raw.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST',
      message: unreachable ? "Can't reach AgentVault right now." : `The upload failed (${raw.status}).`,
      requestId: raw.requestId ?? undefined,
      retryAfterSeconds: retryAfterSeconds(raw),
    });
  }
  return new ApiError({
    status: raw.status,
    code: envelope.code,
    message: envelope.message || `The upload failed (${raw.status}).`,
    details: envelope.details,
    requestId: body?.meta?.requestId ?? raw.requestId ?? undefined,
    retryAfterSeconds: retryAfterSeconds(raw, envelope.details),
  });
}
