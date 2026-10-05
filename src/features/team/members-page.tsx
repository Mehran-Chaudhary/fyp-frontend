import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Eye,
  KeyRound,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Search,
  UserMinus,
  UserPlus,
  Users,
  UserX,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Pagination } from '@/components/ui/pagination';
import { RelativeTime } from '@/components/ui/relative-time';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { SortableTH, Table, TableMessage, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { useDialogTarget } from '@/components/ui/use-dialog-target';
import type { Member, MemberSortField } from '@/lib/api/types';
import { useDocumentTitle } from '@/lib/hooks';
import { membersQuery, rolesQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useAccess } from '@/features/workspaces/use-access';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { RemoveMemberDialog, SuspendMemberDialog } from './member-actions';
import { MemberIdentity, MemberStatusBadge, RoleChips, RoleDot } from './member-bits';
import {
  DEFAULT_FILTERS,
  hasActiveFilters,
  readMemberFilters,
  toListParams,
  writeMemberFilters,
  type MemberFilters,
  type MemberStatusFilter,
} from './member-filters';
import { isUuid, useReactivateMember } from './member-helpers';
import { useInviteDialog } from './use-invite-dialog';

const SORT_OPTIONS: Array<{ value: MemberSortField; label: string }> = [
  { value: 'createdAt', label: 'Date added' },
  { value: 'name', label: 'Name' },
  { value: 'email', label: 'Email' },
  { value: 'joinedAt', label: 'Joined' },
  { value: 'status', label: 'Status' },
  { value: 'lastActiveAt', label: 'Last active' },
];

const STATUS_OPTIONS: Array<{ value: MemberStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'removed', label: 'Removed' },
];

const COLUMNS = 7;

/**
 * Team → Members (P2-API-08). Filters live in the URL (never secrets), search is
 * debounced and outdated requests are cancelled, and the member drawer renders
 * over the list as a child route so the filters survive opening a member.
 */
export function MembersPage() {
  const workspace = useWorkspace();
  const can = useCan();
  useDocumentTitle('Team');

  if (!can('member:read')) {
    return (
      <Card>
        <NoAccessState permissions={['member:read']} workspaceName={workspace.name} />
      </Card>
    );
  }
  return <MembersList />;
}

