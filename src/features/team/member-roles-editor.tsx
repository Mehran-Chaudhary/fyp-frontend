import { useMutation, useQuery } from '@tanstack/react-query';
import { Lock, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { CheckboxBox } from '@/components/ui/checkbox';
import { FormError } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/misc';
import { membersApi } from '@/lib/api/endpoints';
import { hasCode, isApiError } from '@/lib/api/errors';
import type { Member, Role } from '@/lib/api/types';
import { queryKeys, rolesQuery } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { whyNotGrantable, type UngrantableReason } from '@/lib/rbac/rules';
import { toast } from '@/lib/toast';
import { cn, pluralize } from '@/lib/utils';
import { useAccess } from '@/features/workspaces/use-access';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { RoleDot } from './member-bits';
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

/**
 * The "Change roles" checklist (spec §5.2). The server checks every role in the
 * submitted list, including ones the member already holds, so a held role you
 * can't grant may be removed but not kept: it starts ticked, can be unticked but
 * not re-ticked, and Save stays disabled while it is still ticked.
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
  const workspace = useWorkspace();
  const access = useAccess();
  const roles = useQuery(rolesQuery(workspace.id));
  const initial = new Set(member.roles.map((role) => role.id));
  const [selected, setSelected] = useState<ReadonlySet<string>>(initial);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (roleIds: string[]) => membersApi.setRoles(workspace.id, member.id, roleIds),
    onSuccess: (updated) => {
      storeMember(workspace.id, updated);
      toast.success('Roles updated', {
        description: `${updated.displayName} now ranks at ${updated.highestRolePriority}. Their permissions changed immediately.`,
      });
      onDone();
    },
    onError: (err) => {
      if (hasCode(err, 'MEMBERSHIP_NOT_FOUND')) {
        handleMemberGone(workspace.id, member.displayName);
        onGone();
        return;
      }
      if (hasCode(err, 'ROLE_NOT_FOUND')) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.roles(workspace.id) });
        setError('One of these roles was just deleted. The list has been refreshed; check your selection.');
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
      <div className="grid gap-2">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (roles.isError) {
    return <ErrorState compact error={roles.error} title="We couldn't load the roles" onRetry={() => void roles.refetch()} />;
  }

  const rows = roles.data
    .filter((role) => role.slug !== 'owner')
    .map((role) => {
      const held = initial.has(role.id);
      const reason = whyNotGrantable(role, access.myPriority, access.myPermissions, access.catalogueKeys);
      const checked = selected.has(role.id);
      // A held role you can't grant may be unticked, never re-ticked.
      const disabled = reason !== null && !(held && checked);
      return { role, held, reason, checked, disabled };
    });

  const blocked = rows.filter((row) => row.held && row.reason && row.checked);
  const changed = selected.size !== initial.size || [...selected].some((id) => !initial.has(id));
  const newRank = Math.max(0, ...rows.filter((row) => row.checked).map((row) => row.role.priority));
  const tooMany = selected.size > MAX_ROLES;
  const canSave = changed && selected.size >= 1 && blocked.length === 0 && !tooMany;

  const toggle = (role: Role, next: boolean) => {
    setError(null);
    setSelected((current) => {
      const updated = new Set(current);
      if (next) updated.add(role.id);
      else updated.delete(role.id);
      return updated;
    });
  };

  return (
    <div className="grid gap-3">
      <ul className="grid gap-1.5">
        {rows.map(({ role, held, reason, checked, disabled }) => {
          const boxId = `role-${role.id}`;
          return (
            <li
              key={role.id}
              className={cn(
                'flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                checked ? 'border-brand-200 bg-brand-50/40' : 'border-line bg-surface',
                disabled && !checked && 'bg-well/40',
              )}
            >
              <CheckboxBox id={boxId} checked={checked} disabled={disabled} onCheckedChange={(next) => toggle(role, next)} />
              <label htmlFor={boxId} className={cn('min-w-0 flex-1 text-[13px]', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
                <span className="flex items-center gap-2">
                  <RoleDot color={role.color} />
                  <span className={cn('font-medium', disabled && !checked ? 'text-muted' : 'text-ink')}>{role.name}</span>
                  {held ? <span className="text-xs text-faint">Current</span> : null}
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-faint tabular">{role.priority}</span>
                </span>
                {held && reason && checked ? (
                  <span className="mt-1 flex items-start gap-1.5 text-xs leading-snug text-warning-700">
                    <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
                    You can't grant this role, so saving any change requires removing it.
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

      <p className="text-xs leading-relaxed text-muted" aria-live="polite">
        {selected.size === 0
          ? 'A member must keep at least one role.'
          : tooMany
            ? `A member can hold at most ${MAX_ROLES} roles.`
            : changed
              ? `${pluralize(selected.size, 'role')} selected. ${member.displayName} will rank at ${newRank}.`
              : 'Tick the roles this member should hold. Saving replaces their current set.'}
      </p>

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
