import { useQuery } from '@tanstack/react-query';
import { ArrowRight, FolderPlus, Library, RotateCcw, Search, SearchX, X } from 'lucide-react';
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
import { Select } from '@/components/ui/select';
import type { KnowledgeBase, ListKnowledgeBasesParams } from '@/lib/api/types';
import { formatBytes } from '@/lib/knowledge/files';
import { useDocumentTitle } from '@/lib/hooks';
import { knowledgeBasesQuery } from '@/lib/queries';
import { cn, pluralize } from '@/lib/utils';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { AccessLevelBadge, AccessModeBadge, ClassificationBadge } from '../shared/badges';
import { knowledgeBaseColor } from '../shared/meta';
import { KnowledgeLayerBanner } from '../shared/states';

type SortKey = 'name' | 'name-desc' | 'created' | 'created-asc' | 'updated';

const SORTS: Readonly<Record<SortKey, { label: string; sortBy: NonNullable<ListKnowledgeBasesParams['sortBy']>; sortDirection: 'ASC' | 'DESC' }>> = {
  name: { label: 'Name A–Z', sortBy: 'name', sortDirection: 'ASC' },
  'name-desc': { label: 'Name Z–A', sortBy: 'name', sortDirection: 'DESC' },
  created: { label: 'Newest', sortBy: 'createdAt', sortDirection: 'DESC' },
  'created-asc': { label: 'Oldest', sortBy: 'createdAt', sortDirection: 'ASC' },
  updated: { label: 'Recently updated', sortBy: 'updatedAt', sortDirection: 'DESC' },
};

const PAGE_SIZE = 20;

/** Knowledge bases (Phase 3 spec §6.6, E60). */
export function KnowledgeBasesPage() {
  const workspace = useWorkspace();
  const can = useCan();
  useDocumentTitle('Knowledge bases');

  if (!can('knowledgebase:read')) {
    return (
      <Card>
        <NoAccessState permissions={['knowledgebase:read']} workspaceName={workspace.name} />
      </Card>
    );
  }
  return <KnowledgeBasesList />;
}

function KnowledgeBasesList() {
  const workspace = useWorkspace();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const base = `/w/${workspace.slug}`;

  const q = (params.get('q') ?? '').slice(0, 200);
  const sortParam = params.get('sort') as SortKey | null;
  const sort: SortKey = sortParam && sortParam in SORTS ? sortParam : 'name';
  const pageParam = Number.parseInt(params.get('page') ?? '', 10);
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;

  const write = (patch: { q?: string; sort?: SortKey; page?: number }) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        const set = (key: string, value: string | null) => (value ? next.set(key, value) : next.delete(key));
        if (patch.q !== undefined) set('q', patch.q.trim() || null);
        if (patch.sort !== undefined) set('sort', patch.sort === 'name' ? null : patch.sort);
        set('page', patch.page && patch.page > 1 ? String(patch.page) : null);
        return next;
      },
      { replace: true, preventScrollReset: true },
    );

  const query = useQuery(
    knowledgeBasesQuery(workspace.id, {
      page,
      limit: PAGE_SIZE,
      ...(q.trim() ? { search: q.trim() } : {}),
      sortBy: SORTS[sort].sortBy,
      sortDirection: SORTS[sort].sortDirection,
    }),
  );

  // ── Search: typed locally, pushed to the URL after 300 ms of quiet ──
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
    timer.current = window.setTimeout(() => write({ q: value }), 300);
  };

  const items = query.data?.items ?? [];
  const total = query.data?.pagination.totalItems;

  return (
    <div className="grid gap-6">
      <PageHeader
        overline={
          <Link to={`${base}/documents`} className="rounded-sm hover:text-ink">
            Document Vault
          </Link>
        }
        title="Knowledge bases"
        description={
          <>
            Compartments for your documents: open to the workspace, or restricted to the people, roles and API keys you grant.
            {total !== undefined ? <span className="text-ink-soft"> You can see {pluralize(total, 'knowledge base')}.</span> : null}
          </>
        }
        actions={
          can('knowledgebase:create') ? (
            <Button asChild>
              <Link to={`${base}/knowledge-bases/new`}>
                <FolderPlus />
                New knowledge base
              </Link>
            </Button>
          ) : null
        }
      />

      <KnowledgeLayerBanner />

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
          aria-label="Search knowledge bases"
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
        <Select
          size="sm"
          aria-label="Sort by"
          value={sort}
          onValueChange={(value) => write({ sort: value, q: draft })}
          options={(Object.keys(SORTS) as SortKey[]).map((key) => ({ value: key, label: SORTS[key].label }))}
          className="w-44 sm:ml-auto"
        />
      </div>

      {query.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : query.isError && !query.data ? (
        <Card>
          <ErrorState error={query.error} title="We couldn't load the knowledge bases" onRetry={() => void query.refetch()} retrying={query.isFetching} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          {q.trim() ? (
            <EmptyState
              icon={<SearchX />}
              title="No knowledge bases match"
              description={`Nothing you can see is named like “${q.trim()}”.`}
              action={
                <Button variant="secondary" size="sm" onClick={() => onSearch('')}>
                  <RotateCcw />
                  Clear search
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Library />}
              title={can('knowledgebase:create') ? 'No knowledge bases yet' : "You don't have access to any knowledge base yet"}
              description={
                can('knowledgebase:create')
                  ? 'Create one for each body of documents, such as an employee handbook or HR policies, and decide who can see it.'
                  : 'Knowledge bases appear here once one is open to the workspace or someone grants you access.'
              }
              action={
                can('knowledgebase:create') ? (
                  <Button asChild size="sm">
                    <Link to={`${base}/knowledge-bases/new`}>
                      <FolderPlus />
                      New knowledge base
                    </Link>
                  </Button>
                ) : null
              }
            />
          )}
        </Card>
      ) : (
        <ul className={cn('grid gap-4 md:grid-cols-2 2xl:grid-cols-3', query.isPlaceholderData && 'opacity-60 transition-opacity')}>
          {items.map((knowledgeBase, index) => (
            <li key={knowledgeBase.id} className="animate-rise" style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}>
              <KnowledgeBaseCard knowledgeBase={knowledgeBase} />
            </li>
          ))}
        </ul>
      )}

      {query.data && query.data.pagination.totalPages > 1 ? (
        <Pagination pagination={query.data.pagination} onPageChange={(next) => write({ page: next })} busy={query.isFetching} noun={['knowledge base', 'knowledge bases']} />
      ) : null}
    </div>
  );
}

