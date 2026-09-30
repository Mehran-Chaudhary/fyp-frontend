import { describe, expect, it } from 'vitest';
import type { Role } from '../api/types';
import {
  canActOn,
  canEditRole,
  canEditRolePermissions,
  grantableRoles,
  holdsAllOf,
  maxRolePriority,
  whyNotGrantable,
} from './rules';

const catalogue = [
  'clearance:confidential',
  'clearance:internal',
  'clearance:restricted',
  'document:create',
  'document:read',
  'member:invite',
  'member:read',
  'member:remove',
  'member:update',
  'role:read',
  'tool:read',
  'workspace:read',
];

function role(slug: string, priority: number, permissionKeys: string[], extra: Partial<Role> = {}): Role {
  return {
    id: `${slug}-id`,
    name: slug,
    slug,
    description: null,
    isSystem: false,
    isDefault: false,
    priority,
    color: null,
    permissionKeys,
    createdAt: '2026-09-29T20:31:26.562Z',
    ...extra,
  };
}

const owner = role('owner', 100, ['*:*'], { isSystem: true });
const admin = role('admin', 80, ['member:*', 'role:read', 'document:*', 'workspace:read', 'clearance:internal', 'clearance:confidential', 'tool:read'], { isSystem: true });
const member = role('member', 50, ['member:read', 'document:read', 'clearance:internal', 'tool:read'], { isSystem: true, isDefault: true });
const viewer = role('viewer', 20, ['member:read', 'document:read'], { isSystem: true });
const hr = role('hr-manager', 60, ['member:read', 'member:invite', 'role:read', 'clearance:restricted']);

// What the demo administrator holds (everything except restricted clearance, here).
const adminPermissions = new Set(catalogue.filter((key) => key !== 'clearance:restricted'));
// The demo HR manager.
const hrPermissions = new Set(['member:read', 'member:invite', 'role:read', 'clearance:restricted']);

describe('canActOn', () => {
  it('refuses yourself even with a higher rank', () => {
    expect(canActOn({ id: 'a', highestRolePriority: 80 }, { id: 'a', highestRolePriority: 20 })).toBe(false);
  });

  it('requires the target to rank strictly below', () => {
    expect(canActOn({ id: 'a', highestRolePriority: 80 }, { id: 'b', highestRolePriority: 50 })).toBe(true);
    expect(canActOn({ id: 'a', highestRolePriority: 80 }, { id: 'b', highestRolePriority: 80 })).toBe(false);
    expect(canActOn({ id: 'a', highestRolePriority: 80 }, { id: 'b', highestRolePriority: 100 })).toBe(false);
  });

  it('means nobody can act on the owner', () => {
    expect(canActOn({ id: 'a', highestRolePriority: 99 }, { id: 'owner', highestRolePriority: 100 })).toBe(false);
  });
});

describe('holdsAllOf', () => {
  it('expands wildcards before comparing', () => {
    expect(holdsAllOf(admin, adminPermissions, catalogue)).toBe(true);
    expect(holdsAllOf(role('x', 10, ['clearance:*']), adminPermissions, catalogue)).toBe(false);
  });
});

describe('grantableRoles', () => {
  const roles = [owner, admin, hr, member, viewer];

  it('never offers the owner role, even to the owner', () => {
    const everything = new Set(catalogue);
    expect(grantableRoles(roles, 100, everything, catalogue).map((r) => r.slug)).toEqual([
      'admin',
      'hr-manager',
      'member',
      'viewer',
    ]);
  });

  it('keeps an administrator from granting HR Manager (clearance:restricted) or its own rank', () => {
    expect(grantableRoles(roles, 80, adminPermissions, catalogue).map((r) => r.slug)).toEqual(['member', 'viewer']);
  });

  it('leaves the HR manager with nothing to grant', () => {
    expect(grantableRoles(roles, 60, hrPermissions, catalogue)).toEqual([]);
  });
});

describe('whyNotGrantable', () => {
  it('explains the owner role, rank and missing permissions in that order', () => {
    expect(whyNotGrantable(owner, 80, adminPermissions, catalogue)).toEqual({ kind: 'owner' });
    expect(whyNotGrantable(admin, 80, adminPermissions, catalogue)).toEqual({ kind: 'rank', rolePriority: 80, myPriority: 80 });
    expect(whyNotGrantable(hr, 80, adminPermissions, catalogue)).toEqual({
      kind: 'permissions',
      missing: ['clearance:restricted'],
    });
    expect(whyNotGrantable(member, 80, adminPermissions, catalogue)).toBeNull();
  });
});

describe('role editing', () => {
  it('caps the priority below yours and at 99', () => {
    expect(maxRolePriority(80)).toBe(79);
    expect(maxRolePriority(100)).toBe(99);
  });

  it('keeps built-in roles and roles at or above you read-only', () => {
    expect(canEditRole(member, 100)).toBe(false);
    expect(canEditRole(hr, 60)).toBe(false);
    expect(canEditRole(hr, 80)).toBe(true);
  });

  it('lets an admin rename HR Manager but not change its permissions', () => {
    expect(canEditRole(hr, 80)).toBe(true);
    expect(canEditRolePermissions(hr, 80, adminPermissions, catalogue)).toBe(false);
    expect(canEditRolePermissions(role('support', 40, ['member:read']), 80, adminPermissions, catalogue)).toBe(true);
  });
});
