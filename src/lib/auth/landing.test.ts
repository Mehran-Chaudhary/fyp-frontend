import { beforeEach, describe, expect, it } from 'vitest';
import type { CurrentUser, MembershipSummary } from '@/lib/api/types';
import { lastWorkspace } from '@/lib/storage';
import { defaultLanding, safeNext, signInPath, workspaceHref } from './landing';
import { __resetLinkTokensForTests, clearLinkToken, rememberLinkToken } from './link-tokens';

const membership = (slug: string): MembershipSummary => ({
  organizationId: `id-${slug}`,
  organizationName: slug,
  organizationSlug: slug,
  roleSlugs: ['member'],
  isOwner: false,
});

const user = (slugs: string[], id = 'u1'): CurrentUser => ({
  id,
  email: 'sara@acme.test',
  firstName: 'Sara',
  lastName: 'Khan',
  displayName: 'Sara Khan',
  emailVerified: true,
  isPlatformAdmin: false,
  status: 'ACTIVE',
  avatarUrl: null,
  memberships: slugs.map(membership),
});

describe('safeNext', () => {
  it('accepts same-site paths', () => {
    expect(safeNext('/w/acme-corp/agents?x=1')).toBe('/w/acme-corp/agents?x=1');
    expect(safeNext('/invitations/accept')).toBe('/invitations/accept');
  });

  it('rejects other sites and protocol tricks', () => {
    expect(safeNext('https://evil.example')).toBeNull();
    expect(safeNext('//evil.example')).toBeNull();
    expect(safeNext('/\\evil.example')).toBeNull();
    expect(safeNext('javascript:alert(1)')).toBeNull();
    expect(safeNext('/w/x\n')).toBeNull();
  });

  it('never returns to sign-in pages, under either name', () => {
    expect(safeNext('/auth/sign-in')).toBeNull();
    expect(safeNext('/auth/login?next=/x')).toBeNull();
    expect(safeNext('/auth/register')).toBeNull();
    expect(safeNext('/auth/sign-incredible')).toBe('/auth/sign-incredible');
  });
});

describe('defaultLanding (spec §4 bootstrap step 5)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    __resetLinkTokensForTests();
  });

  it('prefers a valid next', () => {
    expect(defaultLanding(user(['a', 'b']), '/account/security')).toBe('/account/security');
  });

  it('resumes a pending invitation before anything else', () => {
    rememberLinkToken('invitation', 'tok');
    expect(defaultLanding(user(['a', 'b']))).toBe('/invitations/accept');
    clearLinkToken('invitation');
    expect(defaultLanding(user(['a', 'b']))).toBe('/workspaces');
  });

  it("returns to this user's last workspace while it is still theirs", () => {
    lastWorkspace.set('u1', 'id-b');
    expect(defaultLanding(user(['a', 'b']))).toBe('/w/b');
    // Another account on the same browser has its own hint.
    expect(defaultLanding(user(['a', 'b'], 'u2'))).toBe('/workspaces');
    lastWorkspace.set('u1', 'id-gone');
    expect(defaultLanding(user(['a', 'b']))).toBe('/workspaces');
  });

  it('trusts the hint past the 100 embedded memberships and lets the gate decide', () => {
    const many = Array.from({ length: 100 }, (_, index) => `w${index}`);
    lastWorkspace.set('u1', '0b9cbb0e-5d4e-4bb3-9d52-1e9f1d1c2a11');
    expect(defaultLanding(user(many))).toBe('/w/0b9cbb0e-5d4e-4bb3-9d52-1e9f1d1c2a11');
  });

  it('enters the only workspace, or sends new users to create one', () => {
    expect(defaultLanding(user(['solo']))).toBe('/w/solo');
    expect(defaultLanding(user([]))).toBe('/workspaces/new');
  });
});

describe('links', () => {
  it('builds sign-in links with an encoded next', () => {
    expect(signInPath({ next: '/w/acme/team?tab=roles', reason: 'session-ended' })).toBe(
      '/auth/sign-in?reason=session-ended&next=%2Fw%2Facme%2Fteam%3Ftab%3Droles',
    );
    expect(signInPath({ next: '//evil' })).toBe('/auth/sign-in');
  });

  it('addresses a workspace by slug, or by id when the slug is unknown', () => {
    expect(workspaceHref({ id: 'id-1', slug: 'acme' }, '/team')).toBe('/w/acme/team');
    expect(workspaceHref({ id: 'id-1' })).toBe('/w/id-1');
  });
});
