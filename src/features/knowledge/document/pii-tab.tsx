import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, EyeOff, Info, ScanEye, ShieldAlert, ShieldOff, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { NoAccessState } from '@/components/feedback/no-access';
import { EmptyState, ErrorState, RequestReference } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Skeleton } from '@/components/ui/misc';
import { Switch } from '@/components/ui/switch';
import { piiApi } from '@/lib/api/endpoints';
import { hasCode, isApiError } from '@/lib/api/errors';
import type { ChunkPiiReport, DocumentPiiReport, PiiEntityType } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { reportPages } from '@/lib/knowledge/pii';
import { useCountdown } from '@/lib/hooks';
import { documentPiiReportQuery, piiEntityTypesQuery, piiPolicyQuery } from '@/lib/queries';
import { cn, formatCountdown, pluralize } from '@/lib/utils';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { EntityCounts, MaskedText } from '../shared/masked-text';
import { useKnowledgeAccess } from '../shared/use-knowledge-access';
import { useDocumentContext } from './document-context';

const LIMIT = 10;
/** Revealed values are hidden again after this long (§6.5). */
const REVEAL_MS = 60_000;

interface Revealed {
  page: number;
  report: DocumentPiiReport;
  expiresAt: number;
}

/**
 * The PII report (§6.5, E78): for each chunk, exactly what a model would receive
 * if it were retrieved. Real values only for holders of pii:reveal, fetched outside
 * the query cache, hidden when the tab loses focus or after 60 seconds.
 */
export function DocumentPiiTab() {
  const { document, knowledgeBase } = useDocumentContext();
  const workspace = useWorkspace();
  const access = useKnowledgeAccess();
  const allowed = access.can('piiReport', knowledgeBase);

  if (access.lacks('piiReport')) {
    return <NoAccessState permissions={['pii:policy:read']} workspaceName={workspace.name} title="You can't open PII reports" />;
  }
  if (!allowed) {
    return (
      <EmptyState
        icon={<ShieldOff />}
        title="You can't open this report"
        description={`Your access to ${knowledgeBase?.name ?? 'this knowledge base'} doesn't include PII reports.`}
      />
    );
  }
  if (!document.isSearchable) {
    return (
      <EmptyState
        icon={<ScanEye />}
        title="Nothing to report yet"
        description={
          document.status === 'FAILED' ? 'The document never became searchable, so no model can receive it.' : 'Nothing to report until the document is processed.'
        }
      />
    );
  }
  // Keyed by document so a different document never shows another's revealed values.
  return <Report key={document.id} documentId={document.id} />;
}

