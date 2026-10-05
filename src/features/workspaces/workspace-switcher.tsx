import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ChevronsUpDown, LayoutGrid, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  DropdownMenu,
  DropdownMenuCheckItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton, WorkspaceTile } from '@/components/ui/misc';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip } from '@/components/ui/tooltip';
import { workspaceHref } from '@/lib/auth/landing';
import { meQuery, workspacesInfiniteQuery } from '@/lib/queries';
import { cn, humanizeSlug } from '@/lib/utils';

interface Entry {
  id: string;
  slug: string;
  name: string;
  role: string;
  status?: string;
}

/**
 * The workspace card at the top of the sidebar. Switching only navigates: the
 * gate runs the switching transaction, and every workspace query key carries the
 * workspace id, so nothing from the previous workspace can render in the next.
 *
 * The list comes from GET /organizations a page at a time (loaded when the menu
 * opens), not the 100 memberships embedded in /auth/me, so nobody is left out.
 */
export function WorkspaceSwitcher({
  current,
  collapsed,
  onNavigate,
}: {
  current: { id: string; slug: string; name: string };
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: me } = useQuery(meQuery);
  const pages = useInfiniteQuery({ ...workspacesInfiniteQuery, enabled: open });
  const navigate = useNavigate();

  const listed: Entry[] | undefined = pages.data?.pages.flatMap((page) =>
    page.items.map((workspace) => ({
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
      role: workspace.isOwner ? 'Owner' : workspace.roleSlugs[0] ? humanizeSlug(workspace.roleSlugs[0]) : 'Member',
      status: workspace.status,
    })),
  );
  // Until the first page arrives, the embedded memberships fill the menu.
  const entries: Entry[] =
    listed ??
    (me?.memberships ?? []).map((membership) => ({
      id: membership.organizationId,
      slug: membership.organizationSlug,
      name: membership.organizationName,
      role: membership.isOwner ? 'Owner' : membership.roleSlugs[0] ? humanizeSlug(membership.roleSlugs[0]) : 'Member',
    }));

  const go = (path: string) => {
    onNavigate?.();
    navigate(path);
  };

  const trigger = (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        className={cn(
          'group flex w-full items-center gap-2.5 rounded-lg border border-line bg-surface text-left shadow-xs transition-colors hover:border-line-strong data-[state=open]:border-line-strong',
          collapsed ? 'justify-center p-1.5' : 'px-2.5 py-2',
        )}
        aria-label={`Workspace: ${current.name}. Switch workspace`}
      >
        <WorkspaceTile name={current.name} seed={current.slug} size={collapsed ? 'sm' : 'md'} />
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] leading-4 font-medium tracking-[0.06em] text-faint uppercase">
                Workspace
              </span>
              <span className="block truncate text-[13px] leading-5 font-semibold text-ink">{current.name}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-faint group-hover:text-ink-soft" aria-hidden />
          </>
        )}
      </button>
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {collapsed ? (
        <Tooltip content={current.name} side="right">
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}
      <DropdownMenuContent align="start" side={collapsed ? 'right' : 'bottom'} className="w-72">
        <DropdownMenuLabel className="flex items-center justify-between">
          Your workspaces
          {pages.isFetching ? <Spinner className="size-3" /> : null}
        </DropdownMenuLabel>
        <div className="scrollbar-thin max-h-72 overflow-y-auto">
          {entries.length === 0 && pages.isPending ? (
            <div className="grid gap-2 px-2 py-1.5" aria-busy="true">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            entries.map((entry) => (
              <DropdownMenuCheckItem
                key={entry.id}
                checked={entry.id === current.id}
                onSelect={() => go(workspaceHref(entry))}
              >
                <WorkspaceTile name={entry.name} seed={entry.slug} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{entry.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {entry.role}
                    {entry.status && entry.status !== 'ACTIVE' ? ` · ${humanizeSlug(entry.status.toLowerCase())}` : ''}
                  </span>
                </span>
              </DropdownMenuCheckItem>
            ))
          )}
          {pages.hasNextPage ? (
            <DropdownMenuItem
              disabled={pages.isFetchingNextPage}
              onSelect={(event) => {
                // Keep the menu open while the next page loads.
                event.preventDefault();
                void pages.fetchNextPage();
              }}
            >
              {pages.isFetchingNextPage ? <Spinner className="size-3.5" /> : <ChevronsUpDown />}
              Show more workspaces
            </DropdownMenuItem>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => go('/workspaces/new')}>
          <Plus />
          Create workspace
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => go('/workspaces')}>
          <LayoutGrid />
          All workspaces
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
