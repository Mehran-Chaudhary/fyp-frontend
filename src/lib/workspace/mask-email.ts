/**
 * Reproduces the masking of GET /invitations/preview (copied from the backend's
 * `maskEmail`): 'invitee@x.com' → 'in*****@x.com'. The server masks the
 * lowercased address, so compare `maskEmail(me.email.toLowerCase())` with it.
 */
export function maskEmail(email: string): string {
  const atIndex = email.lastIndexOf('@');
  if (atIndex <= 0) return '[REDACTED]';
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(local.length - visible.length, 2))}${domain}`;
}