function Report({ documentId }: { documentId: string }) {
  const workspace = useWorkspace();
  const access = useKnowledgeAccess();
  const [page, setPage] = useState(1);

  const report = useQuery({ ...documentPiiReportQuery(workspace.id, documentId, page, LIMIT), retry: false });
  const entityTypes = useQuery(piiEntityTypesQuery(workspace.id));
  const policy = useQuery(piiPolicyQuery(workspace.id));
  const labels = useMemo(
    () => new Map<string, PiiEntityType>((Array.isArray(entityTypes.data) ? entityTypes.data : []).map((type) => [type.type, type])),
    [entityTypes.data],
  );

  const reveal = useReveal(documentId, page);
  const shown = reveal.revealed?.page === page ? reveal.revealed.report : report.data;
  const canReveal = access.has('pii:reveal');

  const goTo = (next: number) => {
    // A reveal covers one page; moving on hides the values again.
    reveal.hide();
    setPage(next);
  };

  if (report.isPending) {
    return (
      <div className="grid gap-3 px-5 py-5 sm:px-6">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-6 w-72" />
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (report.isError) {
    return (
      <div className="px-5 py-5 sm:px-6">
        <ReportProblem error={report.error} failedAt={report.errorUpdatedAt} onRetry={() => void report.refetch()} retrying={report.isFetching} />
      </div>
    );
  }

  const data = shown ?? report.data;
  const pages = reportPages(data.totalChunks, LIMIT);

  return (
    <div className="grid gap-4 px-5 py-5 sm:px-6">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold text-ink">What an AI model sees</h3>
            <p className="mt-0.5 text-[13px] text-muted">
              Personal data is replaced with placeholders before text reaches a model.
            </p>
          </div>
          {canReveal ? <RevealToggle reveal={reveal} /> : null}
        </div>
        {data.entityCount > 0 ? (
          <div className="grid gap-1.5">
            <EntityCounts byType={data.byType} labels={labels} />
            <p className="text-xs text-faint">
              {pluralize(data.entityCount, 'detection')} · counts cover the chunks on this page.
            </p>
          </div>
        ) : null}
      </header>

      {policy.data && policy.data.enabled === false ? (
        <Callout tone="warning" icon={<ShieldOff className="size-4" />} title="PII redaction is turned off for this workspace">
          Models receive this text unmasked.
        </Callout>
      ) : null}
      {data.degraded ? (
        <Callout tone="warning" icon={<TriangleAlert className="size-4" />} title="Name detection is unavailable">
          Only patterns (emails, phone numbers, card numbers…) are masked right now. Names and places pass through.
        </Callout>
      ) : null}
      {reveal.error ? (
        <Callout tone="danger" title="Couldn't reveal the values">
          {messageFor(reveal.error)}
          {isApiError(reveal.error) ? <RequestReference requestId={reveal.error.requestId} className="mt-1 block" /> : null}
        </Callout>
      ) : null}

      {data.chunks.length === 0 ? (
        <EmptyState icon={<ScanEye />} title="Nothing to report" description="This page has no chunks." />
      ) : (
        <ol className="grid gap-3">
          {data.chunks.map((chunk) => (
            <ChunkReport key={chunk.chunkId} chunk={chunk} labels={labels} revealed={data.revealed} />
          ))}
        </ol>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-[13px] text-muted">
        <span className="tabular">
          Page {page} of {pages} · {pluralize(data.totalChunks, 'chunk')}
          {data.timings ? <span className="text-faint"> · masked in {Math.round(data.timings.totalMs)} ms</span> : null}
        </span>
        {pages > 1 ? (
          <span className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1 || report.isFetching} onClick={() => goTo(page - 1)} aria-label="Previous page">
              <ChevronLeft />
              <span className="hidden sm:inline">Previous</span>
            </Button>
            <Button variant="secondary" size="sm" disabled={page >= pages || report.isFetching} onClick={() => goTo(page + 1)} aria-label="Next page">
              <span className="hidden sm:inline">Next</span>
              <ChevronRight />
            </Button>
          </span>
        ) : null}
      </footer>
      <p className="-mt-2 text-[11.5px] text-faint">The report is limited to 30 pages a minute, so it pages with buttons.</p>
    </div>
  );
}

function ChunkReport({ chunk, labels, revealed }: { chunk: ChunkPiiReport; labels: ReadonlyMap<string, PiiEntityType>; revealed: boolean }) {
  return (
    <li>
      <article className={cn('rounded-lg border bg-surface', revealed ? 'border-warning-200' : 'border-line')}>
        <header className="flex items-center gap-2 border-b border-line/70 px-3.5 py-2 text-xs text-muted">
          <span className="font-mono font-semibold text-ink-soft tabular">#{chunk.chunkIndex}</span>
          {chunk.pageStart !== null ? (
            <>
              <span aria-hidden>·</span>
              <span>Page {chunk.pageStart}</span>
            </>
          ) : null}
          <span className="ml-auto">
            {chunk.entities.length ? (
              <span className="font-medium text-brand-700">{pluralize(chunk.entities.length, 'detection')}</span>
            ) : (
              <span className="text-faint">Nothing masked</span>
            )}
          </span>
        </header>
        <div className="px-3.5 py-3">
          <MaskedText maskedText={chunk.maskedText} entities={chunk.entities} labels={labels} revealed={revealed} />
        </div>
      </article>
    </li>
  );
}

/** §6.5's refusals, each in its own words. */
function ReportProblem({
  error,
  failedAt,
  onRetry,
  retrying,
}: {
  error: unknown;
  /** When the query failed (epoch ms): the Retry-After countdown starts there. */
  failedAt: number;
  onRetry: () => void;
  retrying: boolean;
}) {
  const access = useKnowledgeAccess();
  const retryIn = useCountdown(
    hasCode(error, 'RATE_LIMIT_EXCEEDED') ? failedAt + (error.retryAfterSeconds ?? 60) * 1000 : null,
  );

  if (hasCode(error, 'PII_DETECTION_UNAVAILABLE')) {
    const hint = typeof error.details?.hint === 'string' ? error.details.hint : null;
    return (
      <Callout
        tone="warning"
        icon={<ShieldAlert className="size-4" />}
        title="Sensitive-data detection is unavailable"
        action={
          <Button size="xs" variant="secondary" onClick={onRetry} loading={retrying}>
            Try again
          </Button>
        }
      >
        This workspace refuses to show unprotected text to models, so the report can't be produced right now. Try again later.
        {/* The hint is written for administrators (§6.5). */}
        {hint && access.has('pii:policy:update') ? <span className="mt-1.5 block text-[12.5px] opacity-90">{hint}</span> : null}
      </Callout>
    );
  }
  if (hasCode(error, 'RATE_LIMIT_EXCEEDED')) {
    return (
      <Callout
        tone="warning"
        title="Report limit reached"
        action={
          retryIn <= 0 ? (
            <Button size="xs" variant="secondary" onClick={onRetry} loading={retrying}>
              Load it now
            </Button>
          ) : null
        }
      >
        Reports are limited to 30 a minute.{' '}
        {retryIn > 0 ? <span className="tabular">Try again in {formatCountdown(retryIn)}.</span> : 'You can try again now.'}
      </Callout>
    );
  }
  return <ErrorState compact error={error} title="We couldn't load the report" onRetry={onRetry} retrying={retrying} />;
}

// ── Reveal (pii:reveal) ─────────────────────────────────────────────────────

interface RevealState {
  revealed: Revealed | null;
  pending: boolean;
  error: unknown;
  show: () => void;
  hide: () => void;
  remaining: number;
}

/**
 * Real values, only on request. They're fetched outside the query cache and kept in
 * this component's state alone (§10.2), hidden again when the tab loses focus or
 * after 60 seconds. Every reveal is a CRITICAL audit record on the server.
 */
function useReveal(documentId: string, page: number): RevealState {
  const workspace = useWorkspace();
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const request = useRef<AbortController | null>(null);

  const hide = () => {
    request.current?.abort();
    request.current = null;
    setRevealed(null);
    setPending(false);
  };

  const show = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      const report = await piiApi.documentReport(workspace.id, documentId, { page, limit: LIMIT, reveal: true }, controller.signal);
      if (controller.signal.aborted) return;
      setRevealed({ page, report, expiresAt: Date.now() + REVEAL_MS });
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  };

  // Hidden the moment the tab is hidden.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        request.current?.abort();
        setRevealed(null);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // And dropped when the report goes away.
  useEffect(() => {
    const inFlight = request;
    return () => inFlight.current?.abort();
  }, []);

  const remaining = useCountdown(revealed?.expiresAt ?? null, () => setRevealed(null));

  return { revealed, pending, error, show: () => void show(), hide, remaining };
}

function RevealToggle({ reveal }: { reveal: RevealState }) {
  const id = useId();
  const on = !!reveal.revealed || reveal.pending;
  return (
    <div className={cn('grid gap-1 rounded-lg border px-3 py-2', on ? 'border-warning-200 bg-warning-50' : 'border-line bg-well/40')}>
      <div className="flex items-center gap-2.5">
        <Switch id={id} checked={on} onCheckedChange={(next) => (next ? reveal.show() : reveal.hide())} disabled={reveal.pending} />
        <label htmlFor={id} className="cursor-pointer text-[13px] font-medium text-ink select-none">
          Show real values
        </label>
        {reveal.revealed ? (
          <span className="ml-1 inline-flex items-center gap-1 text-xs text-warning-700 tabular">
            <EyeOff className="size-3" aria-hidden />
            Hides in {formatCountdown(reveal.remaining)}
          </span>
        ) : null}
      </div>
      <p className="flex items-center gap-1.5 text-[11.5px] text-muted">
        <Info className="size-3 shrink-0" aria-hidden />
        Each reveal is recorded in the audit log as a critical event.
      </p>
    </div>
  );
}
