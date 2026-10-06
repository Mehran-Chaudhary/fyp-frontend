import { documentsApi } from '../api/endpoints';
import { isApiError, type RateLimitInfo } from '../api/errors';
import type { UploadDocumentFields, VaultDocument } from '../api/types';

/**
 * P3-API-09 (Phase 3 spec §5 "Upload", §8). One file per request, as
 * multipart/form-data with one part named `file` and the optional text parts
 * `title`, `description`, `classification` and `tags`. It goes through the shared
 * API adapter, which sends it over XMLHttpRequest so the bytes sent can be shown,
 * with the same token refresh, request ids and error envelopes as every other call.
 */

export const UPLOAD_TITLE_MAX = 255;
export const UPLOAD_DESCRIPTION_MAX = 2000;
export const UPLOAD_TAGS_MAX = 20;
export const UPLOAD_TAG_MAX_LENGTH = 40;

/** Tags as the server stores them: trimmed, lower-cased, unique, in the order given. */
export function normalizeTags(input: string | readonly string[]): string[] {
  const raw = typeof input === 'string' ? input.split(',') : input;
  return [...new Set(raw.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

/**
 * The multipart body. `classification` is always sent (spec §3.3): without it the
 * upload takes the base's default, which may be above your clearance. Empty
 * optional parts are left out; an unknown part would be refused with 422.
 */
export function buildUploadForm(file: Blob, filename: string, fields: UploadDocumentFields): FormData {
  const form = new FormData();
  form.append('file', file, filename);
  form.append('classification', fields.classification);
  const title = fields.title?.trim();
  if (title) form.append('title', title);
  const description = fields.description?.trim();
  if (description) form.append('description', description);
  const tags = fields.tags ? normalizeTags(fields.tags) : [];
  if (tags.length) form.append('tags', tags.join(','));
  return form;
}

export interface UploadOptions {
  workspaceId: string;
  knowledgeBaseId: string;
  file: File;
  fields: UploadDocumentFields;
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
  /** 202: stored, encrypted and queued, with status UPLOADED. Not processed yet. */
  document: VaultDocument;
}

export function uploadRateLimit(info: RateLimitInfo | undefined): UploadRateLimit {
  return { remaining: info?.remaining ?? null, resetAt: info?.resetAt ?? null };
}

/** The rate-limit headers that came with a refused upload. */
export const rateLimitOfError = (error: unknown): UploadRateLimit =>
  uploadRateLimit(isApiError(error) ? error.rateLimit : undefined);

export async function uploadDocument(options: UploadOptions): Promise<UploadResult> {
  const form = buildUploadForm(options.file, options.file.name, options.fields);
  const { data, rateLimit } = await documentsApi.upload(options.workspaceId, options.knowledgeBaseId, form, {
    onProgress: options.onProgress,
    signal: options.signal,
  });
  return { document: data, ...uploadRateLimit(rateLimit) };
}
