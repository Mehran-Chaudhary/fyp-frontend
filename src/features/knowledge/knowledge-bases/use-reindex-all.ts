import { useState } from 'react';
import { documentsApi } from '@/lib/api/endpoints';
import { hasCode } from '@/lib/api/errors';
import type { KnowledgeBase, VaultDocument } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { runSequentially } from '@/lib/knowledge/bulk';
import { retryCanHelp } from '@/lib/knowledge/status';
import { queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast, toastError } from '@/lib/toast';
import { pluralize } from '@/lib/utils';
import { useWorkspace } from '@/features/workspaces/workspace-context';

/** Every document of a base that can be reindexed now: READY, or FAILED where a retry can help. */
async function reindexable(workspaceId: string, knowledgeBaseId: string): Promise<{ targets: VaultDocument[]; busy: number }> {
  const targets: VaultDocument[] = [];
  let busy = 0;
  for (let page = 1; page <= 100; page += 1) {
    const result = await documentsApi.list(workspaceId, { knowledgeBaseId, page, limit: 100, sortBy: 'createdAt', sortDirection: 'ASC' });
    for (const document of result.items) {
      if (document.status === 'READY' || (document.status === 'FAILED' && retryCanHelp(document.failureCode))) targets.push(document);
      else if (document.status !== 'FAILED') busy += 1;
    }
    if (!result.pagination.hasNextPage) break;
  }
  return { targets, busy };
}

/**
 * "Reindex all documents in this knowledge base" (§4.2), after its chunk settings
 * change: a loop over E74, one call at a time, at most four per second.
 */
export function useReindexAll(knowledgeBase: Pick<KnowledgeBase, 'id' | 'name'>) {
  const workspace = useWorkspace();
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (running) return;
    setRunning(true);
    const toastId = toast.loading(`Finding ${knowledgeBase.name}'s documents…`);
    try {
      const { targets, busy } = await reindexable(workspace.id, knowledgeBase.id);
      if (targets.length === 0) {
        toast.info('Nothing to reindex', {
          id: toastId,
          description: busy ? `${pluralize(busy, 'document')} ${busy === 1 ? 'is' : 'are'} already processing.` : 'There are no processed documents in it yet.',
        });
        return;
      }
      const outcome = await runSequentially(targets, (document) => documentsApi.reindex(workspace.id, document.id), {
        stopOn: (error) => hasCode(error, 'RATE_LIMIT_EXCEEDED', 'KNOWLEDGE_LAYER_NOT_CONFIGURED', 'PERMISSION_DENIED', 'KNOWLEDGE_BASE_ACCESS_DENIED'),
        onProgress: (done, total) => {
          if (done < total) toast.loading(`Reindexing ${done + 1} of ${total}…`, { id: toastId });
        },
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.documents(workspace.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBases(workspace.id) });

      const done = outcome.succeeded.length;
      // A document that started processing meanwhile answers 409: it's being done anyway.
      const alreadyBusy = outcome.failed.filter((failure) => hasCode(failure.error, 'DOCUMENT_PROCESSING')).length;
      const failed = outcome.failed.length - alreadyBusy;
      if (failed === 0 && !outcome.stoppedBy) {
        toast.success(`Reindexing ${pluralize(done + alreadyBusy, 'document')} in ${knowledgeBase.name}`, {
          id: toastId,
          description: 'Current versions keep answering searches until the new ones are ready.',
        });
      } else {
        toast.warning(`Reindexed ${done} of ${targets.length} documents`, {
          id: toastId,
          description: outcome.stoppedBy
            ? `Stopped early: ${messageFor(outcome.stoppedBy)}`
            : `${pluralize(failed, 'document')} couldn't be reindexed.`,
          duration: 12_000,
        });
      }
    } catch (error) {
      toast.dismiss(toastId);
      toastError(error, "Couldn't reindex");
    } finally {
      setRunning(false);
    }
  };

  return { run: () => void run(), running };
}
