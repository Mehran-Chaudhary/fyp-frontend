import { useStore } from 'zustand';
import { authEvents } from '../api/token-manager';
import { queryKeys } from '../queries';
import { queryClient } from '../query-client';
import { refreshMyAccess } from '../workspace/cache';
import { afterUpload } from './cache';
import { recordLayerGap } from './layer';
import { uploadDocument } from './upload';
import { createUploadQueue, type UploadQueueState } from './upload-queue';

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

export const uploadQueue = createUploadQueue({
  upload: uploadDocument,
  onUploaded: refreshSoon,
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