function MembersList() {
  const workspace = useWorkspace();
  const can = useCan();
  const access = useAccess();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [, setInviteOpen] = useInviteDialog();
  const filters = readMemberFilters(params);

  const roles = useQuery({ ...rolesQuery(workspace.id), enabled: can('role:read') });
  const roleId = isUuid(filters.role) ? filters.role : null;
  const query = useQuery(membersQuery(workspace.id, toListParams(filters, roleId)));

  const update = (patch: Partial<MemberFilters>) =>
    setParams((previous) => writeMemberFilters(previous, patch), { replace: true, preventScrollReset: true });

  // ── Search: typed locally, pushed to the URL after 300 ms of quiet ──
  const [draft, setDraft] = useState(filters.q);
  const [syncedQ, setSyncedQ] = useState(filters.q);
  if (filters.q !== syncedQ) {
    // The URL changed from elsewhere (back button, "Clear filters").
    setSyncedQ(filters.q);
    setDraft(filters.q);
  }
  const searchTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const timer = searchTimer;
    return () => window.clearTimeout(timer.current);
  }, []);
  const onSearch = (value: string) => {
    setDraft(value);
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => update({ q: value }), 300);
  };

  const clearFilters = () => {
    window.clearTimeout(searchTimer.current);
    setDraft('');
    setParams((previous) => writeMemberFilters(previous, { ...DEFAULT_FILTERS, sort: filters.sort, dir: filters.dir }), {
      replace: true,
    });
  };

  // Dates start newest first; names, emails and statuses start A–Z.
  const naturalDir = (field: MemberSortField) =>
    field === 'createdAt' || field === 'joinedAt' || field === 'lastActiveAt' ? 'desc' : 'asc';
  const sortBy = (field: MemberSortField) =>
    update(
      filters.sort === field ? { dir: filters.dir === 'asc' ? 'desc' : 'asc' } : { sort: field, dir: naturalDir(field) },
    );
  const directionOf = (field: MemberSortField) =>
    filters.sort === field ? (filters.dir === 'asc' ? 'ASC' : 'DESC') : null;

  // ── Row actions ──
  const suspendDialog = useDialogTarget<Member>();
  const removeDialog = useDialogTarget<Member>();
  const reactivate = useReactivateMember();

  const base = `/w/${workspace.slug}/team`;
  const openMember = (member: Member, state?: { focus: 'roles' }) =>
    navigate({ pathname: `${base}/members/${member.id}`, search: location.search }, { state, preventScrollReset: true });

  const roleOptions = [
    { value: 'all', label: 'All roles' },
    ...(roles.data ?? []).map((role) => ({ value: role.id, label: role.name, leading: <RoleDot color={role.color} className="mt-[5px]" /> })),
  ];

  const items = query.data?.items ?? [];
  const filtered = hasActiveFilters(filters);

  // The last row on a later page went away (removed, filtered out): step back to a page that has rows.
  const lastPage = query.data?.pagination.totalPages ?? 1;
  const overshot = !!query.data && !query.isPlaceholderData && items.length === 0 && filters.page > 1;
  useEffect(() => {
    if (overshot) {
      setParams((previous) => writeMemberFilters(previous, { page: Math.max(1, lastPage) }), { replace: true, preventScrollReset: true });
    }
  }, [overshot, lastPage, setParams]);

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-2.5 border-b border-line p-3 sm:px-4 lg:flex-row lg:items-center">
          <Input
            className="w-full lg:w-72"
            leading={<Search />}
            value={draft}
            onChange={(event) => onSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && draft) onSearch('');
            }}
            placeholder="Search name, email or display name"
            aria-label="Search members"
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
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              aria-label="Status"
              value={filters.status}
              onValueChange={(status) => update({ status })}
              options={STATUS_OPTIONS}
            />
            {can('role:read') ? (
              <Select
                size="sm"
                aria-label="Role"
                value={roleId ?? 'all'}
                onValueChange={(value) => update({ role: value === 'all' ? null : value })}
                options={roleOptions}
                icon={<KeyRound />}
                className="w-44"
              />
            ) : null}
          </div>
          <div className="flex items-center gap-1.5 lg:ml-auto">
            <Tooltip content="Refresh">
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-9 text-muted"
                onClick={() => void query.refetch()}
                aria-label="Refresh the member list"
              >
                <RefreshCw className={cn(query.isFetching && !query.isPending && 'animate-spin')} />
              </Button>
            </Tooltip>
            <Select
              size="sm"
              aria-label="Sort by"
              value={filters.sort}
              onValueChange={(sort) => update({ sort, dir: naturalDir(sort) })}
              options={SORT_OPTIONS}
              className="w-40"
            />
            <Tooltip content={filters.dir === 'asc' ? 'Ascending' : 'Descending'}>
              <Button
                variant="secondary"
                size="icon-sm"
                className="size-9"
                onClick={() => update({ dir: filters.dir === 'asc' ? 'desc' : 'asc' })}
                aria-label={filters.dir === 'asc' ? 'Sorted ascending; sort descending' : 'Sorted descending; sort ascending'}
              >
                {filters.dir === 'asc' ? <ArrowUpNarrowWide /> : <ArrowDownWideNarrow />}
              </Button>
            </Tooltip>
          </div>
        </div>

        <div className="relative">
          {query.isFetching && query.isPlaceholderData ? (
            <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden" aria-hidden>
              <div className="h-full w-1/3 bg-brand-500 animate-progress" />
            </div>
          ) : null}
          <Table className={cn('transition-opacity', query.isPlaceholderData && 'opacity-60')}>
            <THead>
              <tr>
                <SortableTH direction={directionOf('name')} onSort={() => sortBy('name')}>
                  Member
                </SortableTH>
                <TH className="hidden xl:table-cell">Title</TH>
                <TH>Roles</TH>
                <SortableTH direction={directionOf('status')} onSort={() => sortBy('status')}>
                  Status
                </SortableTH>
                <SortableTH className="hidden md:table-cell" direction={directionOf('joinedAt')} onSort={() => sortBy('joinedAt')}>
                  Joined
                </SortableTH>
                <SortableTH
                  className="hidden lg:table-cell"
                  direction={directionOf('lastActiveAt')}
                  onSort={() => sortBy('lastActiveAt')}
                >
                  Last active
                </SortableTH>
                <TH className="w-12">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {query.isPending ? (
                Array.from({ length: 6 }, (_, index) => <SkeletonRow key={index} />)
              ) : query.isError && !query.data ? (
                <TableMessage colSpan={COLUMNS}>
                  <ErrorState
                    error={query.error}
                    title="We couldn't load the members"
                    onRetry={() => void query.refetch()}
                    retrying={query.isFetching}
                  />
                </TableMessage>
              ) : items.length === 0 ? (
                <TableMessage colSpan={COLUMNS}>
                  {filtered ? (
                    <EmptyState
                      icon={<Search />}
                      title={filters.status === 'removed' && !filters.q ? 'Nobody has left or been removed' : 'No members match'}
                      description={
                        filters.q
                          ? `Nobody matches "${filters.q}" with these filters.`
                          : 'Try another status or role, or clear the filters.'
                      }
                      action={
                        <Button variant="secondary" size="sm" onClick={clearFilters}>
                          <RotateCcw />
                          Clear filters
                        </Button>
                      }
                    />
                  ) : (
                    <EmptyState
                      icon={<Users />}
                      title="No members to show"
                      description={
                        can('member:invite')
                          ? 'Invite colleagues by email and give each of them a role.'
                          : 'Nobody else is active or suspended in this workspace.'
                      }
                      action={
                        can('member:invite') ? (
                          <Button size="sm" onClick={() => setInviteOpen(true)}>
                            <UserPlus />
                            Invite people
                          </Button>
                        ) : null
                      }
                    />
                  )}
                </TableMessage>
              ) : (
                items.map((member) => {
                  const isYou = member.id === access.membership?.id;
                  const removed = member.status === 'REMOVED';
                  const manageable = !removed && access.canActOn(member);
                  const open = (event: MouseEvent) => {
                    // Let modified clicks open the member in a new tab via the name link.
                    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                    openMember(member);
                  };
                  return (
                    <TR key={member.id} interactive onClick={open} className={cn(removed && 'text-muted')}>
                      <TD className="max-w-[18rem]">
                        <Link
                          to={{ pathname: `${base}/members/${member.id}`, search: location.search }}
                          preventScrollReset
                          onClick={(event) => event.stopPropagation()}
                          className="block rounded-md focus-visible:outline-offset-4"
                          aria-label={`${member.displayName}, ${member.email}`}
                        >
                          <MemberIdentity member={member} isYou={isYou} />
                        </Link>
                      </TD>
                      <TD className="hidden max-w-[12rem] truncate xl:table-cell">
                        {member.title ?? <span className="text-faint">—</span>}
                      </TD>
                      <TD className="max-w-[16rem]">
                        <RoleChips member={member} />
                      </TD>
                      <TD>
                        <MemberStatusBadge status={member.status} />
                      </TD>
                      <TD className="hidden text-muted md:table-cell">
                        <RelativeTime value={member.joinedAt ?? member.createdAt} />
                      </TD>
                      <TD className="hidden text-muted lg:table-cell">
                        <RelativeTime value={member.lastActiveAt} />
                      </TD>
                      <TD className="text-right" onClick={(event) => event.stopPropagation()}>
                        {removed ? null : (
                          <RowMenu
                            member={member}
                            manageable={manageable}
                            onView={() => openMember(member)}
                            onChangeRoles={() => openMember(member, { focus: 'roles' })}
                            onSuspend={() => suspendDialog.show(member)}
                            onReactivate={() => reactivate.mutate(member)}
                            onRemove={() => removeDialog.show(member)}
                          />
                        )}
                      </TD>
                    </TR>
                  );
                })
              )}
            </TBody>
          </Table>
        </div>

        {query.data && query.data.pagination.totalItems > 0 ? (
          <div className="border-t border-line px-4 py-3 sm:px-6">
            <Pagination
              pagination={query.data.pagination}
              onPageChange={(page) => update({ page })}
              busy={query.isFetching}
              noun={['member', 'members']}
            />
          </div>
        ) : null}
      </Card>

      <p className="mt-3 text-xs text-faint">
        "Last active" updates at most once a minute, whenever someone uses this workspace.
      </p>

      <SuspendMemberDialog member={suspendDialog.target} open={suspendDialog.open} onOpenChange={suspendDialog.onOpenChange} />
      <RemoveMemberDialog member={removeDialog.target} open={removeDialog.open} onOpenChange={removeDialog.onOpenChange} />

      {/* The member drawer (child route). */}
      <Outlet />
    </>
  );
}

