import type { DocumentStatus, VaultDocument } from '../api/types';

/**
 * The document lifecycle (Phase 3 spec §4.1–4.3): what to show for a status,
 * when a retry can help, and which stage a failure happened in.
 *
 * `status` describes the latest run; `isSearchable` (activeIndexVersion ≠ null)
 * is what retrieval serves. During a reindex the two differ: the document keeps
 * answering searches from the previous version, and a failed reindex leaves that
 * version in place.
 */

export const IN_PROGRESS: readonly DocumentStatus[] = ['UPLOADED', 'PARSING', 'CHUNKING', 'EMBEDDING'];
export const isInProgress = (status: DocumentStatus): boolean => IN_PROGRESS.includes(status);

/** Reindex is only accepted from READY or FAILED; anything else answers 409 DOCUMENT_PROCESSING. */
export const canReindexNow = (document: Pick<VaultDocument, 'status'>): boolean =>
  document.status === 'READY' || document.status === 'FAILED';

/** The lifecycle order, for sorting and comparisons. */
export const STATUS_ORDER: readonly DocumentStatus[] = ['UPLOADED', 'PARSING', 'CHUNKING', 'EMBEDDING', 'READY', 'FAILED'];

// ── Groups: what the vault filters and counts by ───────────────────────────

export type StatusGroup = 'queued' | 'processing' | 'ready' | 'failed';

export const STATUS_GROUP_ORDER: readonly StatusGroup[] = ['queued', 'processing', 'ready', 'failed'];

/** The statuses behind each group. "In progress" (spec §5) is queued + processing. */
export const STATUS_GROUPS: Readonly<Record<StatusGroup, readonly DocumentStatus[]>> = {
  queued: ['UPLOADED'],
  processing: ['PARSING', 'CHUNKING', 'EMBEDDING'],
  ready: ['READY'],
  failed: ['FAILED'],
};

export const STATUS_GROUP_LABELS: Readonly<Record<StatusGroup, string>> = {
  queued: 'Queued',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};

export function statusGroupOf(status: DocumentStatus): StatusGroup {
  if (status === 'UPLOADED') return 'queued';
  if (status === 'READY') return 'ready';
  if (status === 'FAILED') return 'failed';
  return 'processing';
}

// ── What a status looks like ────────────────────────────────────────────────

export type StatusTone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger';

export interface DisplayStatus {
  group: StatusGroup;
  /** The badge: Queued, Processing, Ready, Failed or Reindex failed. */
  label: string;
  /** The second line while queued or processing ("Reading text"), else null. */
  stage: string | null;
  tone: StatusTone;
  /** A reindex is queued, running or failed while the previous version keeps answering searches. */
  previousVersionServing: boolean;
  /** Processing again after a successful run (`indexVersion` > 1 with something already served). */
  reindexing: boolean;
  /** In progress with a statusMessage: an attempt failed and will be retried. A warning, not an error. */
  retrying: boolean;
  /** The sentence to show under the status: always the server's `statusMessage` when there is one. */
  detail: string | null;
  /** FAILED only: whether retrying the same file is likely to help (permission is checked separately). */
  retryHelps: boolean;
}

/** Spec §4.1's suggested labels: "Processing — reading", "Processing", "Processing — indexing". */
const STAGE: Readonly<Record<DocumentStatus, string>> = {
  UPLOADED: 'Waiting for a worker',
  PARSING: 'Reading text',
  CHUNKING: 'Saving chunks',
  EMBEDDING: 'Indexing',
  READY: 'Searchable',
  FAILED: 'Failed',
};

type StatusFields = Pick<VaultDocument, 'status' | 'statusMessage' | 'failureCode' | 'isSearchable' | 'activeIndexVersion'>;

