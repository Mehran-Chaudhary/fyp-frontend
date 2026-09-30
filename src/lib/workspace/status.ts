import type { ApiKey, Invitation } from '../api/types';

export type InvitationDisplayStatus = 'pending' | 'expired' | 'accepted' | 'revoked';

/**
 * An expired invitation can still say PENDING until the server's sweep marks it
 * (every 6 hours by default), so derive it from `expiresAt` too (spec §5.3).
 */
export function invitationStatus(
  invitation: Pick<Invitation, 'status' | 'expiresAt'>,
  now = Date.now(),
): InvitationDisplayStatus {
  if (invitation.status === 'ACCEPTED') return 'accepted';
  if (invitation.status === 'REVOKED') return 'revoked';
  if (invitation.status === 'EXPIRED' || Date.parse(invitation.expiresAt) <= now) return 'expired';
  return 'pending';
}

/** Resend and Revoke are offered for pending and expired invitations. */
export const invitationActionable = (invitation: Pick<Invitation, 'status' | 'expiresAt'>, now = Date.now()) =>
  ['pending', 'expired'].includes(invitationStatus(invitation, now));

export type ApiKeyStatus = 'active' | 'expired' | 'revoked';

export function apiKeyStatus(key: Pick<ApiKey, 'revokedAt' | 'expiresAt'>, now = Date.now()): ApiKeyStatus {
  if (key.revokedAt) return 'revoked';
  if (key.expiresAt && Date.parse(key.expiresAt) <= now) return 'expired';
  return 'active';
}
