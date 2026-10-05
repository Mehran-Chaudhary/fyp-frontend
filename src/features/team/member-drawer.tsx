import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Info, KeyRound, KeySquare, Pencil, RotateCcw, UserMinus, UserRoundX, UserX } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { DetailRow } from '@/components/ui/card';
import { Drawer, DrawerSection } from '@/components/ui/drawer';
import { Avatar, Skeleton } from '@/components/ui/misc';
import { RelativeTime } from '@/components/ui/relative-time';
import { Tooltip } from '@/components/ui/tooltip';
import { useDialogTarget } from '@/components/ui/use-dialog-target';
import { hasCode } from '@/lib/api/errors';
import type { Member } from '@/lib/api/types';
import { memberQuery } from '@/lib/queries';
import { formatDate } from '@/lib/utils';
import { useAccess } from '@/features/workspaces/use-access';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { RemoveMemberDialog, SuspendMemberDialog } from './member-actions';
import { MemberStatusBadge, OwnerBadge, RoleChips } from './member-bits';
import { findCachedMember, isUuid, useReactivateMember } from './member-helpers';
import { MemberProfileForm } from './member-profile-form';
import { MemberRolesEditor } from './member-roles-editor';

/**
 * Member detail (P2-API-09): a drawer over the Members list with its own URL
 * (/team/members/:memberId, the MEMBERSHIP id), so it can be linked to and the
 * list keeps its filters. Removed members open read-only. Actions wait for the
 * fresh detail: a stale list row never decides what is offered.
 */
export function MemberDrawer() {
  const { memberId = '' } = useParams();
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(true);
  const valid = isUuid(memberId);

  const query = useQuery({
    ...memberQuery(workspace.id, memberId),
    enabled: valid,
    // Show what the list already knows while the fresh copy loads.
    placeholderData: () => findCachedMember(workspace.id, memberId),
  });

  const close = () => {
    setOpen(false);
    // Let the slide-out finish before the route (and the drawer) goes away.
    window.setTimeout(
      () => navigate({ pathname: `/w/${workspace.slug}/team`, search: location.search }, { preventScrollReset: true }),
      170,
    );
  };

  const member = query.data;
  const focusRoles = (location.state as { focus?: string } | null)?.focus === 'roles';

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => (next ? undefined : close())}
      title={member ? member.displayName : 'Member'}
      headerExtra={member ? <DrawerHeader member={member} /> : <HeaderSkeleton ready={!valid || query.isError} />}
    >
      {!valid || hasCode(query.error, 'MEMBERSHIP_NOT_FOUND') ? (
        <EmptyState
          icon={<UserRoundX />}
          title="This member doesn't exist"
          description="They may never have been part of this workspace, or the link is wrong."
          action={
            <Button variant="secondary" size="sm" onClick={close}>
              Back to the list
            </Button>
          }
        />
      ) : member ? (
        <MemberDetail key={member.id} member={member} fresh={!query.isPlaceholderData} startWithRoles={focusRoles} onClose={close} />
      ) : query.isError ? (
        <ErrorState error={query.error} title="We couldn't load this member" onRetry={() => void query.refetch()} retrying={query.isFetching} />
      ) : (
        <BodySkeleton />
      )}
    </Drawer>
  );
}

function DrawerHeader({ member }: { member: Member }) {
  const access = useAccess();
  const isYou = member.id === access.membership?.id;
  return (
    <div className="flex items-center gap-3.5">
      <Avatar name={member.displayName} src={member.avatarUrl} size="lg" muted={member.status === 'REMOVED'} />
      <div className="min-w-0">
        <p className="flex min-w-0 items-center gap-2 text-base leading-6 font-semibold text-ink">
          <span className="truncate">{member.displayName}</span>
          {isYou ? (
            <span className="shrink-0 rounded border border-line bg-well px-1 text-[10.5px] leading-4 font-medium text-muted">You</span>
          ) : null}
        </p>
        <p className="truncate text-[13px] text-muted">{member.email}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <MemberStatusBadge status={member.status} />
          {member.isOwner ? <OwnerBadge /> : null}
        </div>
      </div>
    </div>
  );
}

