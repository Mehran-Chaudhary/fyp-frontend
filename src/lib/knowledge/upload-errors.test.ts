import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors';
import { describeUploadError } from './upload-errors';

const error = (status: number, code: string, message = 'Server message.', details?: Record<string, unknown>, retryAfterSeconds?: number) =>
  new ApiError({ status, code, message, details, retryAfterSeconds });

describe('describeUploadError', () => {
  it('offers to open a duplicate the user can see', () => {
    expect(
      describeUploadError(error(409, 'DOCUMENT_DUPLICATE', 'x', { existingDocumentId: 'doc-1', existingTitle: 'leave-policy' })),
    ).toEqual({ message: 'Already in this knowledge base as “leave-policy”.', openDocumentId: 'doc-1' });
  });

  it('never hints at a duplicate above the user’s clearance', () => {
    const view = describeUploadError(error(409, 'DOCUMENT_DUPLICATE', 'x', {}));
    expect(view).toEqual({ message: 'An identical file is already in this knowledge base.' });
  });

  it("shows the server's specific content messages", () => {
    expect(describeUploadError(error(415, 'DOCUMENT_CONTENT_MISMATCH', 'The file is named .txt but its contents are a PDF.')).message).toBe(
      'The file is named .txt but its contents are a PDF.',
    );
  });

  it('stops the queue on errors every file would hit', () => {
    expect(describeUploadError(error(403, 'STORAGE_QUOTA_EXCEEDED', 'Over quota.', { usedBytes: 1024, quotaBytes: 2048 }))).toEqual({
      message: 'Over quota. 1 KB of 2 KB used.',
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
