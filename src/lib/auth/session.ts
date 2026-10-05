import { create } from 'zustand';
import { withAuthLock } from '@/lib/api/auth-lock';
import { authApi } from '@/lib/api/endpoints';
import { isApiError } from '@/lib/api/errors';
import {
  authEvents,
  endSession,
  getAccessToken,
  hasActiveSession,
  restoreSession,
  retryUncertainRefresh,
  revokeCookieSession,
  startSession,
} from '@/lib/api/token-manager';
import type { AuthResponse, CurrentUser } from '@/lib/api/types';
import { connectivityEvents } from '@/lib/connectivity';
import { meQuery, queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { STORAGE_KEYS, storage } from '@/lib/storage';
import { clearAllWorkspaceBlocks } from '@/lib/workspace-blocks';

/**
 * The session coordinator's state half (Phase 1 spec §4). The access token is NOT
 * here: it stays inside the token manager. The signed-in user lives in the ['me']
 * query.
 *
 *   restoring ──► unauthenticated (anonymous)
 *             ├─► authenticated ──► (+ emailVerificationRequired: the global gate)
 *             └─► bootIssue: unreachable (retries itself) | uncertain | error (the user decides)
 *   unauthenticated ──► sign-in ──► MFA challenge (still unauthenticated) ──► authenticated
 *   authenticated ──► sign-out ──► unauthenticated (reason says how it ended)
 *
 * Workspace selection lives in the workspace gate; this store is account-wide.
 */
export type SessionStatus = 'restoring' | 'authenticated' | 'unauthenticated';

export type SignOutReason =
  | 'signed-out'
  /** Signed out here, but the server never confirmed it (spec §4 "Logout network failure"). */
  | 'signed-out-unconfirmed'
  | 'quiet'
  | 'session-ended'
  | 'reuse-detected'
  | 'suspended'
  | 'signed-out-everywhere'
  | 'device-signed-out'
  | 'password-reset'
  | 'password-changed'
  | 'account-erased';

export type BootIssue =
  /** The API can't be reached; the session is safe and boot retries by itself. */
  | { kind: 'unreachable'; attempt: number; retryAt: number }
  /** The refresh got no answer in time: it may have rotated the cookie. Never retried blindly. */
  | { kind: 'uncertain' }
  | { kind: 'error'; message: string; requestId?: string };

interface SessionState {
  status: SessionStatus;
  reason: SignOutReason | null;
  bootIssue: BootIssue | null;
  /** Set while POST /auth/refresh is throttled (429). Never a sign-out. */
  refreshBlockedUntil: number | null;
  /** A refresh timed out mid-session; automatic refreshes wait for the user. */
  refreshUncertain: boolean;
  /** The deployment requires a verified email and this account isn't (global gate). */
  emailVerificationRequired: boolean;
  /** The email used to sign in or register, for resend when /auth/me is refused. Memory only. */
  knownEmail: string | null;
  /** Shown on /goodbye after an erasure. */
  farewell: { workspacesDeleted: number } | null;
}

export const useSession = create<SessionState>(() => ({
  status: 'restoring',
  reason: null,
  bootIssue: null,
  refreshBlockedUntil: null,
  refreshUncertain: false,
  emailVerificationRequired: false,
  knownEmail: null,
  farewell: null,
}));

const REASONS: ReadonlySet<string> = new Set<SignOutReason>([
  'signed-out',
  'signed-out-unconfirmed',
  'quiet',
  'session-ended',
  'reuse-detected',
  'suspended',
  'signed-out-everywhere',
  'device-signed-out',
  'password-reset',
  'password-changed',
  'account-erased',
]);

/** Maps an error code (or a reason another tab broadcast) to a sign-out reason. */
export function reasonFromCode(code: string | undefined): SignOutReason {
  if (!code) return 'quiet';
  if (REASONS.has(code)) return code as SignOutReason;
  switch (code) {
    case 'AUTH_TOKEN_MISSING':
      return 'quiet';
    case 'AUTH_REFRESH_TOKEN_REUSED':
      return 'reuse-detected';
    case 'ACCOUNT_SUSPENDED':
    case 'ACCOUNT_DEACTIVATED':
      return 'suspended';
    default:
      return 'session-ended';
  }
}

/** Reasons after which returning to the same page makes sense. */
export function reasonKeepsDestination(reason: SignOutReason | null): boolean {
  return reason === null || reason === 'quiet' || reason === 'session-ended' || reason === 'reuse-detected';
}

// ── Boot ────────────────────────────────────────────────────────────────────

const UNREACHABLE_BACKOFF_MS = [2_000, 4_000, 8_000, 15_000, 30_000];
let bootPromise: Promise<void> | null = null;
let bootRetryTimer: number | null = null;
let bootAttempt = 0;
/** The account the cache belongs to: another account means a clean cache. */
let cachedUserId: string | null = null;

function clearBootRetry() {
  if (bootRetryTimer !== null) window.clearTimeout(bootRetryTimer);
  bootRetryTimer = null;
}

/**
 * Restores the session once. Safe to call from anywhere, any number of times:
 * concurrent calls share one run, so React StrictMode cannot cause a second
 * refresh. Runs outside React (main.tsx).
 */
export function bootstrapSession(): Promise<void> {
  if (bootPromise) return bootPromise;
  clearBootRetry();
  bootPromise = runBoot().finally(() => {
    bootPromise = null;
  });
  return bootPromise;
}

async function runBoot(): Promise<void> {
  // An outage keeps its explanation (and countdown) while boot retries by itself.
  useSession.setState((state) => ({
    status: 'restoring',
    bootIssue: state.bootIssue?.kind === 'unreachable' ? state.bootIssue : null,
  }));
  try {
    const restored = await restoreSession();
    if (!restored) {
      bootAttempt = 0;
      useSession.setState((state) => ({
        status: 'unauthenticated',
        bootIssue: null,
        reason: state.reason ?? (storage.get(STORAGE_KEYS.signOutPending) ? 'signed-out-unconfirmed' : null),
      }));
      return;
    }
    await loadCurrentUser();
    bootAttempt = 0;
  } catch (error) {
    handleBootError(error);
  }
}

/** Fetches unscoped /auth/me and marks the session authenticated, unless it ended meanwhile. */
async function loadCurrentUser(): Promise<CurrentUser | undefined> {
  let me: CurrentUser | undefined;
  try {
    me = await queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
  } catch (error) {
    // The global email gate: the session exists but bearer routes are refused. Keep
    // it (no refresh, no sign-out loop) so the verification screen can render.
    if (!(isApiError(error) && error.code === 'ACCOUNT_EMAIL_NOT_VERIFIED')) throw error;
    useSession.setState({ emailVerificationRequired: true });
  }
  if (!hasActiveSession()) return undefined; // ended while loading; state already updated
  if (me) adoptUser(me.id);
  useSession.setState({ status: 'authenticated', reason: null, bootIssue: null });
  return me;
}

/** A different account than the cache was filled for: drop everything but identity. */
function adoptUser(userId: string): void {
  if (cachedUserId && cachedUserId !== userId) {
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.me[0] });
    clearAllWorkspaceBlocks();
  }
  cachedUserId = userId;
}

