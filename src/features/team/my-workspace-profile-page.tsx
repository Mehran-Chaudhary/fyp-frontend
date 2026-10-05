import { useMutation } from '@tanstack/react-query';
import { ArrowRight, DoorOpen, KeySquare, Pencil, RefreshCw, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { OutcomeUnknown } from '@/components/feedback/outcome-unknown';
import { PageHeader } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Avatar } from '@/components/ui/misc';
import { RelativeTime } from '@/components/ui/relative-time';
import { membersApi } from '@/lib/api/endpoints';
import { hasCode, isOutcomeUnknown } from '@/lib/api/errors';
import type { Member } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { toast } from '@/lib/toast';
import { formatDate } from '@/lib/utils';
import { forgetWorkspace } from '@/lib/workspace/cache';
import { isWorkspaceStillListed } from '@/lib/workspace/reconcile';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { MemberStatusBadge, OwnerBadge, RoleChips } from './member-bits';
import { MemberProfileForm } from './member-profile-form';

/**
 * Your own membership (spec §4 `/my-workspace-profile`): your local name and
 * title, your roles, and leaving. Needs no admin permission at all: it reads
 * `/members/me`, not the directory.
 */
export function MyWorkspaceProfilePage() {
  const workspace = useWorkspace();
  useDocumentTitle('Your workspace profile');
  const membership = workspace.membership;

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Your workspace profile"
        description={`How you appear in ${workspace.name}, and your membership of it. Your account profile is separate.`}
      />
      {membership ? (
        <>
          <ProfileCard membership={membership} />
          <LeaveCard membership={membership} />
        </>
      ) : (
        <Card>
          <CardBody>
            <Callout tone="neutral" title="No membership to show">
              You're in {workspace.name} without a readable membership (for example as a platform administrator), so
              there's no workspace profile to edit or membership to leave here.
            </Callout>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function ProfileCard({ membership }: { membership: Member }) {
  const [editing, setEditing] = useState(false);
  return (
    <Card>
      <CardHeader
        icon={<UserRound />}
        title="Profile in this workspace"
        actions={
          editing ? null : (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil />
              Edit
            </Button>
          )
        }
      />
      <CardBody className="grid gap-5">
        <div className="flex items-center gap-3.5">
          <Avatar name={membership.displayName} src={membership.avatarUrl} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-ink">{membership.displayName}</p>
            <p className="truncate text-[13px] text-muted">{membership.email}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <MemberStatusBadge status={membership.status} />
              {membership.isOwner ? <OwnerBadge /> : null}
            </div>
          </div>
        </div>
        {editing ? (
          <MemberProfileForm key={membership.id} member={membership} isYou onDone={() => setEditing(false)} />
        ) : (
          <dl className="divide-y divide-line/70">
            <DetailRow label="Display name">{membership.displayName || '—'}</DetailRow>
            <DetailRow label="Title">{membership.title ?? <span className="font-normal text-faint">—</span>}</DetailRow>
            <DetailRow label="Roles">
              <RoleChips member={membership} />
            </DetailRow>
            <DetailRow label="Rank">
              <span className="font-mono tabular">{membership.highestRolePriority}</span>
            </DetailRow>
            <DetailRow label="Joined">{formatDate(membership.joinedAt ?? membership.createdAt)}</DetailRow>
            <DetailRow label="Last active">
              <RelativeTime value={membership.lastActiveAt} fallback="Not yet" />
            </DetailRow>
          </dl>
        )}
        <p className="text-xs leading-relaxed text-muted">
          Your name, email and photo for every workspace are in{' '}
          <Link to="/account/profile" className="font-medium text-brand-700 hover:underline hover:underline-offset-4">
            account settings
          </Link>
          .
        </p>
      </CardBody>
    </Card>
  );
}

/** P2-API-15. The owner can't leave (transfer first). A lost answer is checked against your workspace list. */
function LeaveCard({ membership }: { membership: Member }) {
  const workspace = useWorkspace();
  const can = useCan();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);
  const workspaceId = workspace.id;
  const workspaceName = workspace.name;

  const exit = async (title: string, description: string) => {
    toast.success(title, { description });
    setOpen(false);
    // Never a scoped refresh after leaving: go to the picker, then drop the tenant's cache.
    await navigate('/workspaces', { replace: true });
    await forgetWorkspace(workspaceId);
  };

  const leave = useMutation({
    mutationFn: () => membersApi.leave(workspaceId),
    onSuccess: () => exit(`You left ${workspaceName}`, 'API keys you created there were revoked. You are still signed in.'),
    onError: (err) => {
      if (isOutcomeUnknown(err)) setUncertain(err);
      else if (hasCode(err, 'CANNOT_REMOVE_LAST_OWNER')) setError('You own this workspace. Transfer ownership before you leave.');
      else setError(messageFor(err));
    },
  });

  const reconcile = async () => {
    setChecking(true);
    setError(null);
    try {
      if (await isWorkspaceStillListed(workspaceId)) {
        setUncertain(null);
        setError(`You're still a member of ${workspaceName}. You can try again.`);
      } else {
        await exit(`You're no longer in ${workspaceName}`, 'Leaving went through. You are still signed in.');
      }
    } catch (readError) {
      setError(`We still couldn't check: ${messageFor(readError)}`);
    } finally {
      setChecking(false);
    }
  };

  if (membership.isOwner) {
    return (
      <Card>
        <CardHeader icon={<DoorOpen />} title="Leave workspace" description="You own this workspace, so you can't leave it yet." />
        <CardBody>
          <p className="text-[13px] leading-relaxed text-muted">
            Transfer ownership to another active member first.{' '}
            {can('workspace:read') ? (
              <Link
                to={`/w/${workspace.slug}/settings/danger`}
                className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline hover:underline-offset-4"
              >
                Go to the danger zone
                <ArrowRight className="size-3" />
              </Link>
            ) : null}
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        icon={<DoorOpen />}
        title="Leave workspace"
        description="You lose access immediately. To come back, someone has to invite you again."
        actions={
          <Button
            variant="danger-outline"
            size="sm"
            onClick={() => {
              setError(null);
              setOpen(true);
            }}
          >
            Leave…
          </Button>
        }
      />
      {can('apikey:read') ? (
        <CardBody className="pt-0">
          <Link
            to={`/w/${workspace.slug}/settings/api-keys?creator=${membership.userId}`}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-700 hover:underline hover:underline-offset-4"
          >
            <KeySquare className="size-3.5" />
            Review the API keys you created here
          </Link>
        </CardBody>
      ) : null}
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          if (!checking) setOpen(next);
        }}
        icon={<DoorOpen />}
        tone="danger"
        size="md"
        title={`Leave ${workspaceName}?`}
        description={
          <>
            You lose access to {workspaceName} at once, and every API key you created in it is revoked, so anything
            using them stops working. Your account and your other workspaces aren't affected.
          </>
        }
        confirmLabel="Leave workspace"
        confirmDisabled={!!uncertain || checking}
        pending={leave.isPending}
        error={error}
        onConfirm={() => {
          setError(null);
          leave.mutate();
        }}
      >
        {uncertain ? (
          <OutcomeUnknown
            error={uncertain}
            action={
              <Button size="xs" variant="secondary" loading={checking} onClick={() => void reconcile()}>
                {checking ? null : <RefreshCw />}
                Check my membership
              </Button>
            }
          >
            You may already have left. Check before trying again.
          </OutcomeUnknown>
        ) : null}
      </ConfirmDialog>
    </Card>
  );
}
