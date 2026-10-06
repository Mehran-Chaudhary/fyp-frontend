import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors';
import { describeUploadError, isUploadOutcomeUnknown } from './upload-errors';

const error = (status: number, code: string, message = 'Server message.', details?: Record<string, unknown>, retryAfterSeconds?: number) =>
  new ApiError({ status, code, message, details, retryAfterSeconds });

describe('describeUploadError (spec §8 P3-API-09)', () => {
  it('offers to open a duplicate the user can see', () => {
    expect(
      describeUploadError(error(409, 'DOCUMENT_DUPLICATE', 'x', { existingDocumentId: 'doc-1', existingTitle: 'leave-policy' })),
    ).toEqual({ message: 'Already in this knowledge base as “leave-policy”.', openDocumentId: 'doc-1' });
  });

  it('never invents a link to a duplicate above the user’s clearance', () => {
    expect(describeUploadError(error(409, 'DOCUMENT_DUPLICATE', 'x', {}))).toEqual({ message: 'This file is already in this knowledge base.' });
  });

  it('uses details.reason for content refusals', () => {
    expect(describeUploadError(error(415, 'DOCUMENT_TYPE_NOT_ALLOWED', 'x', { reason: 'MACROS_PRESENT' })).message).toMatch(/macros/);
    expect(
      describeUploadError(error(415, 'DOCUMENT_TYPE_NOT_ALLOWED', 'x', { reason: 'TYPE_NOT_ALLOWED', allowedTypes: ['pdf', 'md'] })).message,
    ).toBe("This type of file isn't accepted here. Upload PDF, Markdown.");
    expect(describeUploadError(error(415, 'DOCUMENT_CONTENT_MISMATCH', 'The file is named .txt but its contents are a PDF.')).message).toBe(
      'The file is named .txt but its contents are a PDF. Rename it with the right extension or export it again.',
    );
    expect(describeUploadError(error(415, 'DOCUMENT_EMPTY', 'x', { reason: 'EMPTY' })).message).toBe('The file is empty.');
  });

  it('stops the queue on errors every file would hit', () => {
    expect(describeUploadError(error(403, 'STORAGE_QUOTA_EXCEEDED', 'Over quota.', { usedBytes: 1024, quotaBytes: 2048 }))).toEqual({
      message: 'This workspace has used its document storage. 1 KB of 2 KB used. Delete documents you no longer need, or ask the owner.',
      stopQueue: true,
    });
    expect(describeUploadError(error(403, 'PERMISSION_DENIED')).stopQueue).toBe(true);
    expect(describeUploadError(error(404, 'KNOWLEDGE_BASE_NOT_FOUND')).refetch).toBe('knowledge-bases');
  });

  it('requeues after a rate limit', () => {
    expect(describeUploadError(error(429, 'RATE_LIMIT_EXCEEDED', 'x', undefined, 42)).retryAfterSeconds).toBe(42);
  });

  it('reports the missing server settings', () => {
    expect(
      describeUploadError(error(503, 'KNOWLEDGE_LAYER_NOT_CONFIGURED', 'x', { missingConfiguration: ['QDRANT_URL'] })).layerMissing,
    ).toEqual(['QDRANT_URL']);
  });

  it('names the clearance a classification exceeded', () => {
    expect(describeUploadError(error(403, 'CLASSIFICATION_EXCEEDS_CLEARANCE', 'x', { clearance: 'INTERNAL' })).message).toBe(
      "You can't classify documents above Internal.",
    );
  });
});

describe('unknown outcomes (spec §5 "Upload" step 7)', () => {
  it('treats timeouts, dropped connections and 5xx as possibly stored', () => {
    expect(isUploadOutcomeUnknown(new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'x', source: 'client' }))).toBe(true);
    expect(isUploadOutcomeUnknown(new ApiError({ status: 0, code: 'NETWORK_TIMEOUT', message: 'x', source: 'client' }))).toBe(true);
    expect(isUploadOutcomeUnknown(error(408, 'REQUEST_TIMEOUT'))).toBe(true);
    expect(isUploadOutcomeUnknown(error(500, 'INTERNAL_SERVER_ERROR'))).toBe(true);
    expect(describeUploadError(error(408, 'REQUEST_TIMEOUT')).unknown).toBe(true);
  });

  it('knows the 503s after which nothing was stored', () => {
    expect(isUploadOutcomeUnknown(error(503, 'OBJECT_STORAGE_UNAVAILABLE'))).toBe(false);
    expect(isUploadOutcomeUnknown(error(503, 'KNOWLEDGE_LAYER_NOT_CONFIGURED'))).toBe(false);
    expect(describeUploadError(error(503, 'OBJECT_STORAGE_UNAVAILABLE')).retryable).toBe(true);
    expect(isUploadOutcomeUnknown(error(415, 'DOCUMENT_EMPTY'))).toBe(false);
  });
});
