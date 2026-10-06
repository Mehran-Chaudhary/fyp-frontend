import { useEffect, useRef, useState } from 'react';
import { documentsApi } from '@/lib/api/endpoints';
import { hasCode, isApiError, isOutcomeUnknown } from '@/lib/api/errors';
import type { KnowledgeBase, VaultDocument } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { runSequentially } from '@/lib/knowledge/bulk';
import { canReindexNow, retryCanHelp } from '@/lib/knowledge/status';
import { queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { useWorkspace } from '@/features/workspaces/workspace-context';

/** One document's part in a "reindex all" run. */
export type ReindexRowState = 'waiting' | 'running' | 'started' | 'busy' | 'gone' | 'unknown' | 'failed' | 'not-attempted';

export interface ReindexRow {
  document: VaultDocument;
  state: ReindexRowState;
  message?: string;
  requestId?: string;
}

export interface ReindexPlan {
  /** READY, or FAILED where a retry can help. */
  targets: VaultDocument[];
  /** Already processing: they'll pick up the new settings anyway. */
  busy: number;
  /** FAILED for a reason a retry can't fix: left alone unless included. */
  permanent: VaultDocument[];
}

export type ReindexPhase = 'idle' | 'planning' | 'planned' | 'running' | 'done';

/** Errors after which every remaining call would fail too. */
const STOP_CODES = ['PERMISSION_DENIED', 'KNOWLEDGE_LAYER_NOT_CONFIGURED', 'KNOWLEDGE_BASE_NOT_FOUND', 'KNOWLEDGE_BASE_ACCESS_DENIED'] as const;

/** Every document of the base you can see, sorted into what a reindex can and can't take. */
async function plan(workspaceId: string, knowledgeBaseId: string, signal: AbortSignal): Promise<ReindexPlan> {
  const targets: VaultDocument[] = [];
  const permanent: VaultDocument[] = [];
  let busy = 0;
  for (let page = 1; page <= 100; page += 1) {
    const result = await documentsApi.list(
      workspaceId,
      { knowledgeBaseId, page, limit: 100, sortBy: 'createdAt', sortDirection: 'ASC' },
      signal,
    );
    for (const document of result.items) {
      if (!canReindexNow(document)) busy += 1;
      else if (document.status === 'FAILED' && !retryCanHelp(document.failureCode)) permanent.push(document);
      else targets.push(document);
    }
    if (!result.pagination.hasNextPage) break;
  }
  return { targets, busy, permanent };
}

/**
 * "Reindex all documents" (spec §4.5): there is no bulk endpoint (P3-G08), so this
 * is an explicit loop over P3-API-15, one call at a time, with every document's
 * outcome. A 429 pauses the run for its Retry-After; a lost answer is reported, not
 * repeated; documents already processing answer 409 and are counted as such.
 */
export function useReindexAll(knowledgeBase: Pick<KnowledgeBase, 'id' | 'name'>) {
  const workspace = useWorkspace();
  // Planning starts as soon as the hook mounts (the dialog opening).
  const [phase, setPhase] = useState<ReindexPhase>('planning');
  const [attempt, setAttempt] = useState(0);
  const [planned, setPlanned] = useState<ReindexPlan | null>(null);
  const [rows, setRows] = useState<ReindexRow[]>([]);
  const [planError, setPlanError] = useState<unknown>(null);
  const [stoppedBy, setStoppedBy] = useState<unknown>(null);
  const [waitingUntil, setWaitingUntil] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);

  // Lists the documents; a remount (or StrictMode's rehearsal) aborts the old request and starts afresh.
  useEffect(() => {
    const listing = new AbortController();
    plan(workspace.id, knowledgeBase.id, listing.signal).then(
      (result) => {
        if (listing.signal.aborted) return;
        setPlanned(result);
        setPhase('planned');
      },
      (error: unknown) => {
        if (listing.signal.aborted) return;
        setPlanError(error);
        setPhase('idle');
      },
    );
    return () => listing.abort();
  }, [workspace.id, knowledgeBase.id, attempt]);

  // A run still going when the dialog unmounts stops after the current document.
  useEffect(() => {
    const current = controller;
    return () => current.current?.abort();
  }, []);

  /** Lists the documents again (after a failed listing). */
  const prepare = () => {
    setPhase('planning');
    setPlanError(null);
    setStoppedBy(null);
    setRows([]);
    setAttempt((value) => value + 1);
  };

  const patchRow = (id: string, change: Partial<ReindexRow>) =>
    setRows((current) => current.map((row) => (row.document.id === id ? { ...row, ...change } : row)));

  const start = async (includePermanent: boolean) => {
    if (!planned) return;
    const documents = includePermanent ? [...planned.targets, ...planned.permanent] : planned.targets;
    if (documents.length === 0) return;
    const next = new AbortController();
    controller.current = next;
    setRows(documents.map((document) => ({ document, state: 'waiting' })));
    setPhase('running');
    setStoppedBy(null);

    const outcome = await runSequentially(
      documents,
      async (document) => {
        patchRow(document.id, { state: 'running' });
        return documentsApi.reindex(workspace.id, document.id);
      },
      {
        signal: next.signal,
        waitFor: (error) => (hasCode(error, 'RATE_LIMIT_EXCEEDED') ? (error.retryAfterSeconds ?? 60) * 1000 : null),
        onWait: setWaitingUntil,
        stopOn: (error) => hasCode(error, ...STOP_CODES),
        onItem: (document, result) => {
          if (result.ok) {
            patchRow(document.id, { state: 'started' });
            return;
          }
          const error = result.error;
          const requestId = isApiError(error) ? error.requestId : undefined;
          if (hasCode(error, 'DOCUMENT_PROCESSING')) patchRow(document.id, { state: 'busy', message: 'Already processing' });
          else if (hasCode(error, 'DOCUMENT_NOT_FOUND')) patchRow(document.id, { state: 'gone', message: "Deleted, or you can't see it any more" });
          else if (isOutcomeUnknown(error) && !hasCode(error, 'KNOWLEDGE_LAYER_NOT_CONFIGURED')) {
            patchRow(document.id, { state: 'unknown', message: 'No answer arrived: check its status before trying again', requestId });
          } else patchRow(document.id, { state: 'failed', message: messageFor(error), requestId });
        },
      },
    );

    setWaitingUntil(null);
    if (outcome.stoppedBy) setStoppedBy(outcome.stoppedBy);
    const skipped = new Set(outcome.skipped.map((document) => document.id));
    setRows((current) => current.map((row) => (skipped.has(row.document.id) ? { ...row, state: 'not-attempted' } : row)));
    setPhase('done');
    void queryClient.invalidateQueries({ queryKey: queryKeys.documents(workspace.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.document(workspace.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBases(workspace.id) });
  };

  const cancel = () => controller.current?.abort();


  return {
    phase,
    planned,
    rows,
    planError,
    stoppedBy,
    waitingUntil,
    prepare,
    start: (includePermanent: boolean) => void start(includePermanent),
    cancel,
  };
}

export type ReindexAll = ReturnType<typeof useReindexAll>;
