import type { CurrentUser } from '@/lib/api/types';
import { lastWorkspace } from '@/lib/storage';
import { hasPendingInvitation } from './link-tokens';

/** The embedded membership list stops here; past it, the list may be incomplete (spec §5). */
export const EMBEDDED_MEMBERSHIP_CAP = 100;

/**
 * Only same-site paths are accepted as `next`, so a crafted link cannot bounce a
 * user to another site after sign-in.
 */
export function safeNext(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if (/\p{Cc}/u.test(next)) return null;
  // Never land back on a sign-in style page.
  if (/^\/auth\/(sign-in|sign-up|login|register|forgot-password|mfa)(?:[/?#]|$)/.test(next)) return null;
  return next;
}

/** The URL of a workspace: its slug when known (readable), else its id (the gate accepts both). */
export function workspaceHref(workspace: { slug?: string | null; id: string }, subpath = ''): string {
  return `/w/${encodeURIComponent(workspace.slug || workspace.id)}${subpath}`;
}

/**
 * Where to send a user after sign-in or from "/" (spec §4 bootstrap step 5):
 * a safe `next`, then a pending invitation, then the last-used workspace if it is
 * still one of theirs, then the only workspace, onboarding, or the picker.
 */
export function defaultLanding(me: CurrentUser | undefined, next?: string | null): string {
  const target = safeNext(next);
  if (target) return target;
  if (hasPendingInvitation()) return '/invitations/accept';
  if (!me) return '/workspaces';

  const lastId = lastWorkspace.get(me.id);
  if (lastId) {
    const last = me.memberships.find((membership) => membership.organizationId === lastId);
    if (last) return workspaceHref({ id: last.organizationId, slug: last.organizationSlug });
    // Beyond the embedded list: the gate validates it like any deep link.
    if (me.memberships.length >= EMBEDDED_MEMBERSHIP_CAP) return workspaceHref({ id: lastId });
  }
  if (me.memberships.length === 1) {
    const only = me.memberships[0];
    return workspaceHref({ id: only.organizationId, slug: only.organizationSlug });
  }
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
