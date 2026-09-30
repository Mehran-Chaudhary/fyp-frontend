import { describe, expect, it } from 'vitest';
import { apiKeyStatus, invitationActionable, invitationStatus } from './status';

const now = Date.parse('2026-09-30T12:00:00.000Z');
const future = '2026-10-06T21:02:31.246Z';
const past = '2026-09-29T21:02:31.246Z';

describe('invitationStatus', () => {
  it('trusts ACCEPTED and REVOKED whatever the expiry', () => {
    expect(invitationStatus({ status: 'ACCEPTED', expiresAt: past }, now)).toBe('accepted');
    expect(invitationStatus({ status: 'REVOKED', expiresAt: future }, now)).toBe('revoked');
  });

  it('shows a PENDING invitation past its expiry as expired (before the sweep marks it)', () => {
    expect(invitationStatus({ status: 'PENDING', expiresAt: past }, now)).toBe('expired');
    expect(invitationStatus({ status: 'PENDING', expiresAt: future }, now)).toBe('pending');
  });

  it('shows EXPIRED as expired', () => {
    expect(invitationStatus({ status: 'EXPIRED', expiresAt: past }, now)).toBe('expired');
  });

  it('offers resend and revoke for pending and expired invitations only', () => {
    expect(invitationActionable({ status: 'PENDING', expiresAt: future }, now)).toBe(true);
    expect(invitationActionable({ status: 'PENDING', expiresAt: past }, now)).toBe(true);
    expect(invitationActionable({ status: 'EXPIRED', expiresAt: past }, now)).toBe(true);
    expect(invitationActionable({ status: 'ACCEPTED', expiresAt: future }, now)).toBe(false);
    expect(invitationActionable({ status: 'REVOKED', expiresAt: future }, now)).toBe(false);
  });
});

describe('apiKeyStatus', () => {
  it('puts revocation before expiry', () => {
    expect(apiKeyStatus({ revokedAt: past, expiresAt: past }, now)).toBe('revoked');
  });

  it('detects expiry and treats a missing expiry as active', () => {
    expect(apiKeyStatus({ revokedAt: null, expiresAt: past }, now)).toBe('expired');
    expect(apiKeyStatus({ revokedAt: null, expiresAt: future }, now)).toBe('active');
    expect(apiKeyStatus({ revokedAt: null, expiresAt: null }, now)).toBe('active');
  });
});
