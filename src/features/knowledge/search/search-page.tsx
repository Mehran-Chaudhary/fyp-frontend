import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChevronDown,
  CircleAlert,
  CornerDownLeft,
  Gauge,
  Library,
  MessageSquareText,
  RefreshCw,
  Search,
  SearchX,
  ServerCrash,
  Timer,
} from 'lucide-react';
import { useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { EmptyState, PageHeader, RequestReference } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CheckboxBox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Kbd, Skeleton } from '@/components/ui/misc';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Segmented } from '@/components/ui/segmented';
import { Tooltip } from '@/components/ui/tooltip';
import { isApiError } from '@/lib/api/errors';
import type { AccessScope, RetrievalMode, RetrievalQuery, RetrievalResponse } from '@/lib/api/types';
import { useCountdown, useDocumentTitle, useNow } from '@/lib/hooks';
import { queryKeys, ragScopeQuery } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { cn, pluralize, timestamp } from '@/lib/utils';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { KnowledgeBaseDot } from '../shared/kb-identity';
import { classificationLabel, queryTerms } from '../shared/meta';
import { KnowledgeLayerBanner } from '../shared/states';
import { useKnowledgeBases, useLayerGap } from '../shared/use-knowledge-access';
import { clearHandedOffQuery, peekHandedOffQuery } from './handoff';
import { AccessScopePanel } from './access-scope-panel';
import { PassageCard } from './passage-card';
import { describeRetrievalError, useRetrieval, type RetrievalProblem } from './use-retrieval';

/** The deployment default (RAG_MAX_QUERY_LENGTH), after whitespace collapses. The server has the final word. */
const QUERY_MAX = 2000;
/** topK is accepted up to 200 and capped by the deployment (50 by default). */
const TOP_K_MAX = 50;
const KB_FILTER_MAX = 50;

type RerankChoice = 'default' | 'on' | 'off';

/** The retrieval playground (Phase 3 spec §5 "Retrieval playground"). Also where the vault's "Ask" continues. */
export function SearchPage() {
  const workspace = useWorkspace();
  const can = useCan();
  useDocumentTitle('Search');

  if (!can('rag:query')) {
    return (
      <Card>
        <NoAccessState permissions={['rag:query']} workspaceName={workspace.name} title="You can't search documents" />
      </Card>
    );
  }
  return <Playground />;
}

const collapse = (value: string) => value.replace(/\s+/g, ' ').trim();

