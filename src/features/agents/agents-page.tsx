import { useQuery } from '@tanstack/react-query';
import { BookOpenText, Bot, MessageSquareText, Plus, RotateCcw, Search, SearchX, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { EmptyState, ErrorState, PageHeader } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Pagination } from '@/components/ui/pagination';
import { RelativeTime } from '@/components/ui/relative-time';
import { Segmented } from '@/components/ui/segmented';
import type { AgentSummary, AgentVisibility } from '@/lib/api/types';
import { plainText } from '@/lib/agents/markdown';
import { useDocumentTitle } from '@/lib/hooks';
import { agentsQuery } from '@/lib/queries';
import { cn, pluralize } from '@/lib/utils';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { AgentAvatar, AgentStateBadges, ClearanceCeilingNote, ModelName } from './shared/agent-bits';
import { useAgentCan } from './shared/use-agent-can';

const PAGE_SIZE = 18;
type VisibilityFilter = 'all' | 'published' | 'drafts';
const VISIBILITY: Record<Exclude<VisibilityFilter, 'all'>, AgentVisibility> = { published: 'WORKSPACE', drafts: 'PRIVATE' };

/** The agent directory (Phase 4 spec §5.1, P4-API-01). */
export function AgentsPage() {
  const workspace = useWorkspace();
  const can = useAgentCan();
  useDocumentTitle('AI agents');
  if (!can.browseAgents) {
    return (
      <Card>
        <NoAccessState permissions={['agent:read']} workspaceName={workspace.name} title="You can't see agents" />
      </Card>
    );
  }
  return <Directory />;
}