function KnowledgeBaseCard({ knowledgeBase }: { knowledgeBase: KnowledgeBase }) {
  const workspace = useWorkspace();
  const { stats } = knowledgeBase;
  const color = knowledgeBaseColor(knowledgeBase.id);
  const other = Math.max(0, stats.documents - stats.ready - stats.processing - stats.failed);
  const href = `/w/${workspace.slug}/knowledge-bases/${knowledgeBase.id}`;

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card transition-[border-color,box-shadow] duration-200 hover:border-line-strong hover:shadow-[0_6px_20px_-10px_rgb(28_27_24/0.25)]">
      <span className="absolute inset-x-0 top-0 h-[3px]" style={{ backgroundColor: color }} aria-hidden />
      <div className="flex flex-1 flex-col gap-3 px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 text-[15px] leading-6 font-semibold text-ink">
            <Link to={href} className="rounded-sm after:absolute after:inset-0 hover:text-brand-700 focus-visible:outline-offset-4">
              <span className="line-clamp-2 break-words">{knowledgeBase.name}</span>
            </Link>
          </h2>
          <div className="relative flex shrink-0 flex-wrap justify-end gap-1">
            <AccessModeBadge mode={knowledgeBase.accessMode} />
            {knowledgeBase.accessMode === 'RESTRICTED' ? <AccessLevelBadge level={knowledgeBase.access} /> : null}
          </div>
        </div>
        <p className="line-clamp-2 min-h-10 text-[13px] leading-relaxed text-muted">
          {knowledgeBase.description ?? <span className="text-faint">No description.</span>}
        </p>

        <div className="mt-auto grid gap-2">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-well-strong" aria-hidden>
            {stats.documents > 0 ? (
              <>
                <span className="bg-success-500" style={{ width: `${(stats.ready / stats.documents) * 100}%` }} />
                <span className="bg-info-500" style={{ width: `${(stats.processing / stats.documents) * 100}%` }} />
                <span className="bg-danger-500" style={{ width: `${(stats.failed / stats.documents) * 100}%` }} />
                <span className="bg-line-strong" style={{ width: `${(other / stats.documents) * 100}%` }} />
              </>
            ) : null}
          </div>
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <Stat label="Documents" value={stats.documents} strong />
            <Stat label="Indexed" value={stats.ready} />
            {stats.processing ? <Stat label="Processing" value={stats.processing} tone="text-info-700" /> : null}
            {stats.failed ? <Stat label="Failed" value={stats.failed} tone="text-danger-700" /> : null}
            <div className="flex gap-1">
              <dt className="sr-only">Size</dt>
              <dd className="font-mono tabular">{formatBytes(stats.totalBytes)}</dd>
            </div>
          </dl>
        </div>
      </div>
      <footer className="relative flex items-center justify-between gap-3 border-t border-line bg-well/40 px-5 py-2.5 text-xs text-muted">
        <span className="flex min-w-0 items-center gap-2">
          <ClassificationBadge classification={knowledgeBase.defaultClassification} />
          <span className="truncate">
            Updated <RelativeTime value={knowledgeBase.updatedAt} />
          </span>
        </span>
        <Link
          to={`/w/${workspace.slug}/documents?kb=${knowledgeBase.id}`}
          className="relative z-[1] inline-flex shrink-0 items-center gap-1 rounded-sm font-medium text-brand-700 hover:underline hover:underline-offset-4"
        >
          Documents
          <ArrowRight className="size-3" aria-hidden />
        </Link>
      </footer>
    </article>
  );
}

function Stat({ label, value, strong, tone }: { label: string; value: number; strong?: boolean; tone?: string }) {
  return (
    <div className="flex gap-1">
      <dt>{label}</dt>
      <dd className={cn('font-mono tabular', strong ? 'font-medium text-ink' : 'text-ink-soft', tone)}>{value.toLocaleString()}</dd>
    </div>
  );
}
