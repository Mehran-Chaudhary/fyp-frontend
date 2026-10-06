import { createStore, type StoreApi } from 'zustand/vanilla';
import { isApiError } from '../api/errors';
import type { UploadDocumentFields, VaultDocument } from '../api/types';
import { createEmitter } from '../events';
import { messageFor } from '../errors';
import { describeUploadError, type UploadErrorView } from './upload-errors';
import { rateLimitOfError, type UploadOptions, type UploadResult } from './upload';

/**
 * The upload queue (Phase 3 spec §5 "Upload"). Files are sent one request each, at
 * most two at a time. It lives outside React so uploads carry on when the dialog is
 * closed or the user moves to another page; the vault shows their progress.
 *
 *  - 202: the file is stored and queued for processing; the table picks it up.
 *  - `x-ratelimit-remaining` reaching 0 holds the rest until the hourly budget
 *    refills (`x-ratelimit-reset`); a 429 requeues the file after `Retry-After`.
 *  - An error that would fail every other file too (quota, permission, the knowledge
 *    layer, a base that's gone) stops the files still waiting, with the reason.
 *  - No usable answer (a dropped connection, a timeout, a 5xx): the file may have
 *    been stored, so it is never resent automatically. It waits as "unknown" until
 *    the user checks the vault; only when it isn't there is sending again offered.
 *
 * Each item belongs to the workspace it was queued in, captured at that moment.
 * File objects stay in memory only; nothing here touches storage.
 */

export const MAX_PARALLEL_UPLOADS = 2;

export type UploadItemStatus = 'queued' | 'uploading' | 'done' | 'failed' | 'cancelled' | 'unknown' | 'checking';

export interface UploadItem {
  id: string;
  batchId: string;
  workspaceId: string;
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  file: File;
  fields: UploadDocumentFields;
  status: UploadItemStatus;
  /** 0…1 of the bytes sent. */
  progress: number;
  error: UploadErrorView | null;
  requestId: string | null;
  document: VaultDocument | null;
  /** The document was found by checking the vault after an unknown outcome. */
  foundByCheck: boolean;
  /** How many times it was sent (a 429 or a retry sends it again). */
  attempts: number;
  addedAt: number;
  /** When the last attempt was sent (epoch ms): the check looks for documents created since. */
  sentAt: number | null;
}

export interface QueueHold {
  /** Epoch ms when sending resumes. */
  until: number;
  reason: 'rate-limit';
}

export interface UploadQueueState {
  items: UploadItem[];
  /** Per workspace: sending is held (the hourly upload budget is spent). */
  holds: Record<string, QueueHold>;
  /** Per workspace: uploads left this hour, from the last answer. */
  remaining: Record<string, number>;
}

export interface NewUpload {
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  file: File;
  fields: UploadDocumentFields;
}

export interface UploadQueueDeps {
  upload: (options: UploadOptions) => Promise<UploadResult>;
  /** Looks for the document an unknown upload may have created: null when it isn't there. */
  findUploaded: (item: UploadItem) => Promise<VaultDocument | null>;
  /** A file was stored: refresh the table and the bases' stats. */
  onUploaded: (workspaceId: string, document: VaultDocument) => void;
  /** An answer says the bases or your permissions changed. */
  onRefetch: (workspaceId: string, what: 'knowledge-bases' | 'permissions') => void;
  /** The server says the knowledge layer isn't configured. */
  onLayerMissing: (workspaceId: string, missing: string[]) => void;
  now?: () => number;
  newId?: () => string;
}

type Controllers = Map<string, AbortController>;

export const uploadEvents = createEmitter<{
  /** Every file of a batch has finished, one way or another. */
  'batch-settled': { batchId: string; workspaceId: string; done: number; failed: number; cancelled: number; unknown: number };
}>();

const isActive = (status: UploadItemStatus) => status === 'queued' || status === 'uploading' || status === 'checking';

