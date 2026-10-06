import { useState } from 'react';
import { documentsApi } from '@/lib/api/endpoints';
import { hasCode, isApiError } from '@/lib/api/errors';
import type { Classification, KnowledgeBase, VaultDocument } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { runSequentially } from '@/lib/knowledge/bulk';
import { queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { isInProgress, retryCanHelp } from '@/lib/knowledge/status';
import { toast } from '@/lib/toast';
import { pluralize } from '@/lib/utils';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { classificationLabel } from '../shared/meta';
import { useKnowledgeAccess, useLayerGap } from '../shared/use-knowledge-access';

export type BulkKind = 'reindex' | 'reclassify' | 'delete';

const VERBS: Readonly<Record<BulkKind, { running: string; done: string; noun: string }>> = {
  reindex: { running: 'Reindexing', done: 'Reindexed', noun: 'reindex' },
  reclassify: { running: 'Reclassifying', done: 'Reclassified', noun: 'reclassify' },
  delete: { running: 'Deleting', done: 'Deleted', noun: 'delete' },
};

/** Errors that would fail every remaining call too: stop instead of hammering the server. */
const stopOn = (error: unknown) => hasCode(error, 'KNOWLEDGE_LAYER_NOT_CONFIGURED', 'PERMISSION_DENIED', 'NETWORK_ERROR');

/** A rate limit pauses the run for the server's Retry-After, then the same document is tried again. */
const waitFor = (error: unknown) => (hasCode(error, 'RATE_LIMIT_EXCEEDED') ? (error.retryAfterSeconds ?? 60) * 1000 : null);

/**
 * Bulk actions over the selected rows (§5 "Document Vault"). There are no bulk endpoints
 * (P3-G08): the single calls run one at a time at most four per second, a rate limit
 * pauses the run, rows the user can't act on are skipped, and failures are reported
 * per row at the end. Deletion and reclassification are never optimistic.
 */
export function useBulkActions(knowledgeBases: ReadonlyMap<string, KnowledgeBase>) {
  const workspace = useWorkspace();
  const access = useKnowledgeAccess();
  const layer = useLayerGap();
  const [running, setRunning] = useState<BulkKind | null>(null);

  const eligible = (kind: BulkKind, documents: readonly VaultDocument[]) =>
    documents.filter((document) => {
      const knowledgeBase = knowledgeBases.get(document.knowledgeBaseId);
      switch (kind) {
        case 'reindex':
          return (
            access.can('reindex', knowledgeBase) &&
            !layer.blocked('reindex') &&
            !isInProgress(document.status) &&
            (document.status !== 'FAILED' || retryCanHelp(document.failureCode))
          );
        case 'reclassify':
          return access.can('editDocument', knowledgeBase);
        case 'delete':
          return access.can('deleteDocument', knowledgeBase);
      }
    });

  const run = async (
    kind: BulkKind,
    documents: readonly VaultDocument[],
    options: { classification?: Classification } = {},
  ): Promise<{ succeeded: string[] }> => {
    const targets = eligible(kind, documents).filter(
      (document) => kind !== 'reclassify' || document.classification !== options.classification,
    );
    const skipped = documents.length - targets.length;
    const verbs = VERBS[kind];
    if (targets.length === 0) {
      toast.info(`Nothing to ${verbs.noun}`, {
        description:
          kind === 'reclassify'
            ? 'You can’t reclassify the selected documents, or they already have that classification.'
            : `You can't ${verbs.noun} any of the selected documents${kind === 'reindex' ? ' right now' : ''}.`,
      });
      return { succeeded: [] };
    }

    setRunning(kind);
    const toastId = toast.loading(`${verbs.running} 1 of ${targets.length}…`);
    const outcome = await runSequentially(
      targets,
      async (document) => {
        if (kind === 'reindex') {
          try {
            return await documentsApi.reindex(workspace.id, document.id);
          } catch (error) {
            // Started processing meanwhile: it'll be done anyway (409 DOCUMENT_PROCESSING).
            if (hasCode(error, 'DOCUMENT_PROCESSING')) return;
            throw error;
          }
        }
        if (kind === 'reclassify') return documentsApi.update(workspace.id, document.id, { classification: options.classification });
        try {
          return await documentsApi.remove(workspace.id, document.id);
        } catch (error) {
          // Already gone: that's what was asked for.
          if (hasCode(error, 'DOCUMENT_NOT_FOUND')) return;
          throw error;
        }
      },
      {
        stopOn,
        waitFor,
        onWait: (until) => {
          if (until) toast.loading(`Paused by the rate limit · resuming in ${Math.max(1, Math.ceil((until - Date.now()) / 1000))} s…`, { id: toastId });
        },
        onProgress: (done, total) => {
          if (done < total) toast.loading(`${verbs.running} ${done + 1} of ${total}…`, { id: toastId });
        },
      },
    );
    setRunning(null);

    if (kind === 'delete') {
      for (const document of outcome.succeeded) {
        queryClient.removeQueries({ queryKey: queryKeys.documentDetail(workspace.id, document.id) });
      }
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.documents(workspace.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBases(workspace.id) });
    if (kind === 'reclassify' || kind === 'reindex') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.document(workspace.id) });
    }

    const done = outcome.succeeded.length;
    const what = kind === 'reclassify' && options.classification ? ` as ${classificationLabel(options.classification)}` : '';
    const notes = [
      skipped ? `${pluralize(skipped, 'document')} skipped: you can't ${verbs.noun} ${skipped === 1 ? 'it' : 'them'}${kind === 'reindex' ? ' now' : ''}.` : null,
      outcome.stoppedBy ? `Stopped early: ${messageFor(outcome.stoppedBy)}` : null,
      outcome.skipped.length ? `${pluralize(outcome.skipped.length, 'document')} not attempted.` : null,
      ...outcome.failed
        .filter((failure) => failure.error !== outcome.stoppedBy)
        .slice(0, 3)
        .map((failure) => `“${failure.item.title}”: ${messageFor(failure.error)}`),
      outcome.failed.length > 3 ? `…and ${outcome.failed.length - 3} more.` : null,
    ].filter(Boolean);

    if (outcome.failed.length === 0 && !outcome.stoppedBy) {
      toast.success(`${verbs.done} ${pluralize(done, 'document')}${what}`, {
        id: toastId,
        description: notes.join(' ') || (kind === 'reindex' ? 'Current versions keep answering searches until the new ones are ready.' : undefined),
      });
    } else {
      const requestId = outcome.failed.map((failure) => (isApiError(failure.error) ? failure.error.requestId : undefined)).find(Boolean);
      toast.warning(`${verbs.done} ${done} of ${targets.length}${what}`, {
        id: toastId,
        description: `${notes.join(' ')}${requestId ? ` Reference: ${requestId.slice(0, 8)}` : ''}`,
        duration: 12_000,
      });
    }
    return { succeeded: outcome.succeeded.map((document) => document.id) };
  };

  return { run, running, eligible };
}
