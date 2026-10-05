import { replace, type LoaderFunctionArgs } from 'react-router';
import { sessionStore } from '@/lib/storage';

/**
 * Email-link tokens (Phase 1 spec §2 "Required email callback routes").
 *
 * The backend emails links to /auth/verify-email, /auth/reset-password and
 * /invitations/accept with `?token=`. Tokens are opaque and must stay out of
 * analytics, logs, error reports and later URLs. So each route's loader takes the
 * token out of the address bar before the page renders and keeps it only for the
 * flow in progress:
 *   - in sessionStorage (this tab only, survives a reload), with a short expiry,
 *     cleared on completion, cancellation or a terminal error;
 *   - in memory when sessionStorage is blocked, in which case the URL keeps the
 *     token, because a reload would otherwise lose it.
 * Sign-in and sign-up then continue to the token-free route (`next=/invitations/accept`).
 */

export type LinkKind = 'invitation' | 'verify-email' | 'reset-password';

export interface LinkRecord {
  token: string;
  savedAt: number;
  expiresAt: number;
  /** Display-only facts about the flow (an invitation's workspace and masked email). */
  meta?: { workspaceName?: string; maskedEmail?: string; /** The token was used successfully. */ done?: boolean };
}

/** Long enough to register, verify and come back; short enough not to linger. */
const TTL_MS: Record<LinkKind, number> = {
  invitation: 2 * 60 * 60_000,
  'verify-email': 30 * 60_000,
  'reset-password': 60 * 60_000,
};

const MAX_TOKEN_LENGTH = 512;
const memory = new Map<LinkKind, LinkRecord>();
const keyOf = (kind: LinkKind) => `av.link.${kind}`;

function parse(raw: string | null): LinkRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LinkRecord>;
    if (typeof value.token !== 'string' || typeof value.expiresAt !== 'number' || typeof value.savedAt !== 'number') {
      return null;
    }
    return value as LinkRecord;
  } catch {
    return null;
  }
}

/** Keeps a link token for this flow. Returns whether it survives a reload. */
export function rememberLinkToken(kind: LinkKind, token: string): boolean {
  const now = Date.now();
  const existing = readLinkToken(kind);
  const record: LinkRecord = {
    token,
    savedAt: now,
    expiresAt: now + TTL_MS[kind],
    // Same link opened again: keep what we learned about it.
    meta: existing?.token === token ? existing.meta : undefined,
  };
  memory.set(kind, record);
  return sessionStore.set(keyOf(kind), JSON.stringify(record));
}

/** The token for a flow in progress, or null (missing or expired). */
export function readLinkToken(kind: LinkKind): LinkRecord | null {
  const record = parse(sessionStore.get(keyOf(kind))) ?? memory.get(kind) ?? null;
  if (!record) return null;
  if (record.expiresAt <= Date.now()) {
    clearLinkToken(kind);
    return null;
  }
  return record;
}

export function updateLinkMeta(kind: LinkKind, meta: NonNullable<LinkRecord['meta']>): void {
  const record = readLinkToken(kind);
  if (!record) return;
  const next = { ...record, meta: { ...record.meta, ...meta } };
  memory.set(kind, next);
  sessionStore.set(keyOf(kind), JSON.stringify(next));
}

export function clearLinkToken(kind: LinkKind): void {
  memory.delete(kind);
  sessionStore.remove(keyOf(kind));
}

/** Whether an invitation is waiting to be accepted in this tab (spec §4 bootstrap step 5). */
export function hasPendingInvitation(): boolean {
  return readLinkToken('invitation') !== null;
}

/**
 * Route loader: moves `?token=` into the flow's storage and redirects to the same
 * route without it. A token that can't be stored stays in the URL.
 */
export function linkTokenLoader(kind: LinkKind) {
  return ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);
    const token = url.searchParams.get('token')?.trim();
    if (!token) return null;
    if (token.length > MAX_TOKEN_LENGTH) {
      // Not something the backend issued; don't keep it around.
      url.searchParams.delete('token');
      return replace(`${url.pathname}${url.search}`);
    }
    if (!rememberLinkToken(kind, token)) return null;
    url.searchParams.delete('token');
    return replace(`${url.pathname}${url.search}`);
  };
}

/** The token a page should use: the stored one, or one still in the URL. */
export function linkTokenFor(kind: LinkKind, search: URLSearchParams): string | null {
  const fromUrl = search.get('token')?.trim();
  if (fromUrl && fromUrl.length <= MAX_TOKEN_LENGTH) return fromUrl;
  return readLinkToken(kind)?.token ?? null;
}

/** Test-only. */
export function __resetLinkTokensForTests(): void {
  memory.clear();
}