export function displayStatus(document: StatusFields): DisplayStatus {
  const group = statusGroupOf(document.status);
  const serving = document.activeIndexVersion !== null && document.isSearchable;

  if (group === 'queued' || group === 'processing') {
    const retrying = !!document.statusMessage;
    return {
      group,
      label: STATUS_GROUP_LABELS[group],
      stage: serving
        ? group === 'queued'
          ? 'Reindex queued'
          : `Reindexing · ${STAGE[document.status].toLowerCase()}`
        : STAGE[document.status],
      // A statusMessage while in flight is a retry notice (§4.3), not a failure.
      tone: retrying ? 'warning' : group === 'queued' ? 'neutral' : 'progress',
      previousVersionServing: serving,
      reindexing: serving,
      retrying,
      detail: document.statusMessage,
      retryHelps: false,
    };
  }

  if (group === 'ready') {
    return {
      group,
      label: 'Ready',
      stage: null,
      tone: 'success',
      previousVersionServing: false,
      reindexing: false,
      retrying: false,
      detail: null,
      retryHelps: false,
    };
  }

  const hint = failureHint(document.failureCode);
  return {
    group,
    // §4.2: a failed reindex keeps the previous version searchable; say so, not a plain "Failed".
    label: serving ? 'Reindex failed' : 'Failed',
    stage: serving ? 'Previous version still searchable' : null,
    tone: serving ? 'warning' : 'danger',
    previousVersionServing: serving,
    reindexing: false,
    retrying: false,
    detail: document.statusMessage,
    retryHelps: hint.retryHelps,
  };
}

// ── Failures (§4.3): the code set is open, so never switch on it exhaustively ──

/** What kind of problem a failure code points at, for its icon. */
export type FailureKind = 'file' | 'service' | 'time' | 'storage' | 'unknown';

export interface FailureHint {
  /** What the user can do about it, when there is something specific to say. */
  hint: string | null;
  /** Whether a retry (P3-API-15) is likely to help. */
  retryHelps: boolean;
  /** A dependency was down: retrying later usually works. */
  transient: boolean;
  kind: FailureKind;
}

/** Failure codes for which retrying the same file does not help. Anything else may be retried. */
const PERMANENT_FAILURES: ReadonlySet<string> = new Set([
  'UNPARSEABLE_DOCUMENT',
  'DOCUMENT_EMPTY',
  'ENCRYPTED_DOCUMENT',
  'TOO_MANY_CHUNKS',
  'UNSUPPORTED_FILE_TYPE',
  'DOCUMENT_TOO_LARGE',
  'CONTENT_MISSING',
  'CONTENT_INTEGRITY_FAILURE',
]);

export const retryCanHelp = (failureCode: string | null): boolean => !failureCode || !PERMANENT_FAILURES.has(failureCode);

/** `failureCode` only picks the hint and the icon; `statusMessage` is always what is shown. */
export function failureHint(failureCode: string | null): FailureHint {
  switch (failureCode) {
    case 'UNPARSEABLE_DOCUMENT':
      return { hint: 'Re-export the file from the program that made it, then upload it again.', retryHelps: false, transient: false, kind: 'file' };
    case 'DOCUMENT_EMPTY':
      return { hint: 'Upload a text-based file. Scanned documents need OCR, which this deployment does not do.', retryHelps: false, transient: false, kind: 'file' };
    case 'ENCRYPTED_DOCUMENT':
      return { hint: 'Remove the password, delete this document and upload the file again.', retryHelps: false, transient: false, kind: 'file' };
    case 'TOO_MANY_CHUNKS':
      return { hint: 'Split the file into smaller documents and upload them separately.', retryHelps: false, transient: false, kind: 'file' };
    case 'UNSUPPORTED_FILE_TYPE':
    case 'DOCUMENT_TOO_LARGE':
      return { hint: 'Fix the file, delete this document and upload it again.', retryHelps: false, transient: false, kind: 'file' };
    case 'AI_SERVICE_UNAVAILABLE':
    case 'VECTOR_STORE_UNAVAILABLE':
      return { hint: 'A service was down. Retrying later usually works.', retryHelps: true, transient: true, kind: 'service' };
    case 'OBJECT_STORAGE_UNAVAILABLE':
      return { hint: 'Document storage was down. Retrying later usually works.', retryHelps: true, transient: true, kind: 'storage' };
    case 'INGESTION_TIMEOUT':
      return { hint: 'Processing took longer than its 30-minute budget. A very large file may need splitting.', retryHelps: true, transient: false, kind: 'time' };
    case 'INGESTION_STALLED':
      return { hint: 'Processing stalled several times. Retrying may work; if it fails again, upload the file again.', retryHelps: true, transient: false, kind: 'time' };
    case 'CONTENT_MISSING':
    case 'CONTENT_INTEGRITY_FAILURE':
      return { hint: 'The stored file is gone or damaged. Delete this document and upload it again.', retryHelps: false, transient: false, kind: 'storage' };
    default:
      return { hint: null, retryHelps: retryCanHelp(failureCode), transient: false, kind: 'unknown' };
  }
}

