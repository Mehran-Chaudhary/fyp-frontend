import { useMutation, useQuery } from '@tanstack/react-query';
import { Ban, Inbox, MailPlus, MoreHorizontal, RefreshCw, RotateCcw, Send, UserSearch } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/misc';
import { Pagination } from '@/components/ui/pagination';
import { RelativeTime } from '@/components/ui/relative-time';
import { Segmented } from '@/components/ui/segmented';
import { Table, TableMessage, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { useDialogTarget } from '@/components/ui/use-dialog-target';
import { invitationsApi } from '@/lib/api/endpoints';
import { hasCode, isApiError, isOutcomeUnknown } from '@/lib/api/errors';
import type { Invitation, InvitationStatusValue } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { invitationsQuery } from '@/lib/queries';
import { toast, toastError } from '@/lib/toast';
import { cn, formatCountdown, formatDate, formatDateTime } from '@/lib/utils';
import { invalidateInvitations } from '@/lib/workspace/cache';
import { invitationActionable, invitationStatus, type InvitationDisplayStatus } from '@/lib/workspace/status';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { useInviteDialog } from './use-invite-dialog';

type StatusFilter = 'all' | 'pending' | 'expired' | 'accepted' | 'revoked';

const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'expired', label: 'Expired' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'revoked', label: 'Revoked' },
];

const DISPLAY: Record<InvitationDisplayStatus, { label: string; tone: 'info' | 'warning' | 'success' | 'neutral' }> = {
  pending: { label: 'Pending', tone: 'info' },
  expired: { label: 'Expired', tone: 'warning' },
  accepted: { label: 'Accepted', tone: 'success' },
  revoked: { label: 'Revoked', tone: 'neutral' },
};

const COLUMNS = 7;

/**
 * Team → Invitations (P2-API-16–19). Only status and page are sent: the server
 * has no invitation search or sort, so none is offered. Status filters use the
 * STORED status; a pending invitation past its expiry shows as Expired here even
 * before the server marks it.
 */
export function InvitationsPage() {
  const workspace = useWorkspace();
  const can = useCan();
  useDocumentTitle('Invitations');

  if (!can('member:read')) {
    return (
      <Card>
        <NoAccessState permissions={['member:read']} workspaceName={workspace.name} />
      </Card>
    );
  }
  return <InvitationsList />;
}