function Directory() {
  const workspace = useWorkspace();
  const can = useAgentCan();
  const [params, setParams] = useSearchParams();
  const base = `/w/${workspace.slug}`;
  // Members only see published agents and their own drafts: the filter matters to managers and authors.
  const showFilter = can.manageAgents || can.createAgents;

  const q = (params.get('q') ?? '').slice(0, 200);
  const visibilityParam = params.get('show');
  const visibility: VisibilityFilter = showFilter && (visibilityParam === 'published' || visibilityParam === 'drafts') ? visibilityParam : 'all';
  const pageParam = Number.parseInt(params.get('page') ?? '', 10);
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;

  const write = (patch: { q?: string; show?: VisibilityFilter; page?: number }) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        const set = (key: string, value: string | null) => (value ? next.set(key, value) : next.delete(key));
        if (patch.q !== undefined) set('q', patch.q.trim() || null);
        if (patch.show !== undefined) set('show', patch.show === 'all' ? null : patch.show);
        set('page', patch.page && patch.page > 1 ? String(patch.page) : null);
        return next;
      },
      { replace: true, preventScrollReset: true },
    );

  // Name A→Z always: the list ignores sortBy, so no sort control is offered (P4-G08).
  const query = useQuery(
    agentsQuery(workspace.id, {
      page,
      limit: PAGE_SIZE,
      ...(q.trim() ? { search: q.trim() } : {}),
      ...(visibility !== 'all' ? { visibility: VISIBILITY[visibility] } : {}),
    }),
  );

  const [draft, setDraft] = useState(q);
  const [syncedQ, setSyncedQ] = useState(q);
  if (q !== syncedQ) {
    setSyncedQ(q);
    setDraft(q);
  }
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const pending = timer;
    return () => window.clearTimeout(pending.current);
  }, []);
  const onSearch = (value: string) => {
    setDraft(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => write({ q: value, show: visibility }), 300);
  };

  const items = query.data?.items ?? [];
  const total = query.data?.pagination.totalItems;
  const filtered = !!q.trim() || visibility !== 'all';

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="AI agents"
        description={
          <>
            Digital employees with a persona, instructions, a model and the knowledge they may use. An agent reads only what
            the person talking to it can read.
            {total !== undefined && !filtered ? <span className="text-ink-soft"> You can see {pluralize(total, 'agent')}.</span> : null}
          </>
        }
        actions={
          <>
            {can.chat && can.readOwnConversations ? (
              <Button asChild variant="secondary">
                <Link to={`${base}/chat`}>
                  <MessageSquareText />
                  Your conversations
                </Link>
              </Button>
            ) : null}
            {can.createAgents ? (
              <Button asChild>
                <Link to={`${base}/agents/new`}>
                  <Plus />
                  New agent
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <Input
          className="w-full sm:max-w-sm"
          leading={<Search />}
          value={draft}
          onChange={(event) => onSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && draft) onSearch('');
          }}
          placeholder="Search by name"
          aria-label="Search agents by name"
          maxLength={200}
          inputClassName="h-9"
          trailing={
            draft ? (
              <Button variant="ghost" size="icon-xs" className="text-faint" onClick={() => onSearch('')} aria-label="Clear search">
                <X />
              </Button>
            ) : null
          }
        />
        {showFilter ? (
          <Segmented
            aria-label="Show"
            className="sm:ml-auto"
            value={visibility}
            onValueChange={(next) => write({ show: next, q: draft })}
            options={[
              { value: 'all', label: 'All' },
              { value: 'published', label: 'Published' },
              { value: 'drafts', label: 'Drafts' },
            ]}
          />
        ) : null}
      </div>

      {query.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-56 rounded-xl" />
          ))}
        </div>
      ) : query.isError && !query.data ? (
        <Card>
          <ErrorState error={query.error} title="We couldn't load the agents" onRetry={() => void query.refetch()} retrying={query.isFetching} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          {filtered ? (
            <EmptyState
              icon={<SearchX />}
              title="No agents match"
              description={q.trim() ? `Nothing you can see is named like “${q.trim()}”.` : 'No agents in this view.'}
              action={
                <Button variant="secondary" size="sm" onClick={() => write({ q: '', show: 'all' })}>
                  <RotateCcw />
                  Clear filters
                </Button>
              }
            />
          ) : can.createAgents ? (
            <EmptyState
              icon={<Bot />}
              title="No agents yet"
              description="Create one for each job, such as an HR policy assistant that answers from the handbook. New agents start as private drafts."
              action={
                <Button asChild size="sm">
                  <Link to={`${base}/agents/new`}>
                    <Plus />
                    Create agent
                  </Link>
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Bot />}
              title="No agents have been published to you yet"
              description="Agents appear here once someone publishes one to the workspace or to one of your roles."
            />
          )}
        </Card>
      ) : (
        <ul className={cn('grid gap-4 md:grid-cols-2 2xl:grid-cols-3', query.isPlaceholderData && 'opacity-60 transition-opacity')}>
          {items.map((agent, index) => (
            <li key={agent.id} className="animate-rise" style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}>
              <AgentCard agent={agent} />
            </li>
          ))}
        </ul>
      )}

      {query.data && query.data.pagination.totalPages > 1 ? (
        <Pagination pagination={query.data.pagination} onPageChange={(next) => write({ page: next })} busy={query.isFetching} noun={['agent', 'agents']} />
      ) : null}

      <ClearanceCeilingNote />
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentSummary }) {
  const workspace = useWorkspace();
  const can = useAgentCan();
  const base = `/w/${workspace.slug}`;
  const href = `${base}/agents/${agent.id}`;

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card transition-[border-color,box-shadow] duration-200 hover:border-line-strong hover:shadow-[0_6px_20px_-10px_rgb(28_27_24/0.25)]">
      <div className="flex flex-1 flex-col gap-3 px-5 pt-5 pb-4">
        <div className="flex items-start gap-3">
          <AgentAvatar agent={agent} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] leading-6 font-semibold text-ink">
              <Link to={href} className="rounded-sm after:absolute after:inset-0 hover:text-brand-700 focus-visible:outline-offset-4">
                <span className="line-clamp-1 break-words">{agent.name}</span>
              </Link>
            </h2>
            <p className="line-clamp-1 text-[13px] text-muted">{agent.role ? capitalize(agent.role) : 'Assistant for this organisation'}</p>
          </div>
          <AgentStateBadges agent={agent} className="relative shrink-0 justify-end" />
        </div>

        {agent.greeting ? (
          <p className="line-clamp-2 rounded-lg border border-line/80 bg-well/50 px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
            “{plainText(agent.greeting)}”
          </p>
        ) : agent.description ? (
          <p className="line-clamp-2 text-[13px] leading-relaxed text-muted">{agent.description}</p>
        ) : (
          <p className="text-[13px] text-faint">No description.</p>
        )}

        <dl className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <div className="flex min-w-0 items-center gap-1">
            <dt className="sr-only">Model</dt>
            <dd className="min-w-0 truncate">
              <ModelName model={agent.model} className="text-[12px]" />
            </dd>
          </div>
          <div className="flex items-center gap-1">
            <BookOpenText className="size-3.5 text-faint" aria-hidden />
            <dt className="sr-only">Knowledge bases</dt>
            <dd>{agent.knowledgeBaseCount ? pluralize(agent.knowledgeBaseCount, 'knowledge base') : 'No knowledge'}</dd>
          </div>
        </dl>
      </div>
      <footer className="relative flex items-center justify-between gap-3 border-t border-line bg-well/40 px-5 py-2.5 text-xs text-muted">
        <span className="truncate">
          {agent.lastUsedAt ? (
            <>
              Used <RelativeTime value={agent.lastUsedAt} />
            </>
          ) : (
            'Not used yet'
          )}{' '}
          · v{agent.currentVersion}
        </span>
        {can.chat ? (
          <Button asChild size="xs" variant="secondary" className="relative z-[1]">
            <Link to={`${base}/chat/new?agent=${agent.id}`}>
              <MessageSquareText />
              Chat
            </Link>
          </Button>
        ) : null}
      </footer>
    </article>
  );
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