// ── The ingestion pipeline, stage by stage ──────────────────────────────────

/**
 * The ingestion stages of the vault's pipeline panel. PII masking is not one of
 * them: masking happens when text is sent to a model (§4.8).
 */
export type IngestionStage = 'extract' | 'chunk' | 'embed' | 'store';
export const INGESTION_STAGES: readonly IngestionStage[] = ['extract', 'chunk', 'embed', 'store'];

export type StageState = 'done' | 'active' | 'failed' | 'pending';

const ACTIVE_STAGE: Partial<Record<DocumentStatus, IngestionStage>> = {
  PARSING: 'extract',
  CHUNKING: 'chunk',
  EMBEDDING: 'embed',
};

/**
 * Each stage's state for one document: stages before its status are done, the
 * current one is active, later ones pending; a failure marks the stage it failed in.
 */
export function pipelineStates(
  document: Pick<VaultDocument, 'status' | 'failureCode' | 'processingMetrics'>,
): Record<IngestionStage, StageState> {
  const states = { extract: 'pending', chunk: 'pending', embed: 'pending', store: 'pending' } as Record<IngestionStage, StageState>;
  if (document.status === 'READY') {
    for (const stage of INGESTION_STAGES) states[stage] = 'done';
    return states;
  }
  const current = document.status === 'FAILED' ? failedStage(document) : ACTIVE_STAGE[document.status];
  if (!current) return states; // UPLOADED: queued, nothing has started
  const at = INGESTION_STAGES.indexOf(current);
  INGESTION_STAGES.forEach((stage, index) => {
    if (index < at) states[stage] = 'done';
  });
  states[current] = document.status === 'FAILED' ? 'failed' : 'active';
  return states;
}

/**
 * The stage a FAILED document failed in. The failure code decides when it names a
 * stage; otherwise the timings that were recorded tell how far processing got.
 */
export function failedStage(document: Pick<VaultDocument, 'failureCode' | 'processingMetrics'>): IngestionStage {
  switch (document.failureCode) {
    case 'DOCUMENT_EMPTY':
    case 'ENCRYPTED_DOCUMENT':
    case 'UNPARSEABLE_DOCUMENT':
    case 'UNSUPPORTED_FILE_TYPE':
    case 'DOCUMENT_TOO_LARGE':
    case 'OBJECT_STORAGE_UNAVAILABLE':
    case 'CONTENT_MISSING':
    case 'CONTENT_INTEGRITY_FAILURE':
      return 'extract';
    case 'TOO_MANY_CHUNKS':
      return 'chunk';
    case 'VECTOR_STORE_UNAVAILABLE':
      return 'store';
  }
  const metrics = document.processingMetrics ?? {};
  if (metrics.embedMs !== undefined) return 'store';
  if (metrics.persistMs !== undefined) return 'embed';
  if (metrics.parseMs !== undefined) return 'chunk';
  return 'extract';
}
