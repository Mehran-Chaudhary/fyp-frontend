import { isApiError } from '../api/errors';
import { formatBytes } from './files';

export interface UploadErrorView {
  message: string;
  /** Offer "Open it" for this document (a duplicate the user can see). */
  openDocumentId?: string;
  /** Stop sending the rest of the queue: every other file would hit it too. */
  stopQueue?: boolean;
  /** Refetch knowledge bases or permissions. */
  refetch?: 'knowledge-bases' | 'permissions';
  /** Requeue after this many seconds (429). */
  retryAfterSeconds?: number;
  /** Sending the same file again may work: nothing was stored. */
  retryable?: boolean;
  /**
   * No usable answer arrived (a dropped connection, a timeout, a 5xx), so the file
   * may have been stored. Check the vault before offering to send it again (spec §5
   * "Upload" step 7): never resend blindly.
   */
  unknown?: boolean;
  /** The knowledge layer isn't configured on this server. */
  layerMissing?: string[];
}

/** Server and client codes after which the upload's fate is known: nothing was stored. */
const DEFINITE_5XX: ReadonlySet<string> = new Set(['OBJECT_STORAGE_UNAVAILABLE', 'KNOWLEDGE_LAYER_NOT_CONFIGURED']);

/**
 * Whether an upload error leaves its outcome unknown. A 408 is included on purpose:
 * the server's 120 s budget can run out after the file was stored (spec §2).
 */
export function isUploadOutcomeUnknown(error: unknown): boolean {
  if (!isApiError(error)) return false;
  if (DEFINITE_5XX.has(error.code)) return false;
  return (
    error.code === 'NETWORK_ERROR' ||
    error.code === 'NETWORK_TIMEOUT' ||
    error.code === 'REQUEST_TIMEOUT' ||
    error.code === 'UNEXPECTED_RESPONSE' ||
    error.status === 408 ||
    error.status >= 500
  );
}

const TYPE_NAMES: Readonly<Record<string, string>> = {
  pdf: 'PDF',
  docx: 'Word (.docx)',
  txt: 'text',
  text: 'text',
  md: 'Markdown',
  markdown: 'Markdown',
};

function allowedTypes(details: Record<string, unknown>): string | null {
  const value = details.allowedTypes;
  if (!Array.isArray(value)) return null;
  const names = Array.from(
    new Set(value.filter((item): item is string => typeof item === 'string').map((item) => TYPE_NAMES[item.toLowerCase()] ?? item)),
  );
  return names.length ? names.join(', ') : null;
}

/** One message per failed file (spec §5 "Upload", §8 P3-API-09, §10). */
export function describeUploadError(error: unknown): UploadErrorView {
  if (!isApiError(error)) {
    return { message: error instanceof Error && error.message ? error.message : 'The upload failed.', retryable: true };
  }
  const details = (error.details ?? {}) as Record<string, unknown>;
  const reason = typeof details.reason === 'string' ? details.reason : null;

  if (isUploadOutcomeUnknown(error)) {
    return {
      message:
        error.code === 'NETWORK_ERROR'
          ? 'The connection dropped before AgentVault answered, so the file may have been stored.'
          : error.code === 'NETWORK_TIMEOUT' || error.code === 'REQUEST_TIMEOUT' || error.status === 408
            ? 'The upload ran out of time before AgentVault answered, so the file may have been stored.'
            : "AgentVault didn't answer properly, so the file may have been stored.",
      unknown: true,
    };
  }

  switch (error.code) {
    case 'DOCUMENT_DUPLICATE':
      return typeof details.existingDocumentId === 'string'
        ? {
            message: `Already in this knowledge base as “${String(details.existingTitle ?? 'another document')}”.`,
            openDocumentId: details.existingDocumentId,
          }
        : // The copy is above the user's clearance: never say so, and never invent a link.
          { message: 'This file is already in this knowledge base.' };
    case 'DOCUMENT_EMPTY':
      return { message: 'The file is empty.' };
    case 'DOCUMENT_TYPE_NOT_ALLOWED': {
      if (reason === 'MACROS_PRESENT') {
        return { message: 'The document contains macros. Save it as a macro-free .docx and upload it again.' };
      }
      if (reason === 'MALFORMED') {
        return { message: "The file is damaged or isn't what its extension says. Export it again and upload the new copy." };
      }
      if (reason === 'ARCHIVE_TOO_LARGE') {
        return { message: 'The Word file unpacks to more than the server accepts. Remove large embedded files and try again.' };
      }
      const allowed = allowedTypes(details);
      return { message: allowed ? `This type of file isn't accepted here. Upload ${allowed}.` : error.message || "This type of file isn't accepted." };
    }
    case 'DOCUMENT_CONTENT_MISMATCH':
      return { message: `${error.message || "The file's contents don't match its extension."} Rename it with the right extension or export it again.` };
    case 'PAYLOAD_TOO_LARGE':
      return { message: "Larger than this server's upload limit (50 MB unless the deployment changed it)." };
    case 'CLASSIFICATION_EXCEEDS_CLEARANCE':
      return {
        message:
          typeof details.clearance === 'string'
            ? `You can't classify documents above ${titleCase(details.clearance)}.`
            : "You can't classify documents above your clearance.",
      };
    case 'KNOWLEDGE_BASE_ACCESS_DENIED':
      return {
        message:
          details.granted === 'READ'
            ? 'You have read-only access to this knowledge base.'
            : "Your access to this knowledge base doesn't allow uploads.",
        refetch: 'knowledge-bases',
        stopQueue: true,
      };
    case 'KNOWLEDGE_BASE_NOT_FOUND':
      return {
        message: "This knowledge base doesn't exist or you don't have access to it any more.",
        refetch: 'knowledge-bases',
        stopQueue: true,
      };
    case 'STORAGE_QUOTA_EXCEEDED': {
      const used = typeof details.usedBytes === 'number' || typeof details.usedBytes === 'string' ? details.usedBytes : null;
      const quota = typeof details.quotaBytes === 'number' || typeof details.quotaBytes === 'string' ? details.quotaBytes : null;
      const usage = used !== null && quota !== null ? ` ${formatBytes(used)} of ${formatBytes(quota)} used.` : '';
      return {
        message: `This workspace has used its document storage.${usage} Delete documents you no longer need, or ask the owner.`,
        stopQueue: true,
      };
    }
    case 'PERMISSION_DENIED':
      return { message: "Your role doesn't include uploading documents.", refetch: 'permissions', stopQueue: true };
    case 'RATE_LIMIT_EXCEEDED':
      return { message: 'Upload limit reached.', retryAfterSeconds: error.retryAfterSeconds ?? 60 };
    case 'VALIDATION_FAILED':
      return { message: Object.values(error.fieldErrors()).join(' ') || error.message };
    case 'KNOWLEDGE_LAYER_NOT_CONFIGURED':
      return {
        message: "Document uploads aren't set up on this server yet.",
        stopQueue: true,
        layerMissing: Array.isArray(details.missingConfiguration)
          ? details.missingConfiguration.filter((item): item is string => typeof item === 'string')
          : [],
      };
    case 'OBJECT_STORAGE_UNAVAILABLE':
      // "Storage write failed; nothing was recorded": safe to send again later.
      return { message: 'Document storage is temporarily unavailable. Nothing was stored; try again in a few minutes.', stopQueue: true, retryable: true };
    case 'BAD_REQUEST':
      return { message: error.message || 'The upload was malformed.' };
    default:
      return { message: error.message || 'The upload failed.' };
  }
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
