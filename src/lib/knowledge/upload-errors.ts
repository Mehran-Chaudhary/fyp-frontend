import { isApiError } from '../api/errors';
import { formatBytes } from './files';

export interface UploadErrorView {
  message: string;
  /** Offer "Open it" for this document. */
  openDocumentId?: string;
  /** Stop sending the rest of the queue. */
  stopQueue?: boolean;
  /** Refetch knowledge bases or permissions. */
  refetch?: 'knowledge-bases' | 'permissions';
  /** Requeue after this many seconds. */
  retryAfterSeconds?: number;
  /** Sending the same file again may work (a timeout, a network blip). */
  retryable?: boolean;
  /** The knowledge layer isn't configured on this server (§6.9). */
  layerMissing?: string[];
}

/** Phase 3 spec §6.2: one message per failed file. */
export function describeUploadError(error: unknown): UploadErrorView {
  if (!isApiError(error)) {
    return { message: error instanceof Error && error.message ? error.message : 'The upload failed.', retryable: true };
  }
  const details = (error.details ?? {}) as Record<string, unknown>;
  switch (error.code) {
    case 'DOCUMENT_DUPLICATE':
      return typeof details.existingDocumentId === 'string'
        ? {
            message: `Already in this knowledge base as “${String(details.existingTitle ?? 'another document')}”.`,
            openDocumentId: details.existingDocumentId,
          }
        : // The copy is above the user's clearance: never say so.
          { message: 'An identical file is already in this knowledge base.' };
    case 'DOCUMENT_TYPE_NOT_ALLOWED':
    case 'DOCUMENT_CONTENT_MISMATCH':
    case 'DOCUMENT_EMPTY':
      return { message: error.message };
    case 'PAYLOAD_TOO_LARGE':
      return { message: 'Larger than the 50 MB limit.' };
    case 'CLASSIFICATION_EXCEEDS_CLEARANCE':
      return {
        message:
          typeof details.clearance === 'string'
            ? `You can't classify documents above ${titleCase(details.clearance)}.`
            : "You can't classify documents above your clearance.",
      };
    case 'KNOWLEDGE_BASE_ACCESS_DENIED':
      return { message: 'You have read-only access to this knowledge base.', refetch: 'knowledge-bases' };
    case 'KNOWLEDGE_BASE_NOT_FOUND':
      return {
        message: 'This knowledge base no longer exists or you lost access to it.',
        refetch: 'knowledge-bases',
        stopQueue: true,
      };
    case 'STORAGE_QUOTA_EXCEEDED': {
      const used = Number(details.usedBytes);
      const quota = Number(details.quotaBytes);
      const usage = Number.isFinite(used) && Number.isFinite(quota) ? ` ${formatBytes(used)} of ${formatBytes(quota)} used.` : '';
      return { message: `${error.message}${usage}`, stopQueue: true };
    }
    case 'PERMISSION_DENIED':
      return { message: "You don't have permission to upload documents.", refetch: 'permissions', stopQueue: true };
    case 'REQUEST_TIMEOUT':
      return { message: 'The upload took too long. Try a faster connection or a smaller file.', retryable: true };
    case 'RATE_LIMIT_EXCEEDED':
      return { message: 'Upload limit reached.', retryAfterSeconds: error.retryAfterSeconds ?? 60 };
    case 'VALIDATION_FAILED':
      return { message: Object.values(error.fieldErrors()).join(' ') || error.message };
    case 'KNOWLEDGE_LAYER_NOT_CONFIGURED':
      return {
        message: 'Uploads are unavailable right now.',
        stopQueue: true,
        layerMissing: Array.isArray(details.missingConfiguration)
          ? details.missingConfiguration.filter((item): item is string => typeof item === 'string')
          : [],
      };
    case 'OBJECT_STORAGE_UNAVAILABLE':
      return { message: 'Uploads are unavailable right now. Document storage is down; try again in a few minutes.', stopQueue: true, retryable: true };
    case 'NETWORK_ERROR':
      return { message: "Can't reach AgentVault. Check your connection and try again.", retryable: true };
    case 'BAD_REQUEST':
      return { message: error.message };
    default:
      return { message: error.message || 'The upload failed.', retryable: error.status >= 500 };
  }
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
