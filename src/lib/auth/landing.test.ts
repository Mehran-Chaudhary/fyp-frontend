import { beforeEach, describe, expect, it } from 'vitest';
import type { CurrentUser, MembershipSummary } from '@/lib/api/types';
import { defaultLanding, safeNext, signInPath } from './landing';

const membership = (slug: string): MembershipSummary => ({
  organizationId: `id-${slug}`,
  organizationName: slug,
  organizationSlug: slug,
  roleSlugs: ['member'],
  isOwner: false,
});

const user = (slugs: string[]): CurrentUser => ({
  id: 'u1',
  email: 'sara@acme.test',
  firstName: 'Sara',
  lastName: 'Khan',
  displayName: 'Sara Khan',
  emailVerified: true,
  isPlatformAdmin: false,
  status: 'ACTIVE',
  memberships: slugs.map(membership),
});

describe('safeNext (spec §6.2)', () => {
  it('accepts same-site paths', () => {
    expect(safeNext('/w/acme-corp/agents?x=1')).toBe('/w/acme-corp/agents?x=1');
    expect(safeNext('/invitations/accept?token=abc')).toBe('/invitations/accept?token=abc');
  });

  it('rejects other sites and protocol tricks', () => {
    expect(safeNext('https://evil.example')).toBeNull();
    expect(safeNext('//evil.example')).toBeNull();
    expect(safeNext('/\\evil.example')).toBeNull();
    expect(safeNext('javascript:alert(1)')).toBeNull();
    expect(safeNext('/w/x\n')).toBeNull();
  });

  it('never returns to sign-in pages', () => {
    expect(safeNext('/auth/sign-in')).toBeNull();
  });
});

describe('defaultLanding (spec §6.3)', () => {
  beforeEach(() => localStorage.clear());

  it('prefers a valid next', () => {
    expect(defaultLanding(user(['a', 'b']), '/account/security')).toBe('/account/security');
  });

  it('returns to the last workspace when still a member', () => {
    localStorage.setItem('av.lastWorkspace', 'b');
    expect(defaultLanding(user(['a', 'b']))).toBe('/w/b');
    localStorage.setItem('av.lastWorkspace', 'gone');
    expect(defaultLanding(user(['a', 'b']))).toBe('/workspaces');
  });

  it('enters the only workspace, or sends new users to create one', () => {
    expect(defaultLanding(user(['solo']))).toBe('/w/solo');
    expect(defaultLanding(user([]))).toBe('/workspaces/new');
  });

  it('builds sign-in links with an encoded next', () => {
    expect(signInPath({ next: '/invitations/accept?token=a&b=c', reason: 'session-ended' })).toBe(
      '/auth/sign-in?reason=session-ended&next=%2Finvitations%2Faccept%3Ftoken%3Da%26b%3Dc',
    );
    expect(signInPath({ next: '//evil' })).toBe('/auth/sign-in');
  });
});