function InvitationsList() {
  const workspace = useWorkspace();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const [, setInviteOpen] = useInviteDialog();
  const status = (FILTERS.some((filter) => filter.value === params.get('status')) ? params.get('status') : 'all') as StatusFilter;
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);

  const query = useQuery(
    invitationsQuery(workspace.id, {
      page,
      limit: 20,
      ...(status !== 'all' ? { status: status.toUpperCase() as InvitationStatusValue } : {}),
    }),
  );

  // The last invitation on a later page went away: step back to a page that has rows.
  const lastPage = query.data?.pagination.totalPages ?? 1;
  const overshot = !!query.data && !query.isPlaceholderData && (query.data.items.length ?? 0) === 0 && page > 1;
  useEffect(() => {
    if (!overshot) return;
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (lastPage > 1) next.set('page', String(lastPage));
        else next.delete('page');
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  }, [overshot, lastPage, setParams]);

  const update = (patch: { status?: StatusFilter; page?: number }) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        const nextStatus = patch.status ?? status;
        const nextPage = patch.status !== undefined ? 1 : (patch.page ?? page);
        if (nextStatus === 'all') next.delete('status');
        else next.set('status', nextStatus);
        if (nextPage > 1) next.set('page', String(nextPage));
        else next.delete('page');
        return next;
      },
      { replace: true, preventScrollReset: true },
    );

  const canInvite = can('member:invite');
  const revokeDialog = useDialogTarget<Invitation>();
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const resend = useMutation({
    mutationFn: (invitation: Invitation) => invitationsApi.resend(workspace.id, invitation.id),
    onSuccess: (invitation) => {
      toast.success(`New link for ${invitation.email}`, {
        description: `Email delivery was attempted. The previous link stopped working; they need the newest email. It expires ${formatDate(invitation.expiresAt)}.`,
      });
    },
    onError: (error, invitation) => {
      if (isOutcomeUnknown(error)) {
        toast.warning(`We couldn't confirm the resend to ${invitation.email}`, {
          description: 'The list is being refreshed: check “Sent” before resending, so they don’t get extra emails.',
        });
      } else if (hasCode(error, 'ROLE_NOT_FOUND')) {
        toast.error("This invitation's role was deleted", {
          description: 'Revoke it and send a new invitation with another role.',
        });
      } else if (hasCode(error, 'INVITATION_REVOKED')) {
        toast.info('This invitation was revoked', { description: 'Send a new invitation instead.' });
      } else if (hasCode(error, 'INVITATION_ALREADY_ACCEPTED')) {
        toast.info(`${invitation.email} already accepted`, { description: 'They are a member now.' });
      } else if (hasCode(error, 'INVITATION_ALREADY_PENDING')) {
        const expiresAt = isApiError(error) && typeof error.details?.expiresAt === 'string' ? error.details.expiresAt : null;
        toast.info(`A newer invitation is pending for ${invitation.email}`, {
          description: expiresAt ? `It expires ${formatDateTime(expiresAt)}. The list has been refreshed.` : 'The list has been refreshed.',
        });
      } else if (hasCode(error, 'RATE_LIMIT_EXCEEDED')) {
        toast.warning('Too many emails', {
          description: error.retryAfterSeconds
            ? `You can resend again in ${formatCountdown(error.retryAfterSeconds)}.`
            : 'Invitation emails are rate limited. Try again later.',
        });
      } else {
        toastError(error, "Couldn't resend the invitation");
      }
    },
    onSettled: () => void invalidateInvitations(workspace.id),
  });

  const revoke = useMutation({
    mutationFn: (invitation: Invitation) => invitationsApi.revoke(workspace.id, invitation.id),
    onSuccess: (invitation) => {
      toast.success('Invitation revoked', { description: `The link sent to ${invitation.email} no longer works.` });
      revokeDialog.onOpenChange(false);
    },
    onError: (error) => {
      if (isOutcomeUnknown(error)) {
        setRevokeError("We couldn't confirm the revocation. The list is being refreshed: check its status before trying again.");
        return;
      }
      if (hasCode(error, 'INVITATION_NOT_FOUND', 'INVITATION_ALREADY_ACCEPTED')) {
        toastError(error, "Couldn't revoke");
        revokeDialog.onOpenChange(false);
        return;
      }
      setRevokeError(messageFor(error));
    },
    onSettled: () => void invalidateInvitations(workspace.id),
  });

  // Statuses are judged at the time the list was fetched (pure, and refreshed with it).
  const now = query.dataUpdatedAt;
  const items = query.data?.items ?? [];

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line p-3 sm:px-4">
          <Segmented aria-label="Status" value={status} onValueChange={(value) => update({ status: value })} options={FILTERS} />
          <div className="flex items-center gap-2">
            <p className="hidden text-xs text-muted md:block">Resending issues a new link and voids the old one.</p>
            <Tooltip content="Refresh, e.g. after someone accepts">
              <Button variant="ghost" size="icon-sm" className="text-muted" onClick={() => void query.refetch()} aria-label="Refresh invitations">
                <RefreshCw className={cn(query.isFetching && !query.isPending && 'animate-spin')} />
              </Button>
            </Tooltip>
          </div>
        </div>

        <Table className={cn('transition-opacity', query.isPlaceholderData && 'opacity-60')}>
          <THead>
            <tr>
              <TH>Email</TH>
              <TH>Role</TH>
              <TH>Status</TH>
              <TH className="hidden lg:table-cell">Invited by</TH>
              <TH className="hidden md:table-cell">Sent</TH>
              <TH className="hidden sm:table-cell">Expires</TH>
              <TH className="w-12">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {query.isPending ? (
              Array.from({ length: 4 }, (_, index) => (
                <tr key={index}>
                  <TD>
                    <Skeleton className="h-3.5 w-48" />
                  </TD>
                  <TD>
                    <Skeleton className="h-3.5 w-20" />
                  </TD>
                  <TD>
                    <Skeleton className="h-5 w-16 rounded-md" />
                  </TD>
                  <TD className="hidden lg:table-cell">
                    <Skeleton className="h-3.5 w-24" />
                  </TD>
                  <TD className="hidden md:table-cell">
                    <Skeleton className="h-3.5 w-20" />
                  </TD>
                  <TD className="hidden sm:table-cell">
                    <Skeleton className="h-3.5 w-20" />
                  </TD>
                  <TD />
                </tr>
              ))
            ) : query.isError && !query.data ? (
              <TableMessage colSpan={COLUMNS}>
                <ErrorState error={query.error} title="We couldn't load the invitations" onRetry={() => void query.refetch()} retrying={query.isFetching} />
              </TableMessage>
            ) : items.length === 0 ? (
              <TableMessage colSpan={COLUMNS}>
                <EmptyState
                  icon={<Inbox />}
                  title={status === 'all' ? 'No invitations yet' : `No ${status} invitations`}
                  description={
                    status === 'all'
                      ? 'Invite colleagues by email; each invitation shows up here with its status.'
                      : status === 'expired'
                        ? 'This filter shows invitations the server has marked as expired. Pending ones past their expiry appear under Pending, labelled Expired.'
                        : undefined
                  }
                  action={
                    canInvite && status === 'all' ? (
                      <Button size="sm" onClick={() => setInviteOpen(true)}>
                        <MailPlus />
                        Invite people
                      </Button>
                    ) : null
                  }
                />
              </TableMessage>
            ) : (
              items.map((invitation) => {
                const display = invitationStatus(invitation, now);
                const actionable = canInvite && invitationActionable(invitation, now);
                const resending = resend.isPending && resend.variables?.id === invitation.id;
                return (
                  <TR key={invitation.id}>
                    <TD className="max-w-[16rem]">
                      <span className="block truncate font-medium text-ink">{invitation.email}</span>
                      <span className="block truncate text-xs text-muted lg:hidden">
                        {invitation.invitedBy ? `Invited by ${invitation.invitedBy.name}` : null}
                      </span>
                    </TD>
                    <TD>{invitation.role?.name ?? <span className="text-faint">Deleted role</span>}</TD>
                    <TD>
                      <Badge tone={DISPLAY[display].tone} dot>
                        {DISPLAY[display].label}
                      </Badge>
                    </TD>
                    <TD className="hidden text-muted lg:table-cell">
                      {invitation.invitedBy?.name ?? <span className="text-faint">Former member</span>}
                    </TD>
                    <TD className="hidden text-muted md:table-cell">
                      <span className="inline-flex items-center gap-1.5">
                        <RelativeTime value={invitation.lastSentAt ?? invitation.createdAt} />
                        {invitation.sendCount > 1 ? (
                          <Tooltip content={`${invitation.sendCount} send attempts (not delivery confirmations)`}>
                            <span tabIndex={0} className="rounded bg-well px-1 font-mono text-[11px] text-ink-soft tabular">
                              ×{invitation.sendCount}
                            </span>
                          </Tooltip>
                        ) : null}
                      </span>
                    </TD>
                    <TD className="hidden sm:table-cell">
                      {display === 'pending' ? (
                        <span className="text-muted">
                          <RelativeTime value={invitation.expiresAt} />
                        </span>
                      ) : display === 'expired' ? (
                        <span className="text-warning-700">
                          <RelativeTime value={invitation.expiresAt} />
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </TD>
                    <TD className="text-right">
                      {display === 'accepted' ? (
                        <Tooltip content="Find them in Members">
                          <Button asChild variant="ghost" size="icon-sm" className="text-faint">
                            <Link
                              to={`/w/${workspace.slug}/team?q=${encodeURIComponent(invitation.email)}`}
                              aria-label={`Find ${invitation.email} in Members`}
                            >
                              <UserSearch />
                            </Link>
                          </Button>
                        </Tooltip>
                      ) : actionable ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-faint data-[state=open]:bg-well"
                              loading={resending}
                              aria-label={`Actions for the invitation to ${invitation.email}`}
                            >
                              {resending ? null : <MoreHorizontal />}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="w-52">
                            <DropdownMenuItem onSelect={() => resend.mutate(invitation)}>
                              {display === 'expired' ? <RotateCcw /> : <Send />}
                              {display === 'expired' ? 'Resend and revive' : 'Resend'}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              tone="danger"
                              onSelect={() => {
                                setRevokeError(null);
                                revokeDialog.show(invitation);
                              }}
                            >
                              <Ban />
                              Revoke…
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </TD>
                  </TR>
                );
              })
            )}
          </TBody>
        </Table>

        {query.data && query.data.pagination.totalItems > 0 ? (
          <div className="border-t border-line px-4 py-3 sm:px-6">
            <Pagination
              pagination={query.data.pagination}
              onPageChange={(next) => update({ page: next })}
              busy={query.isFetching}
              noun={['invitation', 'invitations']}
            />
          </div>
        ) : null}
      </Card>

      <p className="mt-3 text-xs leading-relaxed text-faint">
        Invitation links only exist in the email; they can't be copied from here. “Sent” counts send attempts, not
        deliveries. Revoking an invitation never removes someone who already joined: manage them under Members.
      </p>

      <ConfirmDialog
        open={revokeDialog.open}
        onOpenChange={revokeDialog.onOpenChange}
        icon={<Ban />}
        tone="danger"
        title="Revoke this invitation?"
        description={
          <>
            The link sent to <span className="font-medium text-ink-soft">{revokeDialog.target?.email}</span> stops working at
            once. A revoked invitation can't be resent; send a new one if you change your mind.
          </>
        }
        confirmLabel="Revoke invitation"
        pending={revoke.isPending}
        error={revokeError}
        onConfirm={() => revokeDialog.target && revoke.mutate(revokeDialog.target)}
      />
    </>
  );
}
