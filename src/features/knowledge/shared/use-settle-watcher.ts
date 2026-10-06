import { useEffect, useRef } from 'react';
import type { VaultDocument } from '@/lib/api/types';
import { afterProcessingSettled, settledDocuments } from '@/lib/knowledge/cache';
import { useWorkspace } from '@/features/workspaces/workspace-context';

/**
 * §9.3: when a poll shows documents leaving the in-progress states, the
 * knowledge bases' stats changed and the documents' chunks now exist (or are a
 * new version), so refresh those too.
 */
export function useSettleWatcher(documents: readonly Pick<VaultDocument, 'id' | 'status'>[] | undefined): void {
  const workspace = useWorkspace();
  const previous = useRef<Map<string, VaultDocument['status']>>(new Map());

  useEffect(() => {
    if (!documents) return;
    const settled = settledDocuments(previous.current, documents);
    // Keep what we knew about rows that left the page, so a row coming back isn't mistaken for new.
    const next = new Map(previous.current);
    for (const document of documents) next.set(document.id, document.status);
    previous.current = next;
    if (settled.length) void afterProcessingSettled(workspace.id, settled);
  }, [documents, workspace.id]);
}
