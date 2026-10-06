import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, ChevronLeft, ChevronRight, Eye, EyeOff, Info, ScanEye, ShieldAlert, ShieldOff, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { EmptyState, ErrorState, RequestReference } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { piiApi } from '@/lib/api/endpoints';
import { hasCode, isApiError } from '@/lib/api/errors';
import type { ChunkPiiReport, DocumentPiiReport, PiiEntityType, VaultDocument } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { reportPages } from '@/lib/knowledge/pii';
import { useCountdown } from '@/lib/hooks';
import { documentPiiReportQuery } from '@/lib/queries';
import { cn, formatCountdown, pluralize } from '@/lib/utils';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { EntityCounts, MaskedText } from '../shared/masked-text';
import { useKnowledgeAccess } from '../shared/use-knowledge-access';
import { useEntityTypes, usePiiPolicy, useReportPolicyVersion } from '../shared/use-pii-policy';
import { useDocumentContext } from './document-context';

/** The report allows at most 20 chunks a page (P3-API-21: 21 → 422). */
const PAGE_SIZES = ['5', '10', '20'] as const;
/** Revealed values are hidden again after this long. */
const REVEAL_MS = 60_000;

interface Revealed {
  page: number;
  limit: number;
  report: DocumentPiiReport;
  expiresAt: number;
}

/**
 * The redaction report (spec §5 "Privacy settings and previews", P3-API-21): for
 * each chunk, exactly what a model would receive if it were retrieved. Real values
 * only for holders of pii:reveal, after a confirmation that the reveal is audited,
 * fetched outside the query cache and hidden again when the tab is hidden, the page
 * changes, or after 60 seconds.
 */
export function DocumentPiiTab() {
  const { document, knowledgeBase } = useDocumentContext();
  const workspace = useWorkspace();
  const access = useKnowledgeAccess();
  const allowed = access.can('piiReport', knowledgeBase);

  if (access.lacks('piiReport')) {
    return (
      <NoAccessState permissions={['document:read', 'pii:policy:read']} workspaceName={workspace.name} title="You can't open redaction reports" />
    );
  }
  if (!allowed) {
    return (
      <EmptyState
        icon={<ShieldOff />}
        title="You can't open this report"
        description={`Your access to ${knowledgeBase?.name ?? 'this knowledge base'} doesn't include redaction reports.`}
      />
    );
  }
  if (!document.isSearchable) {
    // A never-indexed document has an empty report (verified): nothing reaches a model.
    return (
      <EmptyState
        icon={<ScanEye />}
        title="Nothing to report yet"
        description={
          document.status === 'FAILED'
            ? 'The document never became searchable, so no model can receive any of it.'
            : 'The report appears once the document has been processed.'
        }
      />
    );
  }
  // Keyed by document so a different document never shows another's revealed values.
  return <Report key={document.id} document={document} />;
}

