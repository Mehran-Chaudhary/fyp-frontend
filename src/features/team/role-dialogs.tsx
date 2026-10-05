import { useMutation, useQuery } from '@tanstack/react-query';
import { MailWarning, RefreshCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { OutcomeUnknown } from '@/components/feedback/outcome-unknown';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/misc';
import { rolesApi } from '@/lib/api/endpoints';
import { hasCode, isOutcomeUnknown } from '@/lib/api/errors';
import type { Role } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { pendingInvitationsQuery } from '@/lib/queries';
import { toast, toastError } from '@/lib/toast';
import { pluralize } from '@/lib/utils';
import { invalidateInvitations, invalidateRoles } from '@/lib/workspace/cache';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';

/**
 * Delete a custom role (P2-API-25). Refused with ROLE_IN_USE while an active or
 * suspended member holds it. Pending invitations don't count on the server
 * (spec P2-G06), so the dialog looks them up itself and warns before they break.
 */
export function DeleteRoleDialog({
  role,
  open,
  onOpenChange,
  onDeleted,
}: {
  role: Role | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const workspace = useWorkspace();
  const workspaceId = workspace.id;
  const can = useCan();
  const [error, setError] = useState<string | null>(null);
  // ROLE_IN_USE: how many still hold it, to point at them.
  const [inUse, setInUse] = useState<number | null>(null);
  const [uncertain, setUncertain] = useState<unknown>(null);

  const pending = useQuery({ ...pendingInvitationsQuery(workspaceId), enabled: open && !!role && can('member:read') });
  const now = pending.dataUpdatedAt;
  const affected = role
    ? (pending.data?.items ?? []).filter((invitation) => invitation.role?.id === role.id && Date.parse(invitation.expiresAt) > now)
    : [];

  const close = () => {
    onOpenChange(false);
    window.setTimeout(() => {
      setError(null);
      setInUse(null);
      setUncertain(null);
    }, 200);
  };

  const remove = useMutation({
    mutationFn: (target: Role) => rolesApi.remove(workspaceId, target.id),
    onSuccess: (_result, target) => {
      toast.success(`Deleted the ${target.name} role`, { description: 'Its name can be used again.' });
      void invalidateRoles(workspaceId);
      // Invitations that offered it now show no role.
      void invalidateInvitations(workspaceId);
      close();
      onDeleted?.();
    },
    onError: (err) => {
      if (hasCode(err, 'ROLE_NOT_FOUND')) {
        toast.info('That role was already deleted');
        void invalidateRoles(workspaceId);
        close();
        onDeleted?.();
        return;
      }
      if (hasCode(err, 'ROLE_IN_USE')) {
        void invalidateRoles(workspaceId);
        const count = err.details?.memberCount;
        setInUse(typeof count === 'number' ? count : 0);
        setError(null);
        return;
      }
      if (isOutcomeUnknown(err)) {
        void invalidateRoles(workspaceId);
        setUncertain(err);
        return;
      }
      setError(messageFor(err));
    },
  });

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      icon={<Trash2 />}
      tone="danger"
      size="md"
      title={`Delete the ${role?.name ?? ''} role?`}
      description="This can't be undone. A role still assigned to anyone, suspended members included, can't be deleted: give them another role first. Members are never reassigned automatically."
      confirmLabel="Delete role"
      pending={remove.isPending}
      confirmDisabled={inUse !== null || !!uncertain}
      error={error}
      onConfirm={() => role && remove.mutate(role)}
    >
      {open && role && can('member:read') ? (
        pending.isPending ? (
          <Skeleton className="h-14 w-full rounded-lg" />
        ) : affected.length > 0 ? (
          <Callout
            tone="warning"
            icon={<MailWarning className="size-4" />}
            title={`${pluralize(affected.length, 'pending invitation')} ${affected.length === 1 ? 'offers' : 'offer'} this role`}
            action={
              <Link
                to={`/w/${workspace.slug}/team/invitations?status=pending`}
                onClick={close}
                className="font-medium underline underline-offset-4"
              >
                Review pending invitations
              </Link>
            }
          >
            The server doesn't stop the deletion for them, but accepting or resending{' '}
            {affected.length === 1 ? 'it' : 'them'} would fail afterwards. Revoke {affected.length === 1 ? 'it' : 'them'} and
            invite again with another role first.
          </Callout>
        ) : null
      ) : null}
      {inUse !== null && role ? (
        <Callout
          tone="warning"
          title="This role is still assigned"
          action={
            <Link to={`/w/${workspace.slug}/team?role=${role.id}`} onClick={close} className="font-medium underline underline-offset-4">
              View the members who hold it
            </Link>
          }
        >
          {inUse > 0 ? `${pluralize(inUse, 'member')} ${inUse === 1 ? 'holds' : 'hold'} it.` : 'Members still hold it.'} Give
          them another role, then delete this one.
        </Callout>
      ) : null}
      {uncertain ? (
        <OutcomeUnknown error={uncertain}>
          The role may have been deleted. The role list is being refreshed; check it before trying again.
        </OutcomeUnknown>
      ) : null}
    </ConfirmDialog>
  );
}

/**
 * Recompute every member's effective permissions (P2-API-26): a repair tool,
 * never run automatically. Ordinary role changes already recompute.
 */
export function RecomputeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const workspace = useWorkspace();
  const workspaceId = workspace.id;
  const recompute = useMutation({
    mutationFn: () => rolesApi.recompute(workspaceId),
    onSuccess: ({ membersRecomputed }) => {
      toast.success(`Recomputed permissions for ${pluralize(membersRecomputed, 'member')}`, {
        description: 'Including suspended members. Your own access has been re-read.',
      });
      void invalidateRoles(workspaceId);
      onOpenChange(false);
    },
    onError: (error) => {
      if (isOutcomeUnknown(error)) {
        // Safe to run again, but say what happened rather than repeat it silently.
        toast.warning("We couldn't confirm the recompute", { description: 'It may have run. Running it again is harmless.' });
        void invalidateRoles(workspaceId);
        return;
      }
      toastError(error, "Couldn't recompute permissions");
    },
  });

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<RefreshCcw />}
      tone="warning"
      title="Recompute everyone's permissions?"
      description="An advanced repair tool. It rebuilds the effective permissions of every member who hasn't been removed, from their current roles. Role changes already do this automatically, so you'd only need it if access looks out of step with the roles shown. It can't grant anything the roles don't, or bring back removed members."
      confirmLabel="Recompute"
      pending={recompute.isPending}
      onConfirm={() => recompute.mutate()}
    />
  );
}
