import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Building2, ChevronLeft, ChevronRight, Crown, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { EmptyState, ErrorState, PageHeader } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton, WorkspaceTile } from '@/components/ui/misc';
import type { OrganizationWithMembership } from '@/lib/api/types';
import { useDocumentTitle } from '@/lib/hooks';
import { workspacesQuery } from '@/lib/queries';
import { STORAGE_KEYS, storage } from '@/lib/storage';
import { cn, formatDate, humanizeSlug, pluralize } from '@/lib/utils';

/** The user's workspaces (spec §7.8, E23). */
export function WorkspacesPage() {
  useDocumentTitle('Workspaces');
  const [page, setPage] = useState(1);
  const query = useQuery(workspacesQuery(page));
  const lastSlug = storage.get(STORAGE_KEYS.lastWorkspace);

  const createButton = (
    <Button asChild>
      <Link to="/workspaces/new">
        <Plus />
        Create workspace
      </Link>
    </Button>
  );

  const pagination = query.data?.pagination;

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Your workspaces"
        description="Each workspace is an isolated tenant: its agents, documents, workflows and logs never cross into another."
        actions={query.data && query.data.items.length > 0 ? createButton : null}
      />

      {query.isPending ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <li key={index} className="rounded-xl border border-line bg-surface p-5 shadow-card">
              <div className="flex items-center gap-3">
                <Skeleton className="size-11 rounded-xl" />
                <div className="grid flex-1 gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <Skeleton className="mt-5 h-3 w-3/4" />
            </li>
          ))}
        </ul>
      ) : query.isError && !query.data ? (
        <div className="rounded-xl border border-line bg-surface shadow-card">
          <ErrorState
            error={query.error}
            title="We couldn't load your workspaces"
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        </div>
      ) : query.data.items.length === 0 && page === 1 ? (
        <div className="bg-dots rounded-xl border border-dashed border-line-strong">
          <EmptyState
            icon={<Building2 />}
            title="You're not in any workspace yet"
            description="Create one for your team, or ask an admin to invite you. Invitations arrive by email."
            action={createButton}
          />
        </div>
      ) : (
        <>
          <ul className={cn('grid gap-3 sm:grid-cols-2 transition-opacity', query.isPlaceholderData && 'opacity-60')}>
            {query.data.items.map((workspace) => (
              <li key={workspace.id}>
                <WorkspaceCard workspace={workspace} lastUsed={workspace.slug === lastSlug} />
              </li>
            ))}
          </ul>

          {pagination && pagination.totalPages > 1 ? (
            <nav className="flex items-center justify-between gap-4 text-[13px] text-muted" aria-label="Pagination">
              <span className="tabular">
                Page {pagination.page} of {pagination.totalPages} · {pluralize(pagination.totalItems, 'workspace')}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!pagination.hasPreviousPage || query.isFetching}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft />
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!pagination.hasNextPage || query.isFetching}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                  <ChevronRight />
                </Button>
              </div>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

function WorkspaceCard({ workspace, lastUsed }: { workspace: OrganizationWithMembership; lastUsed: boolean }) {
  const role = workspace.isOwner ? 'Owner' : workspace.roleSlugs[0] ? humanizeSlug(workspace.roleSlugs[0]) : 'Member';
  const suspended = workspace.status !== 'ACTIVE';

  return (
    <Link
      to={`/w/${workspace.slug}`}
      className="group flex h-full flex-col rounded-xl border border-line bg-surface p-5 shadow-card transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-line-strong hover:shadow-[0_6px_20px_-12px_rgb(28_27_24/0.25)]"
    >
      <div className="flex items-start gap-3.5">
        <WorkspaceTile name={workspace.name} seed={workspace.slug} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[15px] font-semibold text-ink">{workspace.name}</h2>
            {lastUsed ? <Badge tone="neutral">Last used</Badge> : null}
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-faint">/w/{workspace.slug}</p>
        </div>
        <ArrowRight
          className="mt-1 size-4 shrink-0 text-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink-soft"
          aria-hidden
        />
      </div>

      {workspace.description ? (
        <p className="mt-4 line-clamp-2 text-[13px] leading-relaxed text-muted">{workspace.description}</p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-5 text-xs text-muted">
        <Badge tone={workspace.isOwner ? 'brand' : 'outline'}>
          {workspace.isOwner ? <Crown /> : null}
          {role}
        </Badge>
        {suspended ? (
          <Badge tone="danger" dot>
            {humanizeSlug(workspace.status.toLowerCase())}
          </Badge>
        ) : null}
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-3.5" aria-hidden />
          {pluralize(workspace.memberCount, 'member')}
        </span>
        <span>Joined {formatDate(workspace.joinedAt)}</span>
      </div>
    </Link>
  );
}
