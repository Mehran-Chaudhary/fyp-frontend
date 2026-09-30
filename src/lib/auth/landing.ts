import type { CurrentUser } from '@/lib/api/types';
import { STORAGE_KEYS, storage } from '@/lib/storage';

/**
 * Only same-site paths are accepted as `next`, so a crafted link cannot bounce a
 * user to another site after sign-in (spec §6.2).
 */
export function safeNext(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if (/\p{Cc}/u.test(next)) return null;
  // Never land back on a sign-in style page.
  if (/^\/auth\/(sign-in|sign-up|forgot-password)/.test(next)) return null;
  return next;
}

/** Where to send a user after sign-in or from "/" (spec §6.3). */
export function defaultLanding(me: CurrentUser | undefined, next?: string | null): string {
  const target = safeNext(next);
  if (target) return target;
  if (!me) return '/workspaces';

  const last = storage.get(STORAGE_KEYS.lastWorkspace);
  if (last && me.memberships.some((membership) => membership.organizationSlug === last)) return `/w/${last}`;
  if (me.memberships.length === 1) return `/w/${me.memberships[0].organizationSlug}`;
  if (me.memberships.length === 0) return '/workspaces/new';
  return '/workspaces';
}

/** "/auth/sign-in?next=/w/acme-corp/agents" */
export function signInPath(options: { next?: string | null; reason?: string | null } = {}): string {
  const params = new URLSearchParams();
  if (options.reason) params.set('reason', options.reason);
  const next = safeNext(options.next ?? null);
  if (next && next !== '/') params.set('next', next);
  const qs = params.toString();
  return qs ? `/auth/sign-in?${qs}` : '/auth/sign-in';
}