export function createUploadQueue(deps: UploadQueueDeps) {
  const now = deps.now ?? (() => Date.now());
  const newId =
    deps.newId ??
    (() => {
      try {
        return crypto.randomUUID();
      } catch {
        return `u-${now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      }
    });

  const store: StoreApi<UploadQueueState> = createStore<UploadQueueState>(() => ({ items: [], holds: {}, remaining: {} }));
  const controllers: Controllers = new Map();
  const lastProgressAt = new Map<string, number>();
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;

  const find = (id: string) => store.getState().items.find((item) => item.id === id);
  const patch = (id: string, change: Partial<UploadItem>) =>
    store.setState((state) => ({ items: state.items.map((item) => (item.id === id ? { ...item, ...change } : item)) }));

  const settledBatches = new Set<string>();
  function checkBatch(batchId: string) {
    if (settledBatches.has(batchId)) return;
    const items = store.getState().items.filter((item) => item.batchId === batchId);
    if (items.length === 0 || items.some((item) => isActive(item.status))) return;
    settledBatches.add(batchId);
    uploadEvents.emit('batch-settled', {
      batchId,
      workspaceId: items[0].workspaceId,
      done: items.filter((item) => item.status === 'done').length,
      failed: items.filter((item) => item.status === 'failed').length,
      cancelled: items.filter((item) => item.status === 'cancelled').length,
      unknown: items.filter((item) => item.status === 'unknown').length,
    });
  }

  function scheduleResume() {
    if (resumeTimer !== null) clearTimeout(resumeTimer);
    resumeTimer = null;
    const holds = Object.values(store.getState().holds);
    if (holds.length === 0) return;
    const next = Math.min(...holds.map((hold) => hold.until));
    resumeTimer = setTimeout(
      () => {
        resumeTimer = null;
        const at = now();
        store.setState((state) => ({
          holds: Object.fromEntries(Object.entries(state.holds).filter(([, hold]) => hold.until > at)),
        }));
        pump();
      },
      Math.max(0, next - now()),
    );
  }

  /** Holds sending in a workspace; `exact` (a server's Retry-After) replaces a guessed hold. */
  function hold(workspaceId: string, until: number, exact = false) {
    store.setState((state) => {
      const current = state.holds[workspaceId];
      if (!exact && current && current.until >= until) return state;
      return { holds: { ...state.holds, [workspaceId]: { until, reason: 'rate-limit' } } };
    });
    scheduleResume();
  }

  function isHeld(workspaceId: string): boolean {
    const current = store.getState().holds[workspaceId];
    return !!current && current.until > now();
  }

  /** Starts files until two are in flight. */
  function pump() {
    const { items } = store.getState();
    let active = items.filter((item) => item.status === 'uploading').length;
    for (const item of items) {
      if (active >= MAX_PARALLEL_UPLOADS) break;
      if (item.status !== 'queued' || isHeld(item.workspaceId)) continue;
      active += 1;
      void start(item);
    }
  }

  /** Stops the files still waiting in the same scope as a failure that would fail them too. */
  function stopWaiting(failed: UploadItem, message: string) {
    const sameBase = failed.error?.refetch === 'knowledge-bases';
    store.setState((state) => ({
      items: state.items.map((item) =>
        item.status === 'queued' &&
        item.workspaceId === failed.workspaceId &&
        (!sameBase || item.knowledgeBaseId === failed.knowledgeBaseId)
          ? // Never sent, so sending it later is safe.
            { ...item, status: 'failed', error: { message: `Not sent: ${message}`, retryable: true } }
          : item,
      ),
    }));
  }

  async function start(item: UploadItem) {
    const controller = new AbortController();
    controllers.set(item.id, controller);
    patch(item.id, { status: 'uploading', progress: 0, error: null, attempts: item.attempts + 1, sentAt: now() });

    try {
      const result = await deps.upload({
        workspaceId: item.workspaceId,
        knowledgeBaseId: item.knowledgeBaseId,
        file: item.file,
        fields: item.fields,
        signal: controller.signal,
        onProgress: (fraction) => {
          // At most ten updates a second per file.
          const at = now();
          if (fraction < 1 && at - (lastProgressAt.get(item.id) ?? 0) < 100) return;
          lastProgressAt.set(item.id, at);
          patch(item.id, { progress: fraction });
        },
      });
      patch(item.id, { status: 'done', progress: 1, document: result.document, error: null });
      noteRateLimit(item.workspaceId, result.remaining, result.resetAt);
      deps.onUploaded(item.workspaceId, result.document);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        patch(item.id, { status: 'cancelled', progress: 0 });
      } else {
        handleFailure(item, error);
      }
    } finally {
      controllers.delete(item.id);
      lastProgressAt.delete(item.id);
      checkBatch(item.batchId);
      pump();
    }
  }

  function noteRateLimit(workspaceId: string, remaining: number | null, resetAt: number | null) {
    if (remaining === null) return;
    store.setState((state) => ({ remaining: { ...state.remaining, [workspaceId]: remaining } }));
    // The hourly budget is spent: hold the rest until it refills.
    if (remaining <= 0) hold(workspaceId, resetAt && resetAt > now() ? resetAt : now() + 60_000);
  }

  function handleFailure(item: UploadItem, error: unknown) {
    const view = describeUploadError(error);
    const requestId = isApiError(error) ? (error.requestId ?? null) : null;
    const rateLimit = rateLimitOfError(error);

    if (view.retryAfterSeconds !== undefined) {
      // 429: back in the queue, held until the server says it may try again. Its
      // Retry-After is exact, so it replaces any guess made from the headers.
      if (rateLimit.remaining !== null) {
        store.setState((state) => ({ remaining: { ...state.remaining, [item.workspaceId]: rateLimit.remaining as number } }));
      }
      patch(item.id, { status: 'queued', progress: 0, error: null, requestId });
      hold(item.workspaceId, now() + view.retryAfterSeconds * 1000, true);
      return;
    }
    noteRateLimit(item.workspaceId, rateLimit.remaining, rateLimit.resetAt);

    if (view.unknown) {
      patch(item.id, { status: 'unknown', progress: 0, error: view, requestId });
      // Without a connection the files still waiting would only fail the same way.
      if (isApiError(error) && error.code === 'NETWORK_ERROR') {
        stopWaiting({ ...item, error: view }, 'the connection dropped.');
      }
      return;
    }

    patch(item.id, { status: 'failed', progress: 0, error: view, requestId });
    if (view.layerMissing) deps.onLayerMissing(item.workspaceId, view.layerMissing);
    if (view.refetch) deps.onRefetch(item.workspaceId, view.refetch);
    if (view.stopQueue) stopWaiting({ ...item, error: view }, view.message);
  }

  /** Stops one file: aborts it mid-transfer, or takes it out of the queue. */
  function cancel(itemId: string) {
    const item = find(itemId);
    if (!item) return;
    if (item.status === 'uploading') controllers.get(itemId)?.abort();
    else if (item.status === 'queued') {
      patch(itemId, { status: 'cancelled' });
      checkBatch(item.batchId);
    }
  }

  /**
   * Looks in the vault for a file whose upload got no answer (spec §5 step 7). Found:
   * it was stored, and counts as uploaded. Not found: sending it again is safe, and
   * if it was stored after all the server answers 409 DOCUMENT_DUPLICATE.
   */
  async function check(itemId: string) {
    const item = find(itemId);
    if (!item || item.status !== 'unknown') return;
    settledBatches.delete(item.batchId);
    patch(itemId, { status: 'checking' });
    try {
      const document = await deps.findUploaded(item);
      if (document) {
        patch(itemId, { status: 'done', progress: 1, document, foundByCheck: true, error: null });
        deps.onUploaded(item.workspaceId, document);
      } else {
        patch(itemId, {
          status: 'failed',
          error: {
            message: "It isn't in the vault, so it wasn't stored. You can send it again.",
            retryable: true,
          },
        });
      }
    } catch (error) {
      patch(itemId, {
        status: 'unknown',
        error: { message: `Couldn't check the vault: ${messageFor(error)}`, unknown: true },
      });
    } finally {
      checkBatch(item.batchId);
    }
  }

  return {
    store,

    /** Adds files to the queue as one batch; returns the batch id. */
    enqueue(workspaceId: string, uploads: readonly NewUpload[]): string {
      const batchId = newId();
      const addedAt = now();
      const added: UploadItem[] = uploads.map((upload) => ({
        id: newId(),
        batchId,
        workspaceId,
        knowledgeBaseId: upload.knowledgeBaseId,
        knowledgeBaseName: upload.knowledgeBaseName,
        file: upload.file,
        fields: upload.fields,
        status: 'queued',
        progress: 0,
        error: null,
        requestId: null,
        document: null,
        foundByCheck: false,
        attempts: 0,
        addedAt,
        sentAt: null,
      }));
      store.setState((state) => ({ items: [...state.items, ...added] }));
      pump();
      return batchId;
    },

    cancel,
    check: (itemId: string) => void check(itemId),

    /** Stops every unfinished file of a batch. */
    cancelBatch(batchId: string) {
      for (const item of store.getState().items) {
        if (item.batchId === batchId) cancel(item.id);
      }
    },

    /** Checks every unknown file of a workspace. */
    checkAll(workspaceId: string) {
      for (const item of store.getState().items) {
        if (item.workspaceId === workspaceId && item.status === 'unknown') void check(item.id);
      }
    },

    /** Sends a failed or cancelled file again. An unknown one must be checked first. */
    retry(itemId: string) {
      const item = find(itemId);
      if (!item || (item.status !== 'failed' && item.status !== 'cancelled')) return;
      if (item.status === 'failed' && !item.error?.retryable) return;
      settledBatches.delete(item.batchId);
      patch(itemId, { status: 'queued', progress: 0, error: null, requestId: null });
      pump();
    },

    /** Removes finished files from view. */
    dismiss(itemIds: readonly string[]) {
      const ids = new Set(itemIds);
      store.setState((state) => ({
        items: state.items.filter((item) => !ids.has(item.id) || isActive(item.status)),
      }));
    },

    /** Sign-out: abort everything and forget the files. */
    reset() {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      if (resumeTimer !== null) clearTimeout(resumeTimer);
      resumeTimer = null;
      settledBatches.clear();
      store.setState({ items: [], holds: {}, remaining: {} });
    },

    /** Whether leaving the page would lose uploads. */
    hasUnfinished(): boolean {
      return store.getState().items.some((item) => item.status === 'queued' || item.status === 'uploading');
    },
  };
}

