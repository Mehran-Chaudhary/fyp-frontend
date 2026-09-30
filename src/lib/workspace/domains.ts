/**
 * Allowed email domains for invitations (spec §5.8.2). The server compares
 * case-insensitively, ignores a leading "@" and matches the exact domain only:
 * subdomains do not match.
 */

const DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export const MAX_ALLOWED_DOMAINS = 20;
export const MAX_DOMAIN_LENGTH = 253;

/** "@Acme.Test " → "acme.test" */
export function normaliseDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^@+/, '');
}

export function domainProblem(domain: string): string | null {
  if (!domain) return 'Enter a domain such as acme.com.';
  if (domain.length > MAX_DOMAIN_LENGTH) return `Domains are at most ${MAX_DOMAIN_LENGTH} characters.`;
  if (/\s/.test(domain)) return "Domains can't contain spaces.";
  if (domain.includes('@')) return 'Enter only the part after the @, such as acme.com.';
  if (!DOMAIN_PATTERN.test(domain)) return `"${domain}" isn't a valid domain.`;
  return null;
}

/** The domain of an address, lowercased: "Zara@Acme.test" → "acme.test". */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1).trim().toLowerCase();
}

/** True when there is no restriction, or the address's domain is exactly one of them. */
export function isEmailAllowed(email: string, allowedDomains: readonly string[] | null | undefined): boolean {
  const domains = (allowedDomains ?? []).map(normaliseDomain).filter(Boolean);
  if (domains.length === 0) return true;
  return domains.includes(emailDomain(email));
}