function handleBootError(error: unknown): void {
  if (!hasActiveSession() && useSession.getState().status === 'unauthenticated') return;

  if (isApiError(error) && error.status === 429) {
    // The throttle screen counts down and calls retryAfterThrottle().
    useSession.setState((state) => ({
      refreshBlockedUntil: state.refreshBlockedUntil ?? error.retryDeadline(),
    }));
    return;
  }

  if (isApiError(error) && error.code === 'NETWORK_TIMEOUT') {
    useSession.setState({ bootIssue: { kind: 'uncertain' } });
    return;
  }

  // No answer at all (or a gateway saying the API is down): the request never
  // reached it, so trying again is safe. Back off and keep the session.
  if (isApiError(error) && error.code === 'NETWORK_ERROR') {
    const delay = UNREACHABLE_BACKOFF_MS[Math.min(bootAttempt, UNREACHABLE_BACKOFF_MS.length - 1)];
    bootAttempt += 1;
    useSession.setState({
      bootIssue: { kind: 'unreachable', attempt: bootAttempt, retryAt: Date.now() + delay },
    });
    clearBootRetry();
    bootRetryTimer = window.setTimeout(() => void bootstrapSession(), delay);
    return;
  }

  useSession.setState({
    bootIssue: {
      kind: 'error',
      message: isApiError(error) ? error.message : 'Something went wrong while restoring your session.',
      requestId: isApiError(error) ? error.requestId : undefined,
    },
  });
}

/** The throttle screen's countdown ended. */
export async function retryAfterThrottle(): Promise<void> {
  useSession.setState({ refreshBlockedUntil: null });
  const { status } = useSession.getState();
  if (status === 'restoring') {
    await bootstrapSession();
    return;
  }
  if (status === 'authenticated') {
    try {
      await getAccessToken();
      await queryClient.refetchQueries({ type: 'active' });
    } catch {
      /* a new throttle window or an outage was recorded by its own handler */
    }
  }
}

/** The user chose to try an ambiguous refresh again (boot or mid-session). */
export async function confirmUncertainSession(): Promise<void> {
  useSession.setState({ refreshUncertain: false });
  if (useSession.getState().status === 'restoring') {
    useSession.setState({ bootIssue: null });
    try {
      if ((await retryUncertainRefresh()) === null) return;
      await loadCurrentUser();
    } catch (error) {
      handleBootError(error);
    }
    return;
  }
  try {
    if ((await retryUncertainRefresh()) !== null) await queryClient.refetchQueries({ type: 'active' });
  } catch {
    /* its own handler recorded the new state */
  }
}

/** The user chose to sign in again rather than retry an ambiguous refresh. */
export function abandonUncertainSession(): void {
  useSession.setState({ refreshUncertain: false, bootIssue: null });
  endSession('session-ended');
}