export type UploadQueue = ReturnType<typeof createUploadQueue>;

/** Items of one batch, or of one workspace, in the order they were added. */
export const itemsOfBatch = (items: readonly UploadItem[], batchId: string | null) =>
  batchId ? items.filter((item) => item.batchId === batchId) : [];

export const itemsOfWorkspace = (items: readonly UploadItem[], workspaceId: string) =>
  items.filter((item) => item.workspaceId === workspaceId);

export interface UploadSummary {
  total: number;
  done: number;
  failed: number;
  cancelled: number;
  uploading: number;
  queued: number;
  /** No answer arrived: to be checked before anything is resent. */
  unknown: number;
  /** 0…1 over the files still counted (cancelled ones are left out). */
  progress: number;
  active: boolean;
}

export function summarizeUploads(items: readonly UploadItem[]): UploadSummary {
  const counted = items.filter((item) => item.status !== 'cancelled');
  const count = (...statuses: UploadItemStatus[]) => items.filter((item) => statuses.includes(item.status)).length;
  const uploading = count('uploading');
  const queued = count('queued');
  const progress = counted.length
    ? counted.reduce((sum, item) => sum + (item.status === 'uploading' || item.status === 'queued' ? item.progress : 1), 0) / counted.length
    : 0;
  return {
    total: items.length,
    done: count('done'),
    failed: count('failed'),
    cancelled: items.length - counted.length,
    uploading,
    queued,
    unknown: count('unknown', 'checking'),
    progress,
    active: uploading + queued > 0,
  };
}

/**
 * Whether a listed document is the one an unknown upload created: same base, same
 * size, the stored file name (or the title it was given), created after it was sent
 * (with two minutes' allowance for clock skew between browser and server).
 */
export function matchesUpload(
  document: Pick<VaultDocument, 'knowledgeBaseId' | 'sizeBytes' | 'originalFilename' | 'title' | 'createdAt'>,
  upload: { knowledgeBaseId: string; size: number; filename: string; title: string; sentAt: number | null },
): boolean {
  if (document.knowledgeBaseId !== upload.knowledgeBaseId) return false;
  if (document.sizeBytes !== String(upload.size)) return false;
  if (document.originalFilename !== upload.filename && document.title !== upload.title) return false;
  if (upload.sentAt !== null) {
    const created = Date.parse(document.createdAt);
    if (Number.isFinite(created) && created < upload.sentAt - 2 * 60_000) return false;
  }
  return true;
}
