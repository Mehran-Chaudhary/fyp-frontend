import type { DocumentStatus, VaultDocument } from '../api/types';

/**
 * The document lifecycle (Phase 3 spec §4.1): what to show for a status, when a
 * retry can help, which stage a failure happened in, and how fast to poll.
 */

export const IN_PROGRESS: readonly DocumentStatus[] = ['UPLOADED', 'PARSING', 'CHUNKING', 'EMBEDDING'];
export const isInProgress = (status: DocumentStatus): boolean => IN_PROGRESS.includes(status);

export type VaultBadge = 'PENDING' | 'INDEXING' | 'INDEXED' | 'FAILED';

/** The statuses behind each vault badge; "Indexing" is one request since BF-18. */
export const BADGE_STATUSES: Readonly<Record<VaultBadge, readonly DocumentStatus[]>> = {
  INDEXED: ['READY'],
  INDEXING: ['PARSING', 'CHUNKING', 'EMBEDDING'],
  PENDING: ['UPLOADED'],
  FAILED: ['FAILED'],
};

export interface DisplayStatus {
  badge: VaultBadge;
  /** Short stage text for the second line. */
  stage: string;
  /** A reindex is running or failed while the previous version keeps answering searches. */
  previousVersionServing: boolean;
  /** An in-progress document whose last attempt failed and will be retried. */
  retrying: boolean;
}

const STAGE: Readonly<Record<DocumentStatus, string>> = {
  UPLOADED: 'Queued',
  PARSING: 'Extracting text',
  CHUNKING: 'Chunking',
  EMBEDDING: 'Embedding',
  READY: 'Searchable',
  FAILED: 'Failed',
};

export function displayStatus(
  document: Pick<VaultDocument, 'status' | 'statusMessage' | 'isSearchable' | 'indexVersion' | 'activeIndexVersion'>,
): DisplayStatus {
  const reprocessing = document.activeIndexVersion !== null && document.activeIndexVersion !== document.indexVersion;
  const inProgress = isInProgress(document.status);
  const badge: VaultBadge =
    document.status === 'READY'
      ? 'INDEXED'
      : document.status === 'FAILED'
        ? 'FAILED'
        : document.status === 'UPLOADED'
          ? 'PENDING'
          : 'INDEXING';
  return {
    badge,
    stage: reprocessing && inProgress ? `Reindexing: ${STAGE[document.status].toLowerCase()}` : STAGE[document.status],
    previousVersionServing: reprocessing && document.isSearchable && document.status !== 'READY',
    retrying: inProgress && !!document.statusMessage,
  };
}

/** §4.1.2: failure codes a retry cannot fix. The set is open; anything else may be retried. */
const PERMANENT_FAILURES: ReadonlySet<string> = new Set([
  'DOCUMENT_EMPTY',
  'ENCRYPTED_DOCUMENT',
  'UNPARSEABLE_DOCUMENT',
  'TOO_MANY_CHUNKS',
  'UNSUPPORTED_FILE_TYPE',
  'DOCUMENT_TOO_LARGE',
  'CONTENT_MISSING',
  'CONTENT_INTEGRITY_FAILURE',
]);

export const retryCanHelp = (failureCode: string | null): boolean => !failureCode || !PERMANENT_FAILURES.has(failureCode);

export interface FailureHint {
  /** What the user can do about it, when there's something specific to say. */
  hint: string | null;
  /** Whether a retry (E74) is likely to help. */
  retryHelps: boolean;
  /** The failure will clear up by itself later (a service was down). */
  transient: boolean;
}

/** §4.1.2: `failureCode` only picks the hint; `statusMessage` is always what's shown. */
export function failureHint(failureCode: string | null): FailureHint {
  switch (failureCode) {
    case 'DOCUMENT_EMPTY':
      return { hint: 'Upload a text-based PDF or Word document instead of a scan.', retryHelps: false, transient: false };
    case 'ENCRYPTED_DOCUMENT':
    case 'UNPARSEABLE_DOCUMENT':
    case 'TOO_MANY_CHUNKS':
    case 'UNSUPPORTED_FILE_TYPE':
    case 'DOCUMENT_TOO_LARGE':
      return { hint: 'Fix the file, delete this document and upload it again.', retryHelps: false, transient: false };
    case 'AI_SERVICE_UNAVAILABLE':
    case 'VECTOR_STORE_UNAVAILABLE':
    case 'OBJECT_STORAGE_UNAVAILABLE':
      return { hint: 'A service was down. Retrying later usually works.', retryHelps: true, transient: true };
    case 'INGESTION_TIMEOUT':
      return { hint: 'The file took longer than the 30-minute budget. Consider splitting it.', retryHelps: true, transient: false };
    case 'CONTENT_MISSING':
    case 'CONTENT_INTEGRITY_FAILURE':
      return { hint: 'The stored file is gone or damaged. Delete this document and upload it again.', retryHelps: false, transient: false };
    default:
      return { hint: null, retryHelps: retryCanHelp(failureCode), transient: false };
  }
}

/**
 * The ingestion stages of the mockup's "RAG pipeline status" panel (§6.3). Its third
 * step, PII masking, is not one of them: masking happens when text is sent to a model.
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

/**
 * TanStack Query `refetchInterval` for the vault list and the detail (§10.3): no polling
 * when nothing is in progress; faster while statuses are moving.
 */
export function pollInterval(
  documents: ReadonlyArray<Pick<VaultDocument, 'status' | 'lastStatusAt'>>,
  now = Date.now(),
): number | false {
  const moving = documents.filter((document) => isInProgress(document.status));
  if (moving.length === 0) return false;
  const newest = Math.max(...moving.map((document) => Date.parse(document.lastStatusAt)));
  const age = now - newest;
  if (age < 60_000) return 2_000;
  if (age < 600_000) return 5_000;
  return 15_000;
}

/** The lifecycle order, for sorting and comparisons. */
export const STATUS_ORDER: readonly DocumentStatus[] = ['UPLOADED', 'PARSING', 'CHUNKING', 'EMBEDDING', 'READY', 'FAILED'];
