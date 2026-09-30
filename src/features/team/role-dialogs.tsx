import { useMutation } from '@tanstack/react-query';
import { RefreshCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { rolesApi } from '@/lib/api/endpoints';
import { hasCode } from '@/lib/api/errors';
import type { Role } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { toast, toastError } from '@/lib/toast';
import { pluralize } from '@/lib/utils';
import { invalidateRoles } from '@/lib/workspace/cache';
import { useWorkspace } from '@/features/workspaces/workspace-context';

/** Delete a custom role (E54). Refused with ROLE_IN_USE while anyone holds it. */
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
  const [error, setError] = useState<string | null>(null);
  // ROLE_IN_USE: how many still hold it, to point at them (spec §7).
  const [inUse, setInUse] = useState<number | null>(null);

  const close = () => {
    onOpenChange(false);
    window.setTimeout(() => {
      setError(null);
      setInUse(null);
    }, 200);
  };

  const remove = useMutation({
    mutationFn: (target: Role) => rolesApi.remove(workspace.id, target.id),
    onSuccess: (_result, target) => {
      toast.success(`Deleted the ${target.name} role`, { description: 'Its name can be used again.' });
      void invalidateRoles(workspace.id);
      close();
      onDeleted?.();
    },
    onError: (err) => {
      if (hasCode(err, 'ROLE_NOT_FOUND')) {
        toast.info('That role was already deleted');
        void invalidateRoles(workspace.id);
        close();
        onDeleted?.();
        return;
      }
      if (hasCode(err, 'ROLE_IN_USE')) {
        void invalidateRoles(workspace.id);
        const count = err.details?.memberCount;
        setInUse(typeof count === 'number' ? count : 0);
        setError(null);
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
      title={`Delete the ${role?.name ?? ''} role?`}
      description="This can't be undone. A role that's still assigned to someone can't be deleted; reassign them first. The name can be used again later."
      confirmLabel="Delete role"
      pending={remove.isPending}
      confirmDisabled={inUse !== null}
      error={error}
      onConfirm={() => role && remove.mutate(role)}
    >
      {inUse !== null && role ? (
        <Callout
          tone="warning"
          title="This role is still assigned"
          action={
            <Link
              to={`/w/${workspace.slug}/team?role=${role.id}`}
              onClick={close}
              className="font-medium underline underline-offset-4"
            >
              View the members who hold it
            </Link>
          }
        >
          {inUse > 0 ? `${pluralize(inUse, 'member')} ${inUse === 1 ? 'holds' : 'hold'} it.` : 'Members still hold it.'} Give them
          another role, then delete this one.
        </Callout>
      ) : null}
    </ConfirmDialog>
  );
}

/** Recompute every member's effective permissions (E55): a repair tool. */
export function RecomputeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const workspace = useWorkspace();
  const recompute = useMutation({
    mutationFn: () => rolesApi.recompute(workspace.id),
    onSuccess: ({ membersRecomputed }) => {
      toast.success(`Recomputed permissions for ${pluralize(membersRecomputed, 'member')}`);
      void invalidateRoles(workspace.id);
      onOpenChange(false);
    },
    onError: (error) => toastError(error, "Couldn't recompute permissions"),
  });

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={<RefreshCcw />}
      tone="warning"
      title="Recompute everyone's permissions?"
      description="A repair tool. It rebuilds every member's effective permissions from their current roles. This already happens automatically whenever a role changes, so you'd only need it if access looks out of step with the roles shown here."
      confirmLabel="Recompute"
      pending={recompute.isPending}
      onConfirm={() => recompute.mutate()}
    />
  );
}