function Playground() {
  const workspace = useWorkspace();
  const layer = useLayerGap();
  const scope = useQuery(ragScopeQuery(workspace.id));
  const retrieval = useRetrieval();
  const [handoff] = useState(() => peekHandedOffQuery(workspace.id));

  // The question stays out of the URL (spec §9.2): questions can be sensitive.
  const [question, setQuestion] = useState(handoff?.query ?? '');
  const [knowledgeBaseIds, setKnowledgeBaseIds] = useState<string[]>(handoff?.knowledgeBaseIds ?? []);
  const [topK, setTopK] = useState('8');
  const [mode, setMode] = useState<RetrievalMode>('hybrid');
  const [minScore, setMinScore] = useState('');
  const [rerank, setRerank] = useState<RerankChoice>('default');
  const [asked, setAsked] = useState<{ body: RetrievalQuery; startedAt: number } | null>(null);
  const [problem, setProblem] = useState<RetrievalProblem | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null);
  const blockedFor = useCountdown(blockedUntil, () => setBlockedUntil(null));

  const query = collapse(question);
  const topKValue = Number(topK);
  const topKValid = Number.isInteger(topKValue) && topKValue >= 1 && topKValue <= TOP_K_MAX;
  const minScoreValue = minScore.trim() === '' ? undefined : Number(minScore);
  const minScoreValid = minScoreValue === undefined || (Number.isFinite(minScoreValue) && minScoreValue >= 0 && minScoreValue <= 1);
  const searchBlocked = layer.blocked('search');

  const run = (body: RetrievalQuery) => {
    setProblem(null);
    setQueryError(null);
    setAsked({ body, startedAt: timestamp() });
    retrieval.mutate(body, {
      onError: (error) => {
        const described = describeRetrievalError(error);
        setProblem(described);
        if (described.queryError) setQueryError(described.queryError);
        if (described.retryAt) setBlockedUntil(described.retryAt);
        if (described.goneKnowledgeBaseIds?.length) {
          // Drop the bases that are gone, and refresh what you can reach.
          const gone = new Set(described.goneKnowledgeBaseIds);
          setKnowledgeBaseIds((current) => current.filter((id) => !gone.has(id)));
          void queryClient.invalidateQueries({ queryKey: queryKeys.ragScope(workspace.id) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBases(workspace.id) });
        }
      },
    });
  };

  const submit = () => {
    if (!query) {
      setQueryError('Ask a question first.');
      return;
    }
    if (query.length > QUERY_MAX) {
      setQueryError(`Use no more than ${QUERY_MAX.toLocaleString()} characters.`);
      return;
    }
    if (!topKValid || !minScoreValid || retrieval.isPending || blockedFor > 0 || searchBlocked) return;
    run({
      query,
      ...(knowledgeBaseIds.length ? { knowledgeBaseIds } : {}),
      topK: topKValue,
      mode,
      ...(mode === 'dense' && minScoreValue !== undefined ? { minScore: minScoreValue } : {}),
      ...(rerank === 'default' ? {} : { rerank: rerank === 'on' }),
    });
  };

  // A question handed over from the vault's "Ask" runs once, straight away. It is
  // scheduled rather than run inline so a remount (StrictMode's rehearsal) cancels
  // the first attempt instead of the search.
  const runHandoff = useEffectEvent(() => {
    if (!handoff) return;
    clearHandedOffQuery();
    run({
      query: handoff.query,
      ...(handoff.knowledgeBaseIds.length ? { knowledgeBaseIds: handoff.knowledgeBaseIds } : {}),
      topK: 8,
    });
  });
  useEffect(() => {
    if (!handoff) return;
    const timer = window.setTimeout(runHandoff, 0);
    return () => window.clearTimeout(timer);
  }, [handoff]);

  const result = retrieval.data;

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        overline={
          <Link to={`/w/${workspace.slug}/documents`} className="inline-flex items-center gap-1 rounded-sm hover:text-ink">
            <ArrowLeft className="size-3.5" />
            Document Vault
          </Link>
        }
        title="Search"
        description="Ask a question and see exactly which passages retrieval returns, from the knowledge bases you're allowed to read. This is what an agent is given to answer from."
      />

      <KnowledgeLayerBanner />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] 2xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="grid min-w-0 gap-4">
          <Card>
            <form
              noValidate
              className="grid gap-4 p-4 sm:p-5"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <Field
                label="Question"
                error={queryError ?? undefined}
                labelAside={
                  <span className={cn('text-xs tabular', query.length > QUERY_MAX ? 'text-danger-700' : 'text-faint')}>
                    {query.length.toLocaleString()}/{QUERY_MAX.toLocaleString()}
                  </span>
                }
              >
                <Textarea
                  value={question}
                  onChange={(event) => {
                    setQuestion(event.target.value);
                    setQueryError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      submit();
                    }
                  }}
                  rows={3}
                  className="min-h-20 text-[14px]"
                  placeholder="How many days of annual leave do new employees get?"
                  autoFocus={!handoff}
                />
              </Field>

              <div className="flex flex-wrap items-end gap-3">
                <KnowledgeBasePicker
                  scope={scope.data?.knowledgeBases ?? []}
                  selected={knowledgeBaseIds}
                  onChange={setKnowledgeBaseIds}
                  loading={scope.isPending}
                />
                <Field label="Results" className="w-24" error={topKValid ? undefined : `1 to ${TOP_K_MAX}`}>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={TOP_K_MAX}
                    value={topK}
                    onChange={(event) => setTopK(event.target.value)}
                    inputClassName="h-9 font-mono tabular"
                  />
                </Field>
                <div className="grid gap-1.5">
                  <span className="text-[13px] font-medium text-ink-soft">Mode</span>
                  <Segmented
                    aria-label="Retrieval mode"
                    value={mode}
                    onValueChange={setMode}
                    options={[
                      { value: 'hybrid', label: 'Keyword + meaning' },
                      { value: 'dense', label: 'Meaning only' },
                    ]}
                  />
                </div>
                {mode === 'dense' ? (
                  <Field label="Min. similarity" className="w-32" error={minScoreValid ? undefined : '0 to 1'}>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={1}
                      step={0.05}
                      value={minScore}
                      onChange={(event) => setMinScore(event.target.value)}
                      placeholder="None"
                      inputClassName="h-9 font-mono tabular"
                    />
                  </Field>
                ) : null}
                <div className="grid gap-1.5">
                  <span className="text-[13px] font-medium text-ink-soft">Rerank</span>
                  <Segmented
                    aria-label="Rerank"
                    value={rerank}
                    onValueChange={setRerank}
                    options={[
                      { value: 'default', label: 'Default' },
                      { value: 'on', label: 'On' },
                      { value: 'off', label: 'Off' },
                    ]}
                  />
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <span className="hidden items-center gap-1 text-xs text-faint sm:inline-flex">
                    <Kbd>Ctrl</Kbd>
                    <Kbd>
                      <CornerDownLeft className="size-3" />
                    </Kbd>
                  </span>
                  <Button type="submit" loading={retrieval.isPending} disabled={searchBlocked || blockedFor > 0 || !topKValid || !minScoreValid}>
                    {retrieval.isPending ? null : <Search />}
                    Search
                  </Button>
                </div>
              </div>
              <p className="-mt-1 text-xs leading-relaxed text-muted">
                {mode === 'hybrid'
                  ? 'Keyword + meaning always returns the best passages it has, even when none is really relevant: there is no relevance floor.'
                  : 'Meaning only ranks by similarity; a minimum similarity drops weak matches.'}{' '}
                Rerank “Default” follows this deployment's setting. Each search is recorded in the audit log, without the question.
              </p>
            </form>
          </Card>

          <Results
            asked={asked}
            pending={retrieval.isPending}
            result={result}
            problem={problem}
            blockedFor={blockedFor}
            error={retrieval.error}
            scope={scope.data}
            narrowed={knowledgeBaseIds.length > 0 || (mode === 'dense' && minScoreValue !== undefined)}
            onRetry={() => asked && run(asked.body)}
            onWiden={() => {
              setKnowledgeBaseIds([]);
              setMinScore('');
              if (asked) {
                const wider: RetrievalQuery = { ...asked.body };
                delete wider.knowledgeBaseIds;
                delete wider.minScore;
                run(wider);
              }
            }}
          />
        </div>

        <aside className="grid gap-4" aria-label="Your access">
          <AccessScopePanel scope={scope} />
        </aside>
      </div>
    </div>
  );
}

