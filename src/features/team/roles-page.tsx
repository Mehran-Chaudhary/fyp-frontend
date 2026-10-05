import { useQueries, useQuery } from '@tanstack/react-query';
import { Copy, Eye, KeyRound, Lock, MoreHorizontal, RefreshCcw, Settings2, Trash2 } from 'lucide-react';
import type { MouseEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { ErrorState } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/misc';
import { Table, TableMessage, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { useDialogTarget } from '@/components/ui/use-dialog-target';
import type { Role } from '@/lib/api/types';
import { useDocumentTitle } from '@/lib/hooks';
import { expandPermissions } from '@/lib/permissions/expand';
import { roleMemberCountQuery, rolesQuery } from '@/lib/queries';
import { cn, pluralize } from '@/lib/utils';
import { useAccess } from '@/features/workspaces/use-access';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { RoleDot } from './member-bits';
import { DeleteRoleDialog, RecomputeDialog } from './role-dialogs';

const COLUMNS = 5;

/**
 * Team → Roles (P2-API-20/21, member counts from P2-API-08). Roles carry no holder
 * count, so it is read per role from the member list when member:read allows.
 */
export function RolesPage() {
  const workspace = useWorkspace();
  const can = useCan();
  useDocumentTitle('Roles');

  if (!can('role:read')) {
    return (
      <Card>
        <NoAccessState permissions={['role:read']} workspaceName={workspace.name} />
      </Card>
    );
  }
  return <RolesList />;
}

function RolesList() {
  const workspace = useWorkspace();
  const can = useCan();
  const access = useAccess();
  const navigate = useNavigate();
  const location = useLocation();
  const highlight = (location.state as { highlight?: string } | null)?.highlight;
  const base = `/w/${workspace.slug}/team`;

  const roles = useQuery(rolesQuery(workspace.id));
  const countsAllowed = can('member:read');
  // One small request per role (≤15 roles): acceptable, and cached per role.
  const counts = useQueries({
    queries: (roles.data ?? []).map((role) => ({ ...roleMemberCountQuery(workspace.id, role.id), enabled: countsAllowed })),
  });
  const countOf = (index: number): number | undefined => counts[index]?.data;

  const deleteDialog = useDialogTarget<Role>();
  const recomputeDialog = useDialogTarget<true>();

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader
          icon={<KeyRound />}
          title="Roles"
          description={
            <>
              A member's rank is the highest priority among their roles. People can only manage members and roles ranked
              below them. <span className="text-ink-soft">You rank at <span className="font-mono font-medium tabular">{access.myPriority}</span>.</span>
            </>
          }
          actions={
            can('role:update') ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="text-faint data-[state=open]:bg-well" aria-label="More role actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-60">
                  <DropdownMenuItem onSelect={() => recomputeDialog.show(true)}>
                    <RefreshCcw />
                    Recompute permissions…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null
          }
        />
        <Table className="border-t border-line">
          <THead>
            <tr>
              <TH>Role</TH>
              <TH>Priority</TH>
              <TH className="hidden sm:table-cell">Permissions</TH>
              <TH className="hidden md:table-cell">Members</TH>
              <TH className="w-12">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {roles.isPending ? (
              Array.from({ length: 5 }, (_, index) => (
                <tr key={index}>
                  <TD>
                    <div className="grid gap-1.5">
                      <Skeleton className="h-3.5 w-32" />
                      <Skeleton className="h-3 w-56" />
                    </div>
                  </TD>
                  <TD>
                    <Skeleton className="h-3 w-20" />
                  </TD>
                  <TD className="hidden sm:table-cell">
                    <Skeleton className="h-3 w-10" />
                  </TD>
                  <TD className="hidden md:table-cell">
                    <Skeleton className="h-3 w-16" />
                  </TD>
                  <TD />
                </tr>
              ))
            ) : roles.isError ? (
              <TableMessage colSpan={COLUMNS}>
                <ErrorState error={roles.error} title="We couldn't load the roles" onRetry={() => void roles.refetch()} retrying={roles.isFetching} />
              </TableMessage>
            ) : (
              roles.data.map((role, index) => {
                const permissionCount = access.ready ? expandPermissions(role.permissionKeys, access.catalogueKeys).length : null;
                const memberCount = countOf(index);
                const aboveMe = role.priority >= access.myPriority;
                const deletable = can('role:delete') && !role.isSystem && !aboveMe;
                const open = (event: MouseEvent) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                  navigate(`${base}/roles/${role.id}`);
                };
                return (
                  <TR key={role.id} interactive onClick={open} className={cn(highlight === role.id && 'animate-highlight')}>
                    <TD className="max-w-[26rem]">
                      <Link
                        to={`${base}/roles/${role.id}`}
                        onClick={(event) => event.stopPropagation()}
                        className="flex min-w-0 items-start gap-2.5 rounded-md focus-visible:outline-offset-4"
                      >
                        <RoleDot color={role.color} className="mt-[7px] size-2.5" />
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium text-ink">{role.name}</span>
                            {role.isSystem ? <Badge tone="outline">Built-in</Badge> : null}
                            {role.isDefault ? <Badge tone="info">Default for invitations</Badge> : null}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-muted">
                            <span className="font-mono text-faint">{role.slug}</span>
                            {role.description ? <> · {role.description}</> : null}
                          </span>
                        </span>
                      </Link>
                    </TD>
                    <TD>
                      <RankMeter priority={role.priority} myPriority={access.myPriority} />
                    </TD>
                    <TD className="hidden text-muted sm:table-cell tabular">
                      <span className="inline-flex items-center gap-1.5">
                        {permissionCount === null ? '—' : role.permissionKeys.includes('*:*') ? 'All' : permissionCount}
                        {role.permissionKeys.some((key) => key.includes('*')) && !role.permissionKeys.includes('*:*') ? (
                          <Tooltip content={`Stored with wildcards: ${role.permissionKeys.filter((key) => key.includes('*')).join(', ')}`}>
                            <span tabIndex={0} className="rounded border border-brand-200 bg-brand-50 px-1 font-mono text-[10.5px] leading-4 text-brand-800">
                              *
                            </span>
                          </Tooltip>
                        ) : null}
                      </span>
                    </TD>
                    <TD className="hidden md:table-cell" onClick={(event) => event.stopPropagation()}>
                      {!countsAllowed ? (
                        <span className="text-faint">—</span>
                      ) : memberCount === undefined ? (
                        <Skeleton className="h-3 w-14" />
                      ) : memberCount === 0 ? (
                        <span className="text-faint">None</span>
                      ) : (
                        <Link
                          to={`${base}?role=${role.id}`}
                          className="rounded-sm text-ink-soft underline decoration-line-strong underline-offset-4 hover:text-ink hover:decoration-ink-soft"
                        >
                          {pluralize(memberCount, 'member')}
                        </Link>
                      )}
                    </TD>
                    <TD className="text-right" onClick={(event) => event.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" className="text-faint data-[state=open]:bg-well" aria-label={`Actions for ${role.name}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-60">
                          <DropdownMenuItem onSelect={() => navigate(`${base}/roles/${role.id}`)}>
                            {role.isSystem || aboveMe || !can('role:update') ? <Eye /> : <Settings2 />}
                            {role.isSystem || aboveMe || !can('role:update') ? 'View' : 'Edit'}
                          </DropdownMenuItem>
                          {can('role:create') ? (
                            <DropdownMenuItem onSelect={() => navigate(`${base}/roles/new?from=${role.id}`)}>
                              <Copy />
                              Duplicate as custom role
                            </DropdownMenuItem>
                          ) : null}
                          {deletable ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                tone="danger"
                                disabled={!!memberCount}
                                onSelect={() => deleteDialog.show(role)}
                                className="items-start"
                              >
                                <Trash2 className="mt-0.5" />
                                <span>
                                  Delete…
                                  {memberCount ? (
                                    <span className="mt-0.5 block text-xs font-normal">
                                      Assigned to {pluralize(memberCount, 'member')}. Reassign them first.
                                    </span>
                                  ) : null}
                                </span>
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TD>
                  </TR>
                );
              })
            )}
          </TBody>
        </Table>
      </Card>

      <p className="mt-3 text-xs leading-relaxed text-faint">
        Built-in roles are the same in every workspace and can't be changed. Duplicate one to start a custom role such as
        “HR Manager”.
      </p>

      <DeleteRoleDialog role={deleteDialog.target} open={deleteDialog.open} onOpenChange={deleteDialog.onOpenChange} />
      <RecomputeDialog open={recomputeDialog.open} onOpenChange={recomputeDialog.onOpenChange} />
    </>
  );
}

/** Priority as a number and a small bar; roles at or above you are locked. */
function RankMeter({ priority, myPriority }: { priority: number; myPriority: number }) {
  const aboveMe = priority >= myPriority;
  return (
    <span className="flex items-center gap-2.5">
      <span className="w-7 text-right font-mono text-[12.5px] text-ink-soft tabular">{priority}</span>
      <span className="relative hidden h-1.5 w-16 overflow-hidden rounded-full bg-well-strong sm:block" aria-hidden>
        <span
          className={cn('absolute inset-y-0 left-0 rounded-full', aboveMe ? 'bg-line-strong' : 'bg-brand-400')}
          style={{ width: `${priority}%` }}
        />
      </span>
      {aboveMe ? (
        <Tooltip content="Ranks at or above you, so you can't grant or edit it.">
          <span tabIndex={0} className="rounded-sm text-faint" aria-label="Ranks at or above you">
            <Lock className="size-3.5" />
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}
