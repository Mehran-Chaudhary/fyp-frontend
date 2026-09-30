import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, Database, HardDrive, Layers, ScanText, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { Card } from '@/components/ui/card';
import { Overline, Skeleton } from '@/components/ui/misc';
import { Spinner } from '@/components/ui/spinner';
import { hasCode } from '@/lib/api/errors';
import type { KnowledgeBase, VaultDocument } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { formatBytes, sumBytes } from '@/lib/knowledge/files';
import { displayStatus, failureHint, pipelineStates, type IngestionStage, type StageState } from '@/lib/knowledge/status';
import { useDebouncedValue } from '@/lib/hooks';
import { documentPiiReportQuery } from '@/lib/queries';
import { cn, pluralize } from '@/lib/utils';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { EntityCounts, MaskedText } from '../shared/masked-text';
import { useKnowledgeAccess } from '../shared/use-knowledge-access';

function PanelTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="grid gap-0.5 px-4 pt-4 pb-3">
      <Overline>{children}</Overline>
      {aside ? <p className="truncate text-[13px] font-medium text-ink-soft">{aside}</p> : null}
    </div>
  );
}

// ── RAG pipeline status (§6.3) ──────────────────────────────────────────────

interface PipelinePanelProps {
  document: VaultDocument | null;
  knowledgeBase: KnowledgeBase | null;
  /** The workspace's default chunk size (E25), when readable. */
  workspaceChunkSize: number | null;
  counts: { pending: number; indexing: number; failed: number };
  piiReportTo: string | null;
}

