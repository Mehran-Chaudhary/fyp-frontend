import { describe, expect, it } from 'vitest';
import type { CurrentUser } from './api/types';
import { queryKeys, toAccessContext } from './queries';

const me = (extra: Partial<CurrentUser>): CurrentUser => ({
  id: 'u1',
  email: 'sara@acme.test',
  firstName: 'Sara',
  lastName: 'Khan',
  displayName: 'Sara Khan',
  emailVerified: true,
  isPlatformAdmin: false,
  status: 'ACTIVE',
  avatarUrl: null,
  memberships: [],
  ...extra,
});

describe('contextual identity (spec §5 switching transaction)', () => {
  it('uses the canonical id the server resolved, even when a slug was sent', () => {
    const context = toAccessContext(me({ activeOrganizationId: '6f1c…uuid', permissions: ['workspace:read'] }), 'acme-corp');
    expect(context.id).toBe('6f1c…uuid');
  });

  it('normalises omitted permissions to none, never to full access (P1-T32)', () => {
    expect(toAccessContext(me({ activeOrganizationId: 'w' }), 'w').permissions).toEqual([]);
  });

  it('dedupes and sorts permission keys', () => {
    const context = toAccessContext(me({ permissions: ['member:read', 'agent:read', 'member:read'] }), 'w');
    expect(context.permissions).toEqual(['agent:read', 'member:read']);
  });

  it("keeps the invitation token out of the cache key", () => {
    expect(JSON.stringify(queryKeys.invitationPreview('super-secret-token'))).not.toContain('super-secret-token');
  });

  it('scopes every workspace entry under its id', () => {
    expect(queryKeys.context('w1').slice(0, 2)).toEqual(['ws', 'w1']);
    expect(queryKeys.permissions('w1')).toEqual(queryKeys.context('w1'));
  });
});
