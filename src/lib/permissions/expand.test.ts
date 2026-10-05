import { describe, expect, it } from 'vitest';
import { createCan } from './can';
import { expandPermissions, permissionMatches } from './expand';

const catalogue = [
  'agent:create',
  'agent:read',
  'agent:update',
  'audit:read',
  'member:read',
  'pii:policy:read',
  'pii:policy:update',
  'pii:reveal',
  'workspace:read',
];

describe('permissionMatches', () => {
  it('lets *:* match anything', () => {
    expect(permissionMatches('*:*', 'agent:create')).toBe(true);
    expect(permissionMatches('*:*', 'pii:policy:read')).toBe(true);
  });

  it('matches resource wildcards', () => {
    expect(permissionMatches('agent:*', 'agent:read')).toBe(true);
    expect(permissionMatches('agent:*', 'audit:read')).toBe(false);
  });

  it('matches action wildcards', () => {
    expect(permissionMatches('*:read', 'audit:read')).toBe(true);
    expect(permissionMatches('*:read', 'agent:create')).toBe(false);
  });

  it('splits on the first colon only', () => {
    expect(permissionMatches('pii:*', 'pii:policy:read')).toBe(true);
    expect(permissionMatches('pii:policy:read', 'pii:policy:read')).toBe(true);
    expect(permissionMatches('pii:policy:read', 'pii:policy:update')).toBe(false);
    // `*:read` does not match `pii:policy:read`: its action is `policy:read`.
    expect(permissionMatches('*:read', 'pii:policy:read')).toBe(false);
  });

  it('is case-insensitive and rejects malformed keys', () => {
    expect(permissionMatches('AGENT:READ', 'agent:read')).toBe(true);
    expect(permissionMatches('agent', 'agent:read')).toBe(false);
    expect(permissionMatches(':read', 'agent:read')).toBe(false);
    expect(permissionMatches('agent:', 'agent:read')).toBe(false);
  });
});

describe('expandPermissions', () => {
  it('expands *:* to the whole catalogue', () => {
    expect(expandPermissions(['*:*'], catalogue)).toEqual([...catalogue].sort());
  });

  it('expands resource wildcards against the catalogue', () => {
    expect(expandPermissions(['agent:*'], catalogue)).toEqual(['agent:create', 'agent:read', 'agent:update']);
  });

  it('keeps concrete keys and removes duplicates', () => {
    expect(expandPermissions(['audit:read', 'audit:read', 'agent:read'], catalogue)).toEqual(['agent:read', 'audit:read']);
  });

  it('handles multi-colon keys', () => {
    expect(expandPermissions(['pii:*'], catalogue)).toEqual(['pii:policy:read', 'pii:policy:update', 'pii:reveal']);
  });

  it('combines several roles', () => {
    expect(expandPermissions(['member:read', 'agent:*', 'workspace:read'], catalogue)).toEqual([
      'agent:create',
      'agent:read',
      'agent:update',
      'member:read',
      'workspace:read',
    ]);
  });
});

describe('createCan (fails closed, spec §5)', () => {
  it('checks concrete permissions', () => {
    const can = createCan(['agent:read', 'member:read']);
    expect(can('agent:read')).toBe(true);
    expect(can('audit:read')).toBe(false);
    expect(can.any('audit:read', 'member:read')).toBe(true);
    expect(can.all('audit:read', 'member:read')).toBe(false);
  });

  it('understands wildcards the server might return', () => {
    const can = createCan(['agent:*']);
    expect(can('agent:delete')).toBe(true);
    expect(can('audit:read')).toBe(false);
  });

  it('holds nothing when permissions are absent or empty', () => {
    for (const keys of [undefined, null, []]) {
      const can = createCan(keys);
      expect(can('workspace:read')).toBe(false);
      expect(can.any('workspace:read', 'member:read')).toBe(false);
    }
  });
});
