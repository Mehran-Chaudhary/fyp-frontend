import { useMutation } from '@tanstack/react-query';
import { KeySquare, UserMinus, UserX } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { OutcomeUnknown } from '@/components/feedback/outcome-unknown';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { membersApi } from '@/lib/api/endpoints';
import { hasCode, isOutcomeUnknown } from '@/lib/api/errors';
import type { Member } from '@/lib/api/types';
import { queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast } from '@/lib/toast';
import { pluralize } from '@/lib/utils';
import { invalidateApiKeys, invalidateMembers } from '@/lib/workspace/cache';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { handleMemberGone, memberActionMessage, storeMember } from './member-helpers';

const REASON_MAX = 255;

/** A link to the API keys a member created, where the viewer may read keys. */
function KeysLink({ member, onNavigate }: { member: Member; onNavigate: () => void }) {
  const workspace = useWorkspace();
  const can = useCan();
  if (!can('apikey:read')) return null;
  return (
    <Link
      to={`/w/${workspace.slug}/settings/api-keys?creator=${member.userId}`}
      onClick={onNavigate}
      className="inline-flex items-center gap-1.5 font-medium underline underline-offset-4"
    >
      <KeySquare className="size-3.5" aria-hidden />
      Review the API keys {member.firstName || member.displayName} created
    </Link>
  );
}

/**
 * Suspend (P2-API-12): this membership stops working immediately and its roles
 * are kept. API keys the member created are NOT revoked (spec P2-G02), and the
 * dialog says so rather than promising all access stops.
 */
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
  const workspaceId = workspace.id;
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<unknown>(null);

  const close = () => {
    onOpenChange(false);
    window.setTimeout(() => {
      setReason('');
      setError(null);
      setUncertain(null);
    }, 200);
  };

  const suspend = useMutation({
    mutationFn: (target: Member) => membersApi.suspend(workspaceId, target.id, reason.trim() || undefined),
    onSuccess: (updated) => {
      storeMember(workspaceId, updated);
      toast.success(`${updated.displayName} is suspended`, {
        description: 'Their membership stopped working. API keys they created still work until you revoke them.',
      });
      close();
    },
    onError: (err, target) => {
      if (hasCode(err, 'MEMBERSHIP_NOT_FOUND')) {
        handleMemberGone(workspaceId, target.displayName);
        close();
        onGone?.();
        return;
      }
      if (isOutcomeUnknown(err)) {
        setUncertain(err);
        void invalidateMembers(workspaceId);
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
      title={`Suspend ${member?.displayName ?? 'this member'} in ${workspace.name}?`}
      description={
        <>
          Their membership of {workspace.name} stops working at once and their roles are kept for when you reactivate
          them. It doesn't sign them out of their account or other workspaces.{' '}
          <span className="font-medium text-ink-soft">They see the reason you give when they're refused.</span>
        </>
      }
      confirmLabel="Suspend member"
      confirmVariant="primary"
      pending={suspend.isPending}
      confirmDisabled={tooLong || !!uncertain}
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
          placeholder="Access paused pending team review"
          disabled={suspend.isPending}
        />
      </Field>
      {member ? (
        <Callout tone="neutral" title="API keys keep working">
          Suspension doesn't revoke the API keys this person created. Revoke them separately if machine access should
          stop too.
          <span className="mt-1.5 block">
            <KeysLink member={member} onNavigate={close} />
          </span>
        </Callout>
      ) : null}
      {uncertain ? (
        <OutcomeUnknown error={uncertain}>
          The suspension may have gone through. The member list is being refreshed: check their status before trying
          again.
        </OutcomeUnknown>
      ) : null}
    </ConfirmDialog>
  );
}

/**
 * Remove (P2-API-14): soft-deletes the membership and revokes the API keys the
 * member created here. Not account deletion, and no undo: coming back needs a new
 * invitation. The membership and key writes aren't one transaction (spec
 * P2-G09), so a failure re-reads both.
 */
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
  const workspaceId = workspace.id;
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<unknown>(null);

  const close = () => {
    onOpenChange(false);
    window.setTimeout(() => {
      setError(null);
      setUncertain(null);
    }, 200);
  };

  const reconcile = (target: Member) => {
    void invalidateMembers(workspaceId);
    void invalidateApiKeys(workspaceId);
    void queryClient.invalidateQueries({ queryKey: queryKeys.memberDetail(workspaceId, target.id) });
  };

  const remove = useMutation({
    mutationFn: (target: Member) => membersApi.remove(workspaceId, target.id),
    onSuccess: (result, target) => {
      reconcile(target);
      toast.success(`Removed ${target.displayName} from ${workspace.name}`, {
        description:
          result.revokedApiKeys > 0
            ? `${pluralize(result.revokedApiKeys, 'API key')} they created here ${result.revokedApiKeys === 1 ? 'was' : 'were'} revoked.`
            : 'They had no active API keys here.',
      });
      close();
      onRemoved?.();
    },
    onError: (err, target) => {
      if (hasCode(err, 'MEMBERSHIP_NOT_FOUND')) {
        handleMemberGone(workspaceId, target.displayName);
        close();
        onRemoved?.();
        return;
      }
      // Partial or unknown: re-read membership AND keys rather than assume nothing happened.
      reconcile(target);
      if (isOutcomeUnknown(err)) {
        setUncertain(err);
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
      description={
        <>
          Their membership ends at once and <span className="font-medium text-ink-soft">every API key they created in
          this workspace is revoked</span>. Their account isn't deleted. To come back they need a new invitation; there's
          no undo.
        </>
      }
      confirmLabel="Remove member"
      confirmDisabled={!!uncertain}
      pending={remove.isPending}
      error={error}
      onConfirm={() => member && remove.mutate(member)}
    >
      {uncertain ? (
        <OutcomeUnknown error={uncertain}>
          The removal may have gone through, possibly only in part. The member and API key lists are being refreshed:
          check both before trying again.
        </OutcomeUnknown>
      ) : null}
    </ConfirmDialog>
  );
}
