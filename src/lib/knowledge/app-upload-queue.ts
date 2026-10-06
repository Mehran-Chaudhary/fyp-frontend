import { useStore } from 'zustand';
import { documentsApi } from '../api/endpoints';
import { authEvents } from '../api/token-manager';
import type { VaultDocument } from '../api/types';
import { queryKeys } from '../queries';
import { queryClient } from '../query-client';
import { refreshMyAccess } from '../workspace/cache';
import { afterUpload } from './cache';
import { defaultUploadTitle, sanitizeUploadFilename } from './files';
import { recordLayerGap } from './layer';
import { uploadDocument } from './upload';
import { createUploadQueue, matchesUpload, type UploadItem, type UploadQueueState } from './upload-queue';

/**
 * The app's one upload queue, wired to the API and the query cache. Finished
 * uploads refresh the vault at most about once a second, however many land.
 */

const pendingRefresh = new Map<string, ReturnType<typeof setTimeout>>();

function refreshSoon(workspaceId: string) {
  if (pendingRefresh.has(workspaceId)) return;
  pendingRefresh.set(
    workspaceId,
    setTimeout(() => {
      pendingRefresh.delete(workspaceId);
      void afterUpload(workspaceId);
    }, 800),
  );
}

/**
 * Spec §5 "Upload" step 7: refresh the list, searching by title, before offering a
 * retry. The newest documents of the base whose title contains the expected one are
 * compared by size, stored name and creation time.
 */
async function findUploaded(item: UploadItem): Promise<VaultDocument | null> {
  const filename = sanitizeUploadFilename(item.file.name);
  const title = item.fields.title?.trim() || defaultUploadTitle(item.file.name);
  const result = await documentsApi.list(item.workspaceId, {
    knowledgeBaseId: item.knowledgeBaseId,
    search: title.slice(0, 200),
    sortBy: 'createdAt',
    sortDirection: 'DESC',
    limit: 50,
  });
  return (
    result.items.find((document) =>
      matchesUpload(document, { knowledgeBaseId: item.knowledgeBaseId, size: item.file.size, filename, title, sentAt: item.sentAt }),
    ) ?? null
  );
}

export const uploadQueue = createUploadQueue({
  upload: uploadDocument,
  findUploaded,
  onUploaded: (workspaceId, document) => {
    // The 202 is the document as stored: the drawer can open it at once.
    queryClient.setQueryData(queryKeys.documentDetail(workspaceId, document.id), document);
    refreshSoon(workspaceId);
  },
  onRefetch: (workspaceId, what) => {
    if (what === 'permissions') void refreshMyAccess(workspaceId);
    else void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBases(workspaceId) });
  },
  onLayerMissing: (workspaceId, missing) => recordLayerGap(workspaceId, missing, 'upload'),
});

/**
 * The batch an open upload dialog is showing. When a batch finishes while its
 * dialog is closed, the app announces it with a toast instead.
 */
let visibleBatchId: string | null = null;

export function setVisibleBatch(batchId: string | null): void {
  visibleBatchId = batchId;
}

export function isBatchVisible(batchId: string): boolean {
  return visibleBatchId === batchId;
}

/** Subscribes a component to the queue. Select stable values (e.g. `state.items`), then derive. */
export function useUploadQueue<T>(selector: (state: UploadQueueState) => T): T {
  return useStore(uploadQueue.store, selector);
}

if (typeof window !== 'undefined') {
  // Signing out (in this tab or another) aborts uploads and forgets the files.
  authEvents.on('session-ended', () => uploadQueue.reset());

  // Closing or reloading the tab would abort uploads in flight: ask first.
  window.addEventListener('beforeunload', (event) => {
    if (uploadQueue.hasUnfinished()) event.preventDefault();
  });
}
