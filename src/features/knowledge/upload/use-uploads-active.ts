import { useMemo } from 'react';
import { useUploadQueue } from '@/lib/knowledge/app-upload-queue';
import { itemsOfWorkspace, summarizeUploads } from '@/lib/knowledge/upload-queue';
import { useWorkspace } from '@/features/workspaces/workspace-context';

/** Whether this workspace has uploads in flight, for the sidebar's marker. */
export function useUploadsActive(): { active: boolean; progress: number } {
  const workspace = useWorkspace();
  const items = useUploadQueue((state) => state.items);
  return useMemo(() => {
    const summary = summarizeUploads(itemsOfWorkspace(items, workspace.id));
    return { active: summary.active, progress: summary.progress };
  }, [items, workspace.id]);
}
