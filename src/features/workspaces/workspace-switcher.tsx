import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDown, LayoutGrid, Plus } from 'lucide-react';
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
import { WorkspaceTile } from '@/components/ui/misc';
import { Tooltip } from '@/components/ui/tooltip';
import { meQuery } from '@/lib/queries';
import { cn, humanizeSlug } from '@/lib/utils';

/**
 * The workspace card at the top of the sidebar (spec §7.10). Switching simply
 * navigates; the gate does the rest, and every workspace query key carries the
 * workspace id, so nothing from the previous workspace can leak.
 */
export function WorkspaceSwitcher({
  current,
  collapsed,
  onNavigate,
}: {
  current: { id: string; slug: string; name: string; roleLabel?: string };
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { data: me } = useQuery(meQuery);
  const navigate = useNavigate();
  const memberships = me?.memberships ?? [];

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
    <DropdownMenu>
      {collapsed ? (
        <Tooltip content={current.name} side="right">
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}
      <DropdownMenuContent align="start" side={collapsed ? 'right' : 'bottom'} className="w-72">
        <DropdownMenuLabel>Your workspaces</DropdownMenuLabel>
        <div className="scrollbar-thin max-h-72 overflow-y-auto">
          {memberships.map((membership) => (
            <DropdownMenuCheckItem
              key={membership.organizationId}
              checked={membership.organizationId === current.id}
              onSelect={() => go(`/w/${membership.organizationSlug}`)}
            >
              <WorkspaceTile name={membership.organizationName} seed={membership.organizationSlug} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{membership.organizationName}</span>
                <span className="block truncate text-xs text-muted">
                  {membership.isOwner ? 'Owner' : membership.roleSlugs[0] ? humanizeSlug(membership.roleSlugs[0]) : 'Member'}
                </span>
              </span>
            </DropdownMenuCheckItem>
          ))}
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