function MemberDetail({
  member,
  fresh,
  startWithRoles,
  onClose,
}: {
  member: Member;
  /** False while only the list's copy is shown: no actions until the detail has loaded. */
  fresh: boolean;
  startWithRoles: boolean;
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const can = useCan();
  const access = useAccess();
  const isYou = member.id === access.membership?.id;
  const removed = member.status === 'REMOVED';
  const manageable = fresh && !removed && access.canActOn(member);

  const canEditProfile = fresh && !removed && (isYou || (can('member:update') && manageable));
  const canAssign = manageable && can('role:assign');
  const canStatus = manageable && can('member:update');
  const canRemove = manageable && can('member:remove');
  const hasAdminPowers = can.any('member:update', 'member:remove', 'role:assign');

  // "Change roles…" from a row may open this before the fresh detail arrives: the editor shows once it may.
  const [editing, setEditing] = useState<'profile' | 'roles' | null>(startWithRoles ? 'roles' : null);
  const showing = editing === 'roles' && !canAssign ? null : editing === 'profile' && !canEditProfile ? null : editing;
  const suspendDialog = useDialogTarget<Member>();
  const removeDialog = useDialogTarget<Member>();
  const reactivate = useReactivateMember({ onGone: onClose });

  const firstName = member.firstName || member.displayName;

  let notice: ReactNode = null;
  if (removed) {
    notice = (
      <Callout tone="neutral" title="No longer a member">
        {firstName} left or was removed from {workspace.name}. This record is kept for reference and is read-only; to
        bring them back, send a new invitation.
      </Callout>
    );
  } else if (member.status === 'SUSPENDED') {
    notice = (
      <Callout tone="warning" title="Suspended">
        {firstName}'s membership doesn't work until someone reactivates it. Their roles are kept, and API keys they
        created keep working unless revoked.
      </Callout>
    );
  }
  let restriction: ReactNode = null;
  if (!removed && !isYou && !manageable && hasAdminPowers) {
    restriction = member.isOwner ? (
      <Callout tone="neutral" icon={<Info className="size-4" />}>
        Nobody can change the owner's roles or access here. Ownership only changes through a transfer by the owner.
      </Callout>
    ) : (
      <Callout tone="neutral" icon={<Info className="size-4" />}>
        {firstName} ranks at or above you ({member.highestRolePriority} vs. your {access.myPriority}), so you can't
        change their roles or access. Only someone who ranks higher can.
      </Callout>
    );
  }

  return (
    <>
      {notice || restriction ? (
        <div className="grid gap-2 border-b border-line px-5 py-4 sm:px-6">
          {notice}
          {restriction}
        </div>
      ) : null}

      <DrawerSection
        title="Profile"
        description={isYou ? 'How you appear in this workspace.' : undefined}
        actions={
          canEditProfile && showing !== 'profile' ? (
            <Button variant="ghost" size="xs" onClick={() => setEditing('profile')}>
              <Pencil />
              Edit
            </Button>
          ) : null
        }
      >
        {showing === 'profile' ? (
          <MemberProfileForm member={member} isYou={isYou} onDone={() => setEditing(null)} onGone={onClose} />
        ) : (
          <dl className="divide-y divide-line/70">
            <DetailRow label="Display name">{member.displayName}</DetailRow>
            <DetailRow label="Full name">{`${member.firstName} ${member.lastName}`.trim() || '—'}</DetailRow>
            <DetailRow label="Title">{member.title ?? <span className="font-normal text-faint">—</span>}</DetailRow>
            <DetailRow label="Joined">{formatDate(member.joinedAt ?? member.createdAt)}</DetailRow>
            <DetailRow label="Last active">
              <RelativeTime value={member.lastActiveAt} fallback="Not yet" />
            </DetailRow>
            <DetailRow
              label={
                <Tooltip content="The highest priority among this member's roles. People can only manage members who rank below them.">
                  <span tabIndex={0} className="cursor-help rounded-sm underline decoration-line-strong decoration-dotted underline-offset-4">
                    Rank
                  </span>
                </Tooltip>
              }
            >
              <span className="font-mono tabular">{member.highestRolePriority}</span>
            </DetailRow>
          </dl>
        )}
      </DrawerSection>

      <DrawerSection
        title="Roles"
        description={showing === 'roles' ? 'Roles you can grant are selectable. Saving replaces the member’s roles.' : undefined}
        actions={
          canAssign && showing !== 'roles' ? (
            <Button variant="ghost" size="xs" onClick={() => setEditing('roles')}>
              <KeyRound />
              Change
            </Button>
          ) : null
        }
      >
        {showing === 'roles' ? (
          <MemberRolesEditor member={member} onDone={() => setEditing(null)} onGone={onClose} />
        ) : (
          <RoleChips member={member} />
        )}
      </DrawerSection>

      {canStatus || canRemove ? (
        <DrawerSection title="Access">
          <div className="grid gap-2">
            {canStatus && member.status === 'ACTIVE' ? (
              <ActionRow
                title="Suspend"
                description="Stops their membership working without removing it. Their roles and API keys are kept."
                action={
                  <Button variant="secondary" size="sm" onClick={() => suspendDialog.show(member)}>
                    <UserX />
                    Suspend…
                  </Button>
                }
              />
            ) : null}
            {canStatus && member.status === 'SUSPENDED' ? (
              <ActionRow
                title="Reactivate"
                description="Restores their access with the roles they had."
                action={
                  <Button variant="secondary" size="sm" loading={reactivate.isPending} onClick={() => reactivate.mutate(member)}>
                    {reactivate.isPending ? null : <RotateCcw />}
                    Reactivate
                  </Button>
                }
              />
            ) : null}
            {canRemove ? (
              <ActionRow
                title="Remove from workspace"
                description="Ends the membership and revokes every API key they created here. Their account isn't deleted."
                action={
                  <Button variant="danger-outline" size="sm" onClick={() => removeDialog.show(member)}>
                    <UserMinus />
                    Remove…
                  </Button>
                }
              />
            ) : null}
          </div>
        </DrawerSection>
      ) : null}

      {!removed && can('apikey:read') ? (
        <DrawerSection title="Machine access">
          <Link
            to={`/w/${workspace.slug}/settings/api-keys?creator=${member.userId}`}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-700 hover:underline hover:underline-offset-4"
          >
            <KeySquare className="size-3.5" aria-hidden />
            API keys {isYou ? 'you' : firstName} created
            <ArrowRight className="size-3" />
          </Link>
        </DrawerSection>
      ) : null}

      {isYou && !member.isOwner ? (
        <DrawerSection title="Leaving">
          <p className="text-[13px] leading-relaxed text-muted">
            You can leave {workspace.name} from{' '}
            <Link
              to={`/w/${workspace.slug}/my-workspace-profile`}
              className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline hover:underline-offset-4"
            >
              your workspace profile
              <ArrowRight className="size-3" />
            </Link>
          </p>
        </DrawerSection>
      ) : null}

      <SuspendMemberDialog
        member={suspendDialog.target}
        open={suspendDialog.open}
        onOpenChange={suspendDialog.onOpenChange}
        onGone={onClose}
      />
      <RemoveMemberDialog
        member={removeDialog.target}
        open={removeDialog.open}
        onOpenChange={removeDialog.onOpenChange}
        onRemoved={onClose}
      />
    </>
  );
}

function ActionRow({ title, description, action }: { title: string; description: string; action: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line px-3.5 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

// ── Skeletons ───────────────────────────────────────────────────────────────

function HeaderSkeleton({ ready }: { ready: boolean }) {
  if (ready) return <p className="text-base leading-6 font-semibold text-ink">Member</p>;
  return (
    <div className="flex items-center gap-3.5">
      <Skeleton className="size-12 rounded-full" />
      <div className="grid gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-52" />
      </div>
    </div>
  );
}

function BodySkeleton() {
  return (
    <div className="grid gap-6 px-5 py-5 sm:px-6">
      {[0, 1].map((section) => (
        <div key={section} className="grid gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-5/6" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      ))}
    </div>
  );
}