function Report({ document }: { document: VaultDocument }) {
  const workspace = useWorkspace();
  const access = useKnowledgeAccess();
  const can = useCan();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const policy = usePiiPolicy();
  const policyVersion = useReportPolicyVersion();
  const entityTypes = useEntityTypes();

  const report = useQuery({
    ...documentPiiReportQuery(workspace.id, document.id, {
      activeIndexVersion: document.activeIndexVersion,
      policyVersion: policyVersion.version,
      page,
      limit,
    }),
    enabled: policyVersion.settled,
    retry: false,
  });

  const reveal = useReveal(document.id);
  const shown = reveal.revealed?.page === page && reveal.revealed.limit === limit ? reveal.revealed.report : report.data;
  const canReveal = access.has('pii:reveal');
  const canEditPolicy = can('pii:policy:update');
  const [confirming, setConfirming] = useState(false);

  const goTo = (next: number, nextLimit = limit) => {
    // A reveal covers one page; moving on hides the values again.
    reveal.hide();
    setLimit(nextLimit);
    setPage(next);
  };

  if (report.isPending) {
    return (
      <div className="grid grid-cols-1 gap-3 px-5 py-5 sm:px-6">
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
        <ReportProblem
          error={report.error}
          failedAt={report.errorUpdatedAt}
          onRetry={() => void report.refetch()}
          retrying={report.isFetching}
          canEditPolicy={canEditPolicy}
          settingsTo={`/w/${workspace.slug}/settings/privacy`}
        />
      </div>
    );
  }

  const data = shown ?? report.data;
  const pages = reportPages(data.totalChunks, limit);

  return (
    <div className="grid grid-cols-1 gap-4 px-5 py-5 sm:px-6">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-ink">What an AI model receives</h3>
            <p className="mt-0.5 text-[13px] text-muted">
              Personal data is replaced with numbered placeholders when text is sent to a model, under this workspace's policy
              {policy.data ? <span className="tabular"> (version {policy.data.version})</span> : null}.
            </p>
          </div>
          {canReveal ? (
            <RevealToggle reveal={reveal} onRequest={() => setConfirming(true)} />
          ) : null}
        </div>
        {data.entityCount > 0 ? (
          <div className="grid gap-1.5">
            <EntityCounts byType={data.byType} labels={entityTypes.byType} />
            <p className="text-xs text-faint">{pluralize(data.entityCount, 'detection')} on this page · counts cover these chunks only.</p>
          </div>
        ) : null}
      </header>

      {policy.data && !policy.data.enabled ? (
        <Callout
          tone="warning"
          icon={<ShieldOff className="size-4" />}
          title="Redaction is turned off for this workspace"
          action={canEditPolicy ? <SettingsLink to={`/w/${workspace.slug}/settings/privacy`} /> : null}
        >
          Models receive this text unmasked, so the report shows no detections.
        </Callout>
      ) : null}
      {data.degraded ? (
        <Callout tone="warning" icon={<TriangleAlert className="size-4" />} title="Name detection is unavailable">
          The policy allows pattern-only masking while it's down: emails, phone numbers, card numbers and the like are masked, but
          names, places and organisations pass through.
        </Callout>
      ) : null}
      {data.revealed ? (
        <Callout tone="warning" icon={<Eye className="size-4" />} role="status">
          Real values are shown for this page. They are kept on this screen only and hide again in{' '}
          <span className="tabular">{formatCountdown(reveal.remaining)}</span>.
        </Callout>
      ) : null}
      {reveal.error ? (
        <Callout tone="danger" title="Couldn't reveal the values">
          {hasCode(reveal.error, 'PERMISSION_DENIED') ? 'Revealing real values needs pii:reveal, which your role no longer has.' : messageFor(reveal.error)}
          {isApiError(reveal.error) ? <RequestReference requestId={reveal.error.requestId} className="mt-1 block" /> : null}
        </Callout>
      ) : null}

      {data.chunks.length === 0 ? (
        <EmptyState icon={<ScanEye />} title="Nothing to report" description="This page has no chunks." />
      ) : (
        <ol className="grid gap-3">
          {data.chunks.map((chunk) => (
            <ChunkReport key={chunk.chunkId} chunk={chunk} labels={entityTypes.byType} revealed={data.revealed} />
          ))}
        </ol>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-[13px] text-muted">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 tabular">
          Page {page} of {pages} · {pluralize(data.totalChunks, 'chunk')}
          {data.timings ? <span className="text-faint">· masked in {Math.round(data.timings.totalMs)} ms</span> : null}
        </span>
        <span className="flex items-center gap-2">
          <Select
            size="sm"
            aria-label="Chunks per page"
            value={String(limit) as (typeof PAGE_SIZES)[number]}
            onValueChange={(value) => goTo(1, Number(value))}
            options={PAGE_SIZES.map((size) => ({ value: size, label: `${size} a page` }))}
            className="w-28"
          />
          {pages > 1 ? (
            <>
              <Button variant="secondary" size="sm" disabled={page <= 1 || report.isFetching} onClick={() => goTo(page - 1)} aria-label="Previous page">
                <ChevronLeft />
                <span className="hidden sm:inline">Previous</span>
              </Button>
              <Button variant="secondary" size="sm" disabled={page >= pages || report.isFetching} onClick={() => goTo(page + 1)} aria-label="Next page">
                <span className="hidden sm:inline">Next</span>
                <ChevronRight />
              </Button>
            </>
          ) : null}
        </span>
      </footer>
      <p className="-mt-2 text-[11.5px] text-faint">
        Reports and the analysis preview share a budget of 30 a minute, so the report pages with buttons.
      </p>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        icon={<Eye />}
        tone="warning"
        size="md"
        title="Show the real values?"
        description={
          <>
            The values behind every placeholder on this page will be shown. Each reveal is recorded in the audit log as a
            critical event, with your name.
          </>
        }
        confirmLabel="Reveal values"
        confirmVariant="primary"
        onConfirm={() => {
          setConfirming(false);
          reveal.show(page, limit);
        }}
      >
        <p className="text-[13px] leading-relaxed text-muted">
          They stay on this screen only: never saved, and hidden again after a minute, when you change page, or when you leave
          this tab.
        </p>
      </ConfirmDialog>
    </div>
  );
}

function SettingsLink({ to }: { to: string }) {
  return (
    <Button asChild size="xs" variant="secondary">
      <Link to={to}>
        Privacy settings
        <ArrowUpRight />
      </Link>
    </Button>
  );
}

function ChunkReport({
  chunk,
  labels,
  revealed,
}: {
  chunk: ChunkPiiReport;
  labels: ReadonlyMap<string, PiiEntityType>;
  revealed: boolean;
}) {
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

/** The report's refusals, each in its own words (spec §10). */
function ReportProblem({
  error,
  failedAt,
  onRetry,
  retrying,
  canEditPolicy,
  settingsTo,
}: {
  error: unknown;
  /** When the query failed (epoch ms): the Retry-After countdown starts there. */
  failedAt: number;
  onRetry: () => void;
  retrying: boolean;
  canEditPolicy: boolean;
  settingsTo: string;
}) {
  const retryIn = useCountdown(hasCode(error, 'RATE_LIMIT_EXCEEDED') ? failedAt + (error.retryAfterSeconds ?? 60) * 1000 : null);

  if (hasCode(error, 'PII_DETECTION_UNAVAILABLE')) {
    const hint = typeof error.details?.hint === 'string' ? error.details.hint : null;
    return (
      <Callout
        tone="warning"
        icon={<ShieldAlert className="size-4" />}
        title="Sensitive-data detection is unavailable"
        action={
          <div className="flex flex-wrap gap-2">
            <Button size="xs" variant="secondary" onClick={onRetry} loading={retrying}>
              Try again
            </Button>
            {canEditPolicy ? <SettingsLink to={settingsTo} /> : null}
          </div>
        }
      >
        Name detection is down and this workspace's policy refuses to produce unprotected text, so the report can't be made
        right now.
        {canEditPolicy ? (
          <span className="mt-1.5 block text-[12.5px] opacity-90">
            The policy can instead mask patterns only while it's down. That keeps the report working but lets names, places and
            organisations through.
            {hint ? ` ${hint}` : null}
          </span>
        ) : null}
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
        Reports and analysis previews are limited to 30 a minute.{' '}
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
  show: (page: number, limit: number) => void;
  hide: () => void;
  remaining: number;
}

/**
 * Real values, only on request. They're fetched outside the query cache and kept in
 * this component's state alone (spec §9.2), hidden again when the tab is hidden or
 * after 60 seconds, and dropped with the component. Every reveal is a CRITICAL audit
 * record on the server.
 */
function useReveal(documentId: string): RevealState {
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

  const show = async (page: number, limit: number) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      const report = await piiApi.documentReport(workspace.id, documentId, { page, limit, reveal: true }, controller.signal);
      if (controller.signal.aborted) return;
      setRevealed({ page, limit, report, expiresAt: Date.now() + REVEAL_MS });
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
      if (window.document.visibilityState === 'hidden') {
        request.current?.abort();
        setRevealed(null);
      }
    };
    window.document.addEventListener('visibilitychange', onVisibility);
    return () => window.document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // And dropped when the report goes away.
  useEffect(() => {
    const inFlight = request;
    return () => inFlight.current?.abort();
  }, []);

  const remaining = useCountdown(revealed?.expiresAt ?? null, () => setRevealed(null));

  return { revealed, pending, error, show: (page, limit) => void show(page, limit), hide, remaining };
}

function RevealToggle({ reveal, onRequest }: { reveal: RevealState; onRequest: () => void }) {
  const on = !!reveal.revealed;
  return (
    <div className={cn('grid gap-1 rounded-lg border px-3 py-2', on ? 'border-warning-200 bg-warning-50' : 'border-line bg-well/40')}>
      {on ? (
        <Button size="xs" variant="secondary" onClick={reveal.hide}>
          <EyeOff />
          Hide values · <span className="tabular">{formatCountdown(reveal.remaining)}</span>
        </Button>
      ) : (
        <Button size="xs" variant="secondary" onClick={onRequest} loading={reveal.pending}>
          {reveal.pending ? null : <Eye />}
          Show real values…
        </Button>
      )}
      <p className="flex items-center gap-1.5 text-[11.5px] text-muted">
        <Info className="size-3 shrink-0" aria-hidden />
        Each reveal is audited as a critical event.
      </p>
    </div>
  );
}
