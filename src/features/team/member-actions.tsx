import { useMutation } from '@tanstack/react-query';
import { UserMinus, UserX } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { membersApi } from '@/lib/api/endpoints';
import { hasCode } from '@/lib/api/errors';
import type { Member } from '@/lib/api/types';
import { queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast } from '@/lib/toast';
import { pluralize } from '@/lib/utils';
import { invalidateMembers } from '@/lib/workspace/cache';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { handleMemberGone, memberActionMessage, storeMember } from './member-helpers';

const REASON_MAX = 255;

/** Suspend (E41): access ends immediately and the reason is shown to the member. */
export function SuspendMemberDialog({
  member,
  open,
  onOpenChange,
  onGone,
}: {
  member: Member | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGone?: () => void;
}) {
  const workspace = useWorkspace();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    onOpenChange(false);
    window.setTimeout(() => {
      setReason('');
      setError(null);
    }, 200);
  };

  const suspend = useMutation({
    mutationFn: (target: Member) => membersApi.suspend(workspace.id, target.id, reason.trim() || undefined),
    onSuccess: (updated) => {
      storeMember(workspace.id, updated);
      toast.success(`${updated.displayName} is suspended`, {
        description: 'They lost access to this workspace immediately.',
      });
      close();
    },
    onError: (err, target) => {
      if (hasCode(err, 'MEMBERSHIP_NOT_FOUND')) {
        handleMemberGone(workspace.id, target.displayName);
        close();
        onGone?.();
        return;
      }
      setError(memberActionMessage(err));
    },
  });

  const tooLong = reason.length > REASON_MAX;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      icon={<UserX />}
      tone="warning"
      size="md"
      title={`Suspend ${member?.displayName ?? 'this member'}?`}
      description={
        <>
          They lose access to {workspace.name} immediately until someone reactivates them.{' '}
          <span className="font-medium text-ink-soft">The reason is shown to them.</span>
        </>
      }
      confirmLabel="Suspend member"
      confirmVariant="primary"
      pending={suspend.isPending}
      confirmDisabled={tooLong}
      error={error}
      onConfirm={() => member && suspend.mutate(member)}
    >
      <Field
        label="Reason"
        optional
        error={tooLong ? `Use no more than ${REASON_MAX} characters.` : undefined}
        hint={<span className="tabular">{reason.length}/{REASON_MAX}</span>}
      >
        <Textarea
          rows={3}
          className="min-h-20"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Policy review in progress"
          disabled={suspend.isPending}
        />
      </Field>
    </ConfirmDialog>
  );
}

/** Remove (E43): access ends, the member's API keys here are revoked, and they can be invited again. */
export function RemoveMemberDialog({
  member,
  open,
  onOpenChange,
  onRemoved,
}: {
  member: Member | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved?: () => void;
}) {
  const workspace = useWorkspace();
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    onOpenChange(false);
    window.setTimeout(() => setError(null), 200);
  };

  const remove = useMutation({
    mutationFn: (target: Member) => membersApi.remove(workspace.id, target.id),
    onSuccess: (result, target) => {
      void invalidateMembers(workspace.id);
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys(workspace.id) });
      toast.success(`Removed ${target.displayName}`, {
        description:
          result.revokedApiKeys > 0
            ? `${pluralize(result.revokedApiKeys, 'API key')} they created ${result.revokedApiKeys === 1 ? 'was' : 'were'} revoked.`
            : 'They had no API keys in this workspace.',
      });
      close();
      onRemoved?.();
    },
    onError: (err, target) => {
      if (hasCode(err, 'MEMBERSHIP_NOT_FOUND')) {
        handleMemberGone(workspace.id, target.displayName);
        close();
        onRemoved?.();
        return;
      }
      setError(memberActionMessage(err));
    },
  });

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      icon={<UserMinus />}
      tone="danger"
      size="md"
      title={`Remove ${member?.displayName ?? 'this member'} from ${workspace.name}?`}
      description="They lose access immediately. API keys they created in this workspace are revoked. You can invite them again later."
      confirmLabel="Remove member"
      pending={remove.isPending}
      error={error}
      onConfirm={() => member && remove.mutate(member)}
    />
  );
}
