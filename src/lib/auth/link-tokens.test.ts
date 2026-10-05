import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetLinkTokensForTests,
  clearLinkToken,
  hasPendingInvitation,
  linkTokenFor,
  linkTokenLoader,
  readLinkToken,
  rememberLinkToken,
  updateLinkMeta,
} from './link-tokens';

function load(kind: Parameters<typeof linkTokenLoader>[0], url: string) {
  return linkTokenLoader(kind)({ request: new Request(url), params: {}, context: undefined } as never) as Response | null;
}

describe('email-link tokens (spec §2)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetLinkTokensForTests();
  });
  afterEach(() => vi.useRealTimers());

  it('moves the token out of the address bar, keeping the rest of the query', () => {
    const response = load('invitation', 'http://localhost:5173/invitations/accept?token=abc&utm=x');
    expect(response?.status).toBe(302);
    expect(response?.headers.get('Location')).toBe('/invitations/accept?utm=x');
    // A replace, so Back never returns to the token-bearing URL.
    expect(response?.headers.get('X-Remix-Replace')).toBe('true');
    expect(readLinkToken('invitation')?.token).toBe('abc');
    expect(hasPendingInvitation()).toBe(true);
  });

  it('leaves the URL alone when there is no token', () => {
    expect(load('verify-email', 'http://localhost:5173/auth/verify-email')).toBeNull();
  });

  it('keeps the token in the URL when it cannot be stored, so a reload still works', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(load('reset-password', 'http://localhost:5173/auth/reset-password?token=t1')).toBeNull();
    setItem.mockRestore();
    // Still usable for this page view, from the URL.
    expect(linkTokenFor('reset-password', new URLSearchParams('token=t1'))).toBe('t1');
  });

  it('expires and can be cleared', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T10:00:00Z'));
    rememberLinkToken('verify-email', 'v');
    vi.setSystemTime(new Date('2026-10-05T10:31:00Z'));
    expect(readLinkToken('verify-email')).toBeNull();

    rememberLinkToken('reset-password', 'r');
    clearLinkToken('reset-password');
    expect(readLinkToken('reset-password')).toBeNull();
  });

  it('keeps display facts about the same link, and drops them for a new one', () => {
    rememberLinkToken('invitation', 'one');
    updateLinkMeta('invitation', { workspaceName: 'Acme', maskedEmail: 'sa***@acme.test' });
    rememberLinkToken('invitation', 'one');
    expect(readLinkToken('invitation')?.meta?.workspaceName).toBe('Acme');
    rememberLinkToken('invitation', 'two');
    expect(readLinkToken('invitation')?.meta).toBeUndefined();
  });

  it('ignores something that is too long to be a backend token', () => {
    const response = load('invitation', `http://localhost:5173/invitations/accept?token=${'x'.repeat(600)}`);
    expect(response?.headers.get('Location')).toBe('/invitations/accept');
    expect(readLinkToken('invitation')).toBeNull();
  });
});