function KnowledgeBasePicker({
  scope,
  selected,
  onChange,
  loading,
}: {
  scope: ReadonlyArray<{ id: string; name: string }>;
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  loading: boolean;
}) {
  const names = scope.filter((knowledgeBase) => selected.includes(knowledgeBase.id));
  const label =
    selected.length === 0 ? 'All knowledge bases' : names.length === 1 ? names[0].name : pluralize(selected.length, 'knowledge base');
  const toggle = (id: string, checked: boolean) =>
    onChange(checked ? [...selected, id].slice(0, KB_FILTER_MAX) : selected.filter((candidate) => candidate !== id));

  return (
    <div className="grid gap-1.5">
      <span className="text-[13px] font-medium text-ink-soft">Search in</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="secondary" className="h-9 max-w-64 justify-between gap-2 font-normal" disabled={loading}>
            <Library className="text-faint" />
            <span className="truncate">{label}</span>
            <ChevronDown className="text-faint" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-1.5">
          <label
            className={cn(
              'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-well',
              selected.length === 0 ? 'font-medium text-ink' : 'text-ink-soft',
            )}
          >
            <CheckboxBox checked={selected.length === 0} onCheckedChange={() => onChange([])} className="mt-0" />
            Everything you can reach
          </label>
          <div className="my-1 h-px bg-line" />
          <ul className="scrollbar-thin max-h-64 overflow-y-auto">
            {scope.length === 0 ? <li className="px-2.5 py-2 text-[13px] text-muted">No knowledge bases to search.</li> : null}
            {scope.map((knowledgeBase) => {
              const checked = selected.includes(knowledgeBase.id);
              return (
                <li key={knowledgeBase.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-ink-soft hover:bg-well">
                    <CheckboxBox checked={checked} onCheckedChange={(next) => toggle(knowledgeBase.id, next)} className="mt-0" />
                    <KnowledgeBaseDot id={knowledgeBase.id} />
                    <span className="min-w-0 truncate">{knowledgeBase.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function Results({
  asked,
  pending,
  result,
  problem,
  blockedFor,
  error,
  scope,
  narrowed,
  onRetry,
  onWiden,
}: {
  asked: { body: RetrievalQuery; startedAt: number } | null;
  pending: boolean;
  result: RetrievalResponse | undefined;
  problem: RetrievalProblem | null;
  blockedFor: number;
  error: unknown;
  scope: AccessScope | undefined;
  narrowed: boolean;
  onRetry: () => void;
  onWiden: () => void;
}) {
  const now = useNow();
  const can = useCan();
  const query = asked?.body.query ?? '';
  const terms = queryTerms(query);

  if (pending) {
    const elapsed = asked ? Math.max(0, Math.round((now - asked.startedAt) / 1000)) : 0;
    return (
      <Card className="p-5">
        <p className="flex items-center gap-2 text-[13px] text-muted" aria-live="polite">
          <Timer className="size-4 text-faint" aria-hidden />
          Searching{elapsed >= 2 ? <span className="tabular"> · {elapsed} s</span> : '…'}
          {elapsed >= 10 ? <span className="text-faint"> The AI service can take a while; the server allows up to 60 s.</span> : null}
        </p>
        <div className="mt-4 grid gap-5">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex gap-3">
              <Skeleton className="size-6 rounded-full" />
              <div className="grid flex-1 gap-2">
                <Skeleton className="h-3.5 w-56" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-11/12" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (problem) {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-3" role="alert">
          <span
            className={cn(
              'inline-flex size-9 shrink-0 items-center justify-center rounded-lg border',
              problem.unavailable ? 'border-warning-200 bg-warning-50 text-warning-700' : 'border-danger-200 bg-danger-50 text-danger-600',
            )}
          >
            {problem.unavailable ? <ServerCrash className="size-4" aria-hidden /> : <CircleAlert className="size-4" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-ink">{problem.unavailable ? 'Search is temporarily unavailable' : "The search didn't run"}</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
              {problem.message}
              {problem.retryAt ? (
                blockedFor > 0 ? (
                  <span className="tabular"> Try again in {blockedFor} s.</span>
                ) : (
                  ' You can search again now.'
                )
              ) : null}
              {problem.retryable ? ' Your question and options are kept.' : null}
            </p>
            {problem.retryable && asked ? (
              <Button size="sm" variant="secondary" className="mt-3" onClick={onRetry}>
                <RefreshCw />
                Try again
              </Button>
            ) : null}
            {isApiError(error) ? <RequestReference requestId={error.requestId} className="mt-2 block w-fit" /> : null}
          </div>
        </div>
      </Card>
    );
  }

  if (!result) {
    return (
      <Card>
        <EmptyState
          icon={<MessageSquareText />}
          title="Ask about your documents"
          description="Results show each passage with its source, classification and rank. Scores only compare passages within one search."
        />
      </Card>
    );
  }

  if (result.results.length === 0) {
    return (
      <Card>
        <EmptyExplanation result={result} scope={scope} narrowed={narrowed} onWiden={onWiden} />
      </Card>
    );
  }

  const topScore = result.results[0]?.score ?? 0;
  const requestedTopK = asked?.body.topK;
  return (
    <Card className="overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-5 py-3">
        <p className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">“{query}”</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="outline">{result.mode === 'hybrid' ? 'Keyword + meaning' : 'Meaning only'}</Badge>
          {result.reranked ? (
            <Badge tone="brand">
              <Gauge />
              Reranked
            </Badge>
          ) : (
            <Badge tone="neutral">Not reranked</Badge>
          )}
          <Tooltip content="Your clearance in this workspace, and the one this search ran with (they differ when something narrowed it).">
            <Badge tone="neutral" tabIndex={0}>
              Clearance: {classificationLabel(result.clearance)}
              {result.effectiveClearance !== result.clearance ? ` → ${classificationLabel(result.effectiveClearance)}` : null}
            </Badge>
          </Tooltip>
        </div>
      </header>
      {requestedTopK !== undefined && result.topK < requestedTopK ? (
        <p className="border-b border-line bg-well/40 px-5 py-2 text-xs text-muted">
          You asked for {requestedTopK} results; this deployment caps a search at {result.topK}.
        </p>
      ) : null}
      <div className="divide-y divide-line/70 px-5">
        {result.results.map((passage) => (
          <PassageCard key={passage.chunkId} passage={passage} topScore={topScore} terms={terms} linkToDocument={can('document:read')} />
        ))}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-well/40 px-5 py-2.5 text-xs text-muted">
        <span className="tabular">
          {pluralize(result.results.length, 'passage')} from {pluralize(result.knowledgeBasesSearched, 'knowledge base')} searched ·{' '}
          <Timings result={result} />
        </span>
        <span className="font-mono text-[11px] text-faint" title="Identifies this search in the audit log">
          {result.embeddingModel} · {result.retrievalId.slice(0, 8)}
        </span>
      </footer>
    </Card>
  );
}

/**
 * Spec §4.7/§5: hybrid search has no relevance floor, so an empty answer means
 * nothing searchable was in scope, not "no good match". Say which.
 */
function EmptyExplanation({
  result,
  scope,
  narrowed,
  onWiden,
}: {
  result: RetrievalResponse;
  scope: AccessScope | undefined;
  narrowed: boolean;
  onWiden: () => void;
}) {
  const can = useCan();
  const knowledgeBases = useKnowledgeBases({ enabled: can('knowledgebase:read') });
  const reachable = new Set((scope?.knowledgeBases ?? []).map((knowledgeBase) => knowledgeBase.id));
  const inScope = knowledgeBases.list.filter((knowledgeBase) => reachable.has(knowledgeBase.id));
  const processing = inScope.reduce((sum, knowledgeBase) => sum + knowledgeBase.stats.processing, 0);
  const ready = inScope.reduce((sum, knowledgeBase) => sum + knowledgeBase.stats.ready, 0);

  const reasons: ReactNode[] = [];
  if (result.knowledgeBasesSearched === 0) {
    reasons.push(
      scope && scope.knowledgeBases.length === 0
        ? "You can't reach any knowledge base yet: none is open to the workspace or granted to you."
        : 'None of the knowledge bases searched could answer.',
    );
  }
  if (processing > 0) reasons.push(`${pluralize(processing, 'document')} in reach ${processing === 1 ? 'is' : 'are'} still processing and not searchable yet.`);
  if (knowledgeBases.data && ready === 0 && result.knowledgeBasesSearched > 0) {
    reasons.push(`No document within your clearance (${classificationLabel(result.clearance)}) is ready in the bases you can reach.`);
  }
  if (narrowed) reasons.push('The narrowing may be too tight: specific knowledge bases or a minimum similarity.');
  if (reasons.length === 0) reasons.push('Nothing searchable was in scope for this question.');

  return (
    <EmptyState
      icon={<SearchX />}
      title={
        result.knowledgeBasesSearched === 0
          ? 'Nothing to search'
          : `No passages from the ${pluralize(result.knowledgeBasesSearched, 'knowledge base')} searched`
      }
      description={
        <span className="grid gap-1 text-left">
          {reasons.map((reason, index) => (
            <span key={index} className="flex gap-1.5">
              <span aria-hidden>·</span>
              <span>{reason}</span>
            </span>
          ))}
        </span>
      }
      action={
        narrowed ? (
          <Button size="sm" variant="secondary" onClick={onWiden}>
            Search everything you can reach
          </Button>
        ) : null
      }
    />
  );
}

function Timings({ result }: { result: RetrievalResponse }) {
  const rows: Array<[string, number]> = [
    ['Access check', result.timings.accessMs],
    ['Embedding the question', result.timings.embedMs],
    ['Vector and keyword search', result.timings.searchMs],
    ['Loading passages', result.timings.hydrateMs],
    ['Reranking', result.timings.rerankMs],
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="rounded-sm underline decoration-line-strong decoration-dotted underline-offset-4 hover:text-ink">
          {Math.round(result.timings.totalMs)} ms
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="start">
        <p className="text-[11px] font-medium tracking-[0.08em] text-faint uppercase">Where the time went</p>
        <dl className="mt-2 grid gap-1 text-[12.5px]">
          {rows.map(([label, ms]) => (
            <div key={label} className="flex items-center justify-between gap-3">
              <dt className="text-muted">{label}</dt>
              <dd className="font-mono text-ink-soft tabular">{Math.round(ms)} ms</dd>
            </div>
          ))}
          <div className="mt-1 flex items-center justify-between gap-3 border-t border-line pt-1.5 font-medium">
            <dt className="text-ink">Total</dt>
            <dd className="font-mono text-ink tabular">{Math.round(result.timings.totalMs)} ms</dd>
          </div>
        </dl>
      </PopoverContent>
    </Popover>
  );
}
