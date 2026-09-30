import type { Member, Role } from '../api/types';
import { expandPermissions } from '../permissions/expand';

/**
 * The two anti-escalation rules the server applies on top of route permissions
 * (Phase 2 spec §3.2), mirrored so the UI only offers what can succeed. These
 * predict exactly what the server accepts and refuses.
 */

type Ranked = Pick<Member, 'id' | 'highestRolePriority'>;

/** Rule 1: never yourself, only members ranked strictly below you. */
export function canActOn(me: Ranked, target: Ranked): boolean {
  return target.id !== me.id && target.highestRolePriority < me.highestRolePriority;
}

/** True when you hold every permission the role grants (wildcards expanded). */
export function holdsAllOf(
  role: Pick<Role, 'permissionKeys'>,
  myPermissions: ReadonlySet<string>,
  catalogue: readonly string[],
): boolean {
  return expandPermissions(role.permissionKeys, catalogue).every((key) => myPermissions.has(key));
}

/** The role's permissions you don't hold, expanded and sorted. */
export function missingPermissions(
  role: Pick<Role, 'permissionKeys'>,
  myPermissions: ReadonlySet<string>,
  catalogue: readonly string[],
): string[] {
  return expandPermissions(role.permissionKeys, catalogue).filter((key) => !myPermissions.has(key));
}

/**
 * Roles you may invite someone into and (by the UI's rule, §3.3) assign.
 * Rule 2: priority strictly below yours and every permission held by you.
 * The Owner role is never offered: ownership moves only by transfer.
 */
export function grantableRoles(
  roles: readonly Role[],
  myPriority: number,
  myPermissions: ReadonlySet<string>,
  catalogue: readonly string[],
): Role[] {
  return roles.filter((role) => isGrantable(role, myPriority, myPermissions, catalogue));
}

export function isGrantable(
  role: Pick<Role, 'slug' | 'priority' | 'permissionKeys'>,
  myPriority: number,
  myPermissions: ReadonlySet<string>,
  catalogue: readonly string[],
): boolean {
  return role.slug !== 'owner' && role.priority < myPriority && holdsAllOf(role, myPermissions, catalogue);
}

export type UngrantableReason =
  | { kind: 'owner' }
  | { kind: 'rank'; rolePriority: number; myPriority: number }
  | { kind: 'permissions'; missing: string[] };

/** Why a role is not grantable, or null when it is. Rank is reported before permissions. */
export function whyNotGrantable(
  role: Pick<Role, 'slug' | 'priority' | 'permissionKeys'>,
  myPriority: number,
  myPermissions: ReadonlySet<string>,
  catalogue: readonly string[],
): UngrantableReason | null {
  if (role.slug === 'owner') return { kind: 'owner' };
  if (role.priority >= myPriority) return { kind: 'rank', rolePriority: role.priority, myPriority };
  const missing = missingPermissions(role, myPermissions, catalogue);
  return missing.length > 0 ? { kind: 'permissions', missing } : null;
}

/** Highest priority you may give a role you create or edit. */
export const maxRolePriority = (myPriority: number): number => Math.min(99, myPriority - 1);

/** Whether the role editor is editable for this role (§5.6), given role:update / role:create. */
export function canEditRole(role: Pick<Role, 'isSystem' | 'priority'>, myPriority: number): boolean {
  return !role.isSystem && role.priority < myPriority;
}

/** Whether the permission grid may be changed: only if you hold everything the role grants. */
export function canEditRolePermissions(
  role: Pick<Role, 'isSystem' | 'priority' | 'permissionKeys'>,
  myPriority: number,
  myPermissions: ReadonlySet<string>,
  catalogue: readonly string[],
): boolean {
  return canEditRole(role, myPriority) && holdsAllOf(role, myPermissions, catalogue);
}
