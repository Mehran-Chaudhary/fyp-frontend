import { useMutation, useQuery } from '@tanstack/react-query';
import { Info, Lock, RefreshCw, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { OutcomeUnknown } from '@/components/feedback/outcome-unknown';
import { ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { CheckboxBox } from '@/components/ui/checkbox';
import { FormError } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/misc';
import { membersApi } from '@/lib/api/endpoints';
import { hasCode, isApiError, isOutcomeUnknown } from '@/lib/api/errors';
import type { Member, MemberRole, Role } from '@/lib/api/types';
import { detailList } from '@/lib/errors';
import { queryKeys, rolesQuery } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { diffKeys } from '@/lib/rbac/grants';
import { whyNotGrantable, type UngrantableReason } from '@/lib/rbac/rules';
import { toast } from '@/lib/toast';
import { cn, pluralize } from '@/lib/utils';
import { invalidateMembers, refreshMyAccess } from '@/lib/workspace/cache';
import { useAccess } from '@/features/workspaces/use-access';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { RoleChip, RoleDot } from './member-bits';
import { handleMemberGone, memberActionMessage, storeMember } from './member-helpers';

const MAX_ROLES = 20;

function reasonText(reason: UngrantableReason): string {
  switch (reason.kind) {
    case 'owner':
      return 'Ownership only moves through a transfer.';
    case 'rank':
      return `Ranks at or above you (${reason.rolePriority} ≥ ${reason.myPriority}).`;
    case 'permissions':
      return `Includes ${reason.missing.length === 1 ? 'a permission' : 'permissions'} you don't hold: ${reason.missing.join(', ')}.`;
  }
}

type Row =
  | { kind: 'role'; role: Role; held: boolean; reason: UngrantableReason | null; checked: boolean; disabled: boolean }
  | { kind: 'missing'; role: MemberRole; checked: boolean };

/**
 * "Change roles" (P2-API-10): the member's whole role set is replaced, so the
 * selection starts with every role they hold now, including ones you couldn't
 * grant and ones that no longer exist; nothing is dropped silently.
 *
 * The server checks the member's CURRENT rank and that you hold every permission
 * of every submitted role (held ones included). It does not check each new
 * role's rank against yours (spec P2-G03); this editor applies that rule itself
 * and says so.
 */
export function MemberRolesEditor({
  member,
  onDone,
  onGone,
}: {
  member: Member;
  onDone: () => void;
  onGone: () => void;
}) {
  const can = useCan();
  if (!can('role:read')) {
    return (
      <Callout tone="neutral" icon={<Info className="size-4" />} title="This editor also needs role:read">
        Changing roles means choosing from the workspace's roles, and your roles don't let you list them. Ask an
        administrator to add <code className="font-mono text-[12px]">role:read</code>, or to make the change.
      </Callout>
    );
  }
  return <Editor member={member} onDone={onDone} onGone={onGone} />;
}

function Editor({ member, onDone, onGone }: { member: Member; onDone: () => void; onGone: () => void }) {
  const workspace = useWorkspace();
  const workspaceId = workspace.id;
  const access = useAccess();
  const roles = useQuery(rolesQuery(workspaceId));
  const currentIds = member.roles.map((role) => role.id);
  // What the member held when editing began, to notice a change made elsewhere meanwhile (spec §8).
  const [snapshot, setSnapshot] = useState<string[]>(currentIds);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(currentIds));
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<unknown>(null);

  const save = useMutation({
    mutationFn: (roleIds: string[]) => membersApi.setRoles(workspaceId, member.id, roleIds),
    onSuccess: (updated) => {
      storeMember(workspaceId, updated);
      toast.success(`${updated.displayName}'s roles were replaced`, {
        description: `They now rank at ${updated.highestRolePriority}. Their permissions changed on the server at once.`,
      });
      onDone();
    },
    onError: (err) => {
      if (hasCode(err, 'MEMBERSHIP_NOT_FOUND')) {
        handleMemberGone(workspaceId, member.displayName);
        onGone();
        return;
      }
      if (isOutcomeUnknown(err)) {
        setUncertain(err);
        void invalidateMembers(workspaceId);
        return;
      }
      if (hasCode(err, 'ROLE_NOT_FOUND')) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.roles(workspaceId) });
        setError('One of these roles was just deleted. The role list has been refreshed; check the selection.');
        return;
      }
      if (hasCode(err, 'CANNOT_ESCALATE_PRIVILEGES')) {
        // Your own grants may have changed since this page loaded.
        void refreshMyAccess(workspaceId);
        const denied = detailList(err, 'deniedPermissions');
        setError(
          denied.length
            ? `The selected roles grant permissions you don't hold: ${denied.join(', ')}.`
            : memberActionMessage(err),
        );
        return;
      }
      if (isApiError(err) && err.code === 'VALIDATION_FAILED') {
        setError(err.fieldErrors({ fields: ['roleIds'] }).roleIds ?? err.message);
        return;
      }
      setError(memberActionMessage(err));
    },
  });

  if (roles.isPending || !access.ready) {
    return (
      <div className="grid gap-2" aria-busy="true">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (roles.isError) {
    return <ErrorState compact error={roles.error} title="We couldn't load the roles" onRetry={() => void roles.refetch()} />;
  }

  const held = new Set(snapshot);
  const known = new Map(roles.data.map((role) => [role.id, role]));
  const rows: Row[] = [
    ...roles.data
      // The Owner role is listed only if they already hold it; it's never offered.
      .filter((role) => role.slug !== 'owner' || held.has(role.id))
      .map((role): Row => {
        const reason = whyNotGrantable(role, access.myPriority, access.myPermissions, access.catalogueKeys);
        const checked = selected.has(role.id);
        // A held role you can't grant may be unticked, never re-ticked.
        return { kind: 'role', role, held: held.has(role.id), reason, checked, disabled: reason !== null && !(held.has(role.id) && checked) };
      }),
    // Held roles missing from the list (deleted meanwhile): kept visible, never dropped silently.
    ...member.roles
      .filter((role) => held.has(role.id) && !known.has(role.id))
      .map((role): Row => ({ kind: 'missing', role, checked: selected.has(role.id) })),
  ];

  const blockedHeld = rows.filter((row) => row.kind === 'role' && row.held && row.reason && row.checked);
  const blockedMissing = rows.filter((row) => row.kind === 'missing' && row.checked);
  const diff = diffKeys(snapshot, selected);
  const changed = diff.added.length > 0 || diff.removed.length > 0;
  const nameOf = (id: string) => known.get(id)?.name ?? member.roles.find((role) => role.id === id)?.name ?? 'Unknown role';
  const colorOf = (id: string) => known.get(id)?.color ?? member.roles.find((role) => role.id === id)?.color ?? null;
  const newRank = Math.max(0, ...[...selected].map((id) => known.get(id)?.priority ?? 0));
  const tooMany = selected.size > MAX_ROLES;
  const changedElsewhere = diffKeys(snapshot, currentIds);
  const stale = changedElsewhere.added.length > 0 || changedElsewhere.removed.length > 0;
  const canSave =
    changed && selected.size >= 1 && blockedHeld.length === 0 && blockedMissing.length === 0 && !tooMany && !uncertain && !stale;

  const toggle = (id: string, next: boolean) => {
    setError(null);
    setSelected((current) => {
      const updated = new Set(current);
      if (next) updated.add(id);
      else updated.delete(id);
      return updated;
    });
  };

  const restart = () => {
    setSnapshot(currentIds);
    setSelected(new Set(currentIds));
    setError(null);
    setUncertain(null);
  };

  return (
    <div className="grid gap-3">
      {stale ? (
        <Callout
          tone="warning"
          title="Their roles changed while you were editing"
          action={
            <Button size="xs" variant="secondary" onClick={restart}>
              <RefreshCw />
              Start again from their current roles
            </Button>
          }
        >
          Saving would overwrite that change, so it's paused until you start again.
        </Callout>
      ) : null}

      <ul className="grid gap-1.5">
        {rows.map((row) => {
          const id = row.role.id;
          const boxId = `role-${member.id}-${id}`;
          if (row.kind === 'missing') {
            return (
              <li key={id} className="flex items-start gap-3 rounded-lg border border-warning-200 bg-warning-50/50 px-3 py-2.5">
                <CheckboxBox id={boxId} checked={row.checked} disabled={!row.checked} onCheckedChange={(next) => toggle(id, next)} />
                <label htmlFor={boxId} className="min-w-0 flex-1 cursor-pointer text-[13px]">
                  <span className="flex items-center gap-2">
                    <RoleDot color={row.role.color} />
                    <span className="font-medium text-ink">{row.role.name}</span>
                    <span className="text-xs text-faint">Current</span>
                  </span>
                  <span className="mt-1 flex items-start gap-1.5 text-xs leading-snug text-warning-700">
                    <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
                    This role is no longer in the workspace's role list. Untick it to save.
                  </span>
                </label>
              </li>
            );
          }
          const { role, held: isHeld, reason, checked, disabled } = row;
          return (
            <li
              key={id}
              className={cn(
                'flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                checked ? 'border-brand-200 bg-brand-50/40' : 'border-line bg-surface',
                disabled && !checked && 'bg-well/40',
              )}
            >
              <CheckboxBox id={boxId} checked={checked} disabled={disabled} onCheckedChange={(next) => toggle(id, next)} />
              <label htmlFor={boxId} className={cn('min-w-0 flex-1 text-[13px]', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
                <span className="flex items-center gap-2">
                  <RoleDot color={role.color} />
                  <span className={cn('font-medium', disabled && !checked ? 'text-muted' : 'text-ink')}>{role.name}</span>
                  {isHeld ? <span className="text-xs text-faint">Current</span> : null}
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-faint tabular">{role.priority}</span>
                </span>
                {isHeld && reason && checked ? (
                  <span className="mt-1 flex items-start gap-1.5 text-xs leading-snug text-warning-700">
                    <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
                    You can't grant this role, so a save that keeps it is refused. Untick it to change their roles, or ask
                    someone who can. {reasonText(reason)}
                  </span>
                ) : reason ? (
                  <span className="mt-0.5 block text-xs leading-snug text-muted">{reasonText(reason)}</span>
                ) : role.description ? (
                  <span className="mt-0.5 block truncate text-xs text-muted">{role.description}</span>
                ) : null}
              </label>
              {disabled ? <Lock className="mt-0.5 size-3.5 shrink-0 text-faint" aria-hidden /> : null}
            </li>
          );
        })}
      </ul>

      {changed ? (
        <div className="grid gap-2 rounded-lg border border-line bg-well/40 px-3.5 py-3 text-[13px]" aria-live="polite">
          <p className="font-medium text-ink">Review the change</p>
          {diff.added.length ? (
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="w-16 shrink-0 text-xs text-muted">Adds</span>
              {diff.added.map((id) => (
                <RoleChip key={id} role={{ name: nameOf(id), color: colorOf(id) }} />
              ))}
            </p>
          ) : null}
          {diff.removed.length ? (
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="w-16 shrink-0 text-xs text-muted">Removes</span>
              {diff.removed.map((id) => (
                <RoleChip key={id} role={{ name: nameOf(id), color: colorOf(id) }} className="line-through" />
              ))}
            </p>
          ) : null}
          <p className="text-xs text-muted">
            {selected.size === 0
              ? 'A member must keep at least one role.'
              : tooMany
                ? `A member can hold at most ${MAX_ROLES} roles.`
                : `${pluralize(selected.size, 'role')} after saving; ${member.displayName} will rank at ${newRank}. Saving replaces the whole set.`}
          </p>
        </div>
      ) : (
        <p className="text-xs leading-relaxed text-muted">Tick the roles this member should hold. Saving replaces their current set.</p>
      )}

      <p className="text-xs leading-relaxed text-faint">
        Roles that rank at or above you aren't offered. That's this app's rule; the server checks the member's current
        rank and the permissions each role grants.
      </p>

      {uncertain ? (
        <OutcomeUnknown error={uncertain}>
          Their roles may have been replaced. The member is being re-read; if it changed, start again from their current
          roles.
        </OutcomeUnknown>
      ) : null}
      <FormError message={error ?? undefined} />

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button size="sm" disabled={!canSave} loading={save.isPending} onClick={() => save.mutate([...selected])}>
          Save roles
        </Button>
      </div>
    </div>
  );
}