export function PipelinePanel({ document, knowledgeBase, workspaceChunkSize, counts, piiReportTo }: PipelinePanelProps) {
  const chunkSize = knowledgeBase?.chunkSize ?? workspaceChunkSize;
  const model = document?.embeddingModel ?? knowledgeBase?.embeddingModel ?? null;
  const states = document ? pipelineStates(document) : null;
  const status = document ? displayStatus(document) : null;
  const hint = document?.status === 'FAILED' ? failureHint(document.failureCode) : null;

  const stage = (key: IngestionStage) => states?.[key] ?? 'idle';

  return (
    <Card>
      <PanelTitle aside={document ? document.title : knowledgeBase ? knowledgeBase.name : 'Configuration'}>RAG pipeline status</PanelTitle>
      <ol className="relative px-4 pb-2">
        <Step index={1} state={stage('extract')} title="Text extraction" detail={document?.status === 'PARSING' && status?.retrying ? 'Retrying…' : undefined} />
        <Step index={2} state={stage('chunk')} title={`Chunking (${chunkSize ? `${chunkSize} tokens` : 'default size'})`} />
        <Step
          index={3}
          state="info"
          title="PII masked at query time"
          detail={
            piiReportTo ? (
              <Link to={piiReportTo} preventScrollReset className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline hover:underline-offset-4">
                See what a model receives
                <ArrowRight className="size-3" />
              </Link>
            ) : (
              'Personal data is replaced with placeholders before text reaches a model.'
            )
          }
        />
        <Step index={4} state={stage('embed')} title={`Embedding (${model ?? 'per knowledge base'})`} />
        <Step index={5} state={stage('store')} title="Vector store" detail={states?.store === 'done' ? 'Searchable' : undefined} last />
      </ol>

      {document ? (
        <div className="grid gap-2 border-t border-line px-4 py-3">
          {document.status === 'FAILED' ? (
            <div className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-xs leading-relaxed text-danger-700">
              <p className="font-medium">{document.statusMessage ?? 'Processing failed.'}</p>
              {hint?.hint ? <p className="mt-0.5 opacity-90">{hint.hint}</p> : null}
            </div>
          ) : status?.retrying && document.statusMessage ? (
            <p className="flex items-start gap-1.5 text-xs leading-relaxed text-warning-700">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {document.statusMessage}
            </p>
          ) : null}
          {status?.previousVersionServing ? (
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <ShieldCheck className="size-3.5 shrink-0 text-success-600" aria-hidden />
              Previous version still searchable
            </p>
          ) : document.status === 'UPLOADED' ? (
            <p className="text-xs text-muted">Stored and encrypted; waiting for a worker.</p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-3 text-xs text-muted">
          <Count label="Pending" value={counts.pending} />
          <Count label="Indexing" value={counts.indexing} tone={counts.indexing ? 'text-info-700' : undefined} />
          <Count label="Failed" value={counts.failed} tone={counts.failed ? 'text-danger-700' : undefined} />
          <span className="basis-full text-[11.5px] text-faint">In view. Select a document to follow it.</span>
        </div>
      )}
    </Card>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <span>
      {label} <span className={cn('font-mono font-medium text-ink-soft tabular', tone)}>{value}</span>
    </span>
  );
}

function Step({
  index,
  state,
  title,
  detail,
  last,
}: {
  index: number;
  state: StageState | 'idle' | 'info';
  title: string;
  detail?: ReactNode;
  last?: boolean;
}) {
  return (
    <li className="relative flex gap-3 pb-3.5 last:pb-2">
      {last ? null : <span className="absolute top-6 bottom-0 left-[11px] w-px bg-line" aria-hidden />}
      <StepMarker index={index} state={state} />
      <div className="min-w-0 pt-0.5">
        <p
          className={cn(
            'text-[13px] leading-5',
            state === 'failed' ? 'font-medium text-danger-700' : state === 'active' ? 'font-medium text-ink' : state === 'pending' ? 'text-muted' : 'text-ink-soft',
          )}
        >
          {title}
        </p>
        {detail ? <div className="mt-0.5 text-xs leading-relaxed text-muted">{detail}</div> : null}
      </div>
    </li>
  );
}

function StepMarker({ index, state }: { index: number; state: StageState | 'idle' | 'info' }) {
  const base = 'relative z-[1] inline-flex size-[23px] shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold';
  switch (state) {
    case 'done':
      return (
        <span className={cn(base, 'border-success-200 bg-success-50 text-success-600')}>
          <Check className="size-3.5" strokeWidth={2.75} aria-label="Done" />
        </span>
      );
    case 'active':
      return (
        <span className={cn(base, 'border-info-200 bg-info-50 text-info-600')}>
          <Spinner className="size-3.5" label="In progress" />
        </span>
      );
    case 'failed':
      return (
        <span className={cn(base, 'border-danger-200 bg-danger-50 text-danger-600')}>
          <X className="size-3.5" strokeWidth={2.75} aria-label="Failed" />
        </span>
      );
    case 'info':
      return (
        <span className={cn(base, 'border-brand-200 bg-brand-50 text-brand-700')}>
          <ShieldCheck className="size-3.5" aria-hidden />
        </span>
      );
    default:
      return <span className={cn(base, 'border-line-strong bg-surface text-faint', state === 'idle' && 'text-muted')}>{index}</span>;
  }
}

// ── Vault statistics (§6.1) ─────────────────────────────────────────────────

export function StatsPanel({
  knowledgeBases,
  focus,
  loading,
}: {
  knowledgeBases: readonly KnowledgeBase[];
  /** The knowledge base the vault is filtered to, if any. */
  focus: KnowledgeBase | null;
  loading: boolean;
}) {
  const scope = focus ? [focus] : knowledgeBases;
  const totals = scope.reduce(
    (sum, knowledgeBase) => ({
      documents: sum.documents + knowledgeBase.stats.documents,
      ready: sum.ready + knowledgeBase.stats.ready,
      processing: sum.processing + knowledgeBase.stats.processing,
      failed: sum.failed + knowledgeBase.stats.failed,
    }),
    { documents: 0, ready: 0, processing: 0, failed: 0 },
  );
  const bytes = sumBytes(scope.map((knowledgeBase) => knowledgeBase.stats.totalBytes));
  const other = Math.max(0, totals.documents - totals.ready - totals.processing - totals.failed);

  return (
    <Card>
      <PanelTitle aside={focus ? focus.name : pluralize(knowledgeBases.length, 'knowledge base')}>Vault statistics</PanelTitle>
      {loading ? (
        <div className="grid gap-2 px-4 pb-4">
          <Skeleton className="h-2 w-full rounded-full" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ) : (
        <div className="px-4 pb-4">
          <div className="flex h-2 overflow-hidden rounded-full bg-well-strong" aria-hidden>
            {totals.documents > 0 ? (
              <>
                <span className="bg-success-500" style={{ width: `${(totals.ready / totals.documents) * 100}%` }} />
                <span className="bg-info-500" style={{ width: `${(totals.processing / totals.documents) * 100}%` }} />
                <span className="bg-danger-500" style={{ width: `${(totals.failed / totals.documents) * 100}%` }} />
                <span className="bg-line-strong" style={{ width: `${(other / totals.documents) * 100}%` }} />
              </>
            ) : null}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            <Tile icon={<Database />} label="Documents" value={totals.documents.toLocaleString()} />
            <Tile icon={<Layers />} label="Indexed" value={totals.ready.toLocaleString()} dot="bg-success-500" />
            <Tile icon={<ScanText />} label="Processing" value={totals.processing.toLocaleString()} dot="bg-info-500" />
            <Tile icon={<TriangleAlert />} label="Failed" value={totals.failed.toLocaleString()} dot="bg-danger-500" warn={totals.failed > 0} />
          </dl>
          <div className="mt-2 flex items-center gap-3 rounded-lg border border-line bg-well/40 px-3 py-2.5">
            <HardDrive className="size-4 shrink-0 text-faint" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[11.5px] text-muted">Storage used</p>
              <p className="text-[11px] text-faint">in documents you can access</p>
            </div>
            <p className="font-mono text-[15px] font-medium text-ink tabular">{formatBytes(bytes)}</p>
          </div>
        </div>
      )}
    </Card>
  );
}

function Tile({ icon, label, value, dot, warn }: { icon: ReactNode; label: string; value: string; dot?: string; warn?: boolean }) {
  return (
    <div className={cn('rounded-lg border px-3 py-2.5', warn ? 'border-danger-200 bg-danger-50/50' : 'border-line bg-surface')}>
      <dt className="flex items-center gap-1.5 text-[11.5px] text-muted [&_svg]:size-3.5 [&_svg]:text-faint">
        {dot ? <span className={cn('size-1.5 rounded-full', dot)} aria-hidden /> : icon}
        {label}
      </dt>
      <dd className={cn('mt-0.5 font-mono text-lg leading-7 font-medium tabular', warn ? 'text-danger-700' : 'text-ink')}>{value}</dd>
    </div>
  );
}

// ── PII redaction preview (§6.1) ────────────────────────────────────────────

export function PiiPreviewPanel({ document, knowledgeBase }: { document: VaultDocument | null; knowledgeBase: KnowledgeBase | null }) {
  const workspace = useWorkspace();
  const access = useKnowledgeAccess();
  const location = useLocation();
  // Selecting rows quickly shouldn't spend the 30-per-minute report budget.
  const settledId = useDebouncedValue(document?.id ?? null, 350);
  const allowed = !!document && !!knowledgeBase && access.can('piiReport', knowledgeBase);
  const ready = allowed && document.isSearchable && settledId === document.id;

  const report = useQuery({
    ...documentPiiReportQuery(workspace.id, document?.id ?? '', 1, 5),
    enabled: ready,
    retry: false,
  });

  const first = report.data?.chunks.find((chunk) => chunk.entities.length > 0);
  const reportTo = document ? { pathname: `/w/${workspace.slug}/documents/${document.id}/pii`, search: location.search } : null;

  let body: ReactNode;
  if (!document) {
    body = <Hint>Personal data is masked before any model sees it. Select a document to preview.</Hint>;
  } else if (!allowed) {
    body = <Hint>You can't open PII reports for {knowledgeBase?.name ?? 'this knowledge base'}.</Hint>;
  } else if (!document.isSearchable) {
    body = <Hint>Nothing to report until the document is processed.</Hint>;
  } else if (!ready || report.isPending) {
    body = (
      <div className="grid gap-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    );
  } else if (report.isError) {
    body = (
      <Hint tone="warning">
        {hasCode(report.error, 'RATE_LIMIT_EXCEEDED')
          ? 'Report limit reached for this minute. Try again shortly.'
          : hasCode(report.error, 'PII_DETECTION_UNAVAILABLE')
            ? 'Sensitive-data detection is unavailable right now.'
            : messageFor(report.error)}
      </Hint>
    );
  } else if (!first) {
    body = (
      <Hint>
        No personal data found in the first {pluralize(report.data.chunks.length, 'chunk')}.{' '}
        {report.data.totalChunks > report.data.chunks.length ? 'The full report covers the rest.' : null}
      </Hint>
    );
  } else {
    body = (
      <div className="grid gap-2.5">
        <div className="relative max-h-36 overflow-hidden rounded-lg border border-line bg-[#fcfbf8] px-3 py-2.5">
          <MaskedText maskedText={first.maskedText} entities={first.entities} className="text-[12.5px] leading-[1.7]" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#fcfbf8] to-transparent" aria-hidden />
        </div>
        <EntityCounts byType={countByType(first.entities)} />
        {report.data.degraded ? (
          <p className="text-[11.5px] leading-snug text-warning-700">Name detection is unavailable: only patterns are masked right now.</p>
        ) : null}
      </div>
    );
  }

  return (
    <Card className="border-brand-200/70">
      <PanelTitle aside={document?.title}>
        <span className="inline-flex items-center gap-1.5 text-brand-700">
          <ShieldCheck className="size-3.5" aria-hidden />
          PII redaction preview
        </span>
      </PanelTitle>
      <div className="px-4 pb-4">{body}</div>
      {document && allowed && reportTo ? (
        <div className="border-t border-line px-4 py-2.5">
          <Link to={reportTo} preventScrollReset className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline hover:underline-offset-4">
            Open the full report
            <ArrowRight className="size-3" />
          </Link>
        </div>
      ) : (
        <p className="border-t border-line px-4 py-2.5 text-[11.5px] text-faint">Masked before LLM processing · unmasked only for authorised users</p>
      )}
    </Card>
  );
}

function countByType(entities: readonly { entityType: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entity of entities) counts[entity.entityType] = (counts[entity.entityType] ?? 0) + 1;
  return counts;
}

function Hint({ children, tone }: { children: ReactNode; tone?: 'warning' }) {
  return <p className={cn('text-[13px] leading-relaxed', tone === 'warning' ? 'text-warning-700' : 'text-muted')}>{children}</p>;
}