function RowMenu({
  member,
  manageable,
  onView,
  onChangeRoles,
  onSuspend,
  onReactivate,
  onRemove,
}: {
  member: Member;
  manageable: boolean;
  onView: () => void;
  onChangeRoles: () => void;
  onSuspend: () => void;
  onReactivate: () => void;
  onRemove: () => void;
}) {
  const can = useCan();
  const canRoles = manageable && can('role:assign');
  const canStatus = manageable && can('member:update');
  const canRemove = manageable && can('member:remove');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="text-faint data-[state=open]:bg-well" aria-label={`Actions for ${member.displayName}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuItem onSelect={onView}>
          <Eye />
          View details
        </DropdownMenuItem>
        {canRoles ? (
          <DropdownMenuItem onSelect={onChangeRoles}>
            <KeyRound />
            Change roles…
          </DropdownMenuItem>
        ) : null}
        {canStatus || canRemove ? <DropdownMenuSeparator /> : null}
        {canStatus && member.status === 'ACTIVE' ? (
          <DropdownMenuItem onSelect={onSuspend}>
            <UserX />
            Suspend…
          </DropdownMenuItem>
        ) : null}
        {canStatus && member.status === 'SUSPENDED' ? (
          <DropdownMenuItem onSelect={onReactivate}>
            <RotateCcw />
            Reactivate
          </DropdownMenuItem>
        ) : null}
        {canRemove ? (
          <DropdownMenuItem tone="danger" onSelect={onRemove}>
            <UserMinus />
            Remove from workspace…
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SkeletonRow() {
  return (
    <tr>
      <TD>
        <div className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="grid gap-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-44" />
          </div>
        </div>
      </TD>
      <TD className="hidden xl:table-cell">
        <Skeleton className="h-3 w-24" />
      </TD>
      <TD>
        <Skeleton className="h-5 w-20 rounded-md" />
      </TD>
      <TD>
        <Skeleton className="h-5 w-16 rounded-md" />
      </TD>
      <TD className="hidden md:table-cell">
        <Skeleton className="h-3 w-20" />
      </TD>
      <TD className="hidden lg:table-cell">
        <Skeleton className="h-3 w-20" />
      </TD>
      <TD />
    </tr>
  );
}