// ── Sign-in / sign-out ──────────────────────────────────────────────────────

/**
 * Completes any successful sign-in (register, login, MFA verify): installs the
 * token, loads /auth/me and flips the session to authenticated. The public-only
 * guard then routes the user.
 */
export async function completeSignIn(auth: AuthResponse): Promise<void> {
  startSession(auth.tokens);
  useSession.setState({
    knownEmail: auth.user.email,
    refreshBlockedUntil: null,
    refreshUncertain: false,
    emailVerificationRequired: false,
  });
  try {
    await loadCurrentUser();
  } catch {
    // The session exists even if /auth/me failed transiently; the guards show a
    // retryable error while loading it.
    if (hasActiveSession()) useSession.setState({ status: 'authenticated', reason: null, bootIssue: null });
  }
}

/**
 * Sign out of this browser (spec §4): revoke the session on the server, then
 * clean up locally whatever happened. When the server can't confirm it, say so,
 * and keep this browser from restoring the session by itself.
 */
export async function signOut(reason: SignOutReason = 'signed-out'): Promise<void> {
  let confirmed = true;
  try {
    // An expired token is refreshed first; a session the refresh finds gone is
    // already over on the server.
    const token = await getAccessToken();
    if (token) await withAuthLock(() => authApi.logout(token));
  } catch (error) {
    // A 401 means the server no longer accepts this session; anything else
    // (offline, timeout, 5xx, throttled) leaves its fate unknown.
    confirmed = isApiError(error) && error.source === 'server' && error.status === 401;
  } finally {
    if (!confirmed) storage.set(STORAGE_KEYS.signOutPending, '1');
    endSession(confirmed ? reason : 'signed-out-unconfirmed');
  }
}

/**
 * Finishes a sign-out the server never confirmed: uses the cookie once more to
 * revoke that session, without signing anyone back in. Resolves true when done.
 */
export async function finishPendingSignOut(): Promise<boolean> {
  try {
    const done = await revokeCookieSession();
    if (done) storage.remove(STORAGE_KEYS.signOutPending);
    return done;
  } catch {
    return false;
  }
}

/** Forget an unconfirmed sign-out the user chose to leave as it is. */
export function dismissPendingSignOut(): void {
  storage.remove(STORAGE_KEYS.signOutPending);
}

export function hasPendingSignOut(): boolean {
  return storage.get(STORAGE_KEYS.signOutPending) === '1';
}

/** Sign out of every device, this one included (P1-API-11). Throws when it didn't happen. */
export async function signOutEverywhere(): Promise<number> {
  const token = await getAccessToken();
  if (!token) throw new Error('You are already signed out.');
  const { revokedSessions } = await withAuthLock(() => authApi.logoutAll(token));
  endSession('signed-out-everywhere');
  return revokedSessions;
}

/** Local cleanup only, for when the server already ended the session. */
export function endSessionLocally(reason: SignOutReason): void {
  endSession(reason);
}

/**
 * After the user verified their email elsewhere: re-check /auth/me and leave the
 * "verify your email" screen if it now succeeds.
 */
export async function recheckEmailVerification(): Promise<boolean> {
  try {
    const me = await queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
    adoptUser(me.id);
    useSession.setState({ emailVerificationRequired: false, status: 'authenticated' });
    return true;
  } catch {
    return false;
  }
}

export function setFarewell(workspacesDeleted: number): void {
  useSession.setState({ farewell: { workspacesDeleted } });
}

// ── Wiring ──────────────────────────────────────────────────────────────────

authEvents.on('session-ended', ({ reason }) => {
  clearBootRetry();
  // Identity, permissions, tenant data and every user-bound cache go with it.
  queryClient.clear();
  clearAllWorkspaceBlocks();
  cachedUserId = null;
  useSession.setState({
    status: 'unauthenticated',
    reason: reasonFromCode(reason),
    bootIssue: null,
    refreshBlockedUntil: null,
    refreshUncertain: false,
    emailVerificationRequired: false,
  });
});

authEvents.on('session-adopted', () => {
  // Signed in from another tab while this one was signed out.
  if (useSession.getState().status !== 'authenticated') void bootstrapSession();
});

authEvents.on('refresh-throttled', ({ error }) => {
  useSession.setState({ refreshBlockedUntil: error.retryDeadline() });
});

authEvents.on('refresh-uncertain', () => {
  // During boot the splash explains it; afterwards a dialog does.
  if (useSession.getState().status === 'authenticated') useSession.setState({ refreshUncertain: true });
});

connectivityEvents.on('restored', () => {
  const { status, bootIssue } = useSession.getState();
  if (status === 'restoring' && bootIssue?.kind === 'unreachable') {
    void bootstrapSession();
    return;
  }
  if (status === 'authenticated') {
    // Bounded: only queries that failed, once each. Mutations are never replayed.
    void queryClient.refetchQueries({ type: 'active', predicate: (query) => query.state.status === 'error' });
  }
});
