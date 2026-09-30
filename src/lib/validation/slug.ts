/** Same rules as the server (backend src/common/utils/slug.util.ts, spec §10). */
export const SLUG_MAX_LENGTH = 60;
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'billing',
  'dashboard',
  'docs',
  'health',
  'internal',
  'login',
  'logout',
  'metrics',
  'new',
  'platform',
  'public',
  'register',
  'root',
  'settings',
  'signup',
  'static',
  'status',
  'support',
  'system',
  'www',
]);

/**
 * NFKD-normalise, strip combining marks, lowercase, collapse everything outside
 * [a-z0-9] into single hyphens, trim hyphens, cut to 60. "Anwältin GmbH" →
 * "anwaltin-gmbh".
 */
export function slugify(input: string, maxLength = SLUG_MAX_LENGTH): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

/** The live preview: empty when too short, so the server generates one. */
export function slugPreview(name: string): string {
  const slug = slugify(name);
  return slug.length >= 2 ? slug : '';
}
