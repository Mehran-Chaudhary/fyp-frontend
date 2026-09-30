import { create } from 'zustand';
import { authApi } from '@/lib/api/endpoints';
import { isApiError, isTransient } from '@/lib/api/errors';
import {
  authEvents,
  endSession,
  getAccessToken,
  hasActiveSession,
  restoreSession,
  startSession,
} from '@/lib/api/token-manager';
import type { AuthResponse, CurrentUser } from '@/lib/api/types';
import { connectivityEvents } from '@/lib/connectivity';
import { meQuery } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';

/**
 * Session state (spec §11). The access token is NOT here: it stays inside the
 * token manager. The signed-in user lives in the ['me'] query.
 */
export type SessionStatus = 'restoring' | 'authenticated' | 'unauthenticated';

export type SignOutReason =
  | 'signed-out'
  | 'quiet'
  | 'session-ended'
  | 'reuse-detected'
  | 'suspended'
  | 'signed-out-everywhere'
  | 'password-reset'
  | 'password-changed'
  | 'account-erased';

export type BootIssue =
  | { kind: 'unreachable'; attempt: number; retryAt: number }
  | { kind: 'error'; message: string; requestId?: string };

interface SessionState {
  status: SessionStatus;
  reason: SignOutReason | null;
  bootIssue: BootIssue | null;
  /** Set while POST /auth/refresh is throttled (429). Never a sign-out (§4.4). */
  refreshBlockedUntil: number | null;
  /** The backend enforces verification and this account is unverified (§7.6). */
  emailVerificationRequired: boolean;
  /** The last email used to sign in, for resend flows when /auth/me is refused. */
  knownEmail: string | null;
  /** Shown on /goodbye after an erasure. */
  farewell: { workspacesDeleted: number } | null;
}

export const useSession = create<SessionState>(() => ({
  status: 'restoring',
  reason: null,
  bootIssue: null,
  refreshBlockedUntil: null,
  emailVerificationRequired: false,
  knownEmail: null,
  farewell: null,
}));

const REASONS: ReadonlySet<string> = new Set<SignOutReason>([
  'signed-out',
  'quiet',
  'session-ended',
  'reuse-detected',
  'suspended',
  'signed-out-everywhere',
  'password-reset',
  'password-changed',
  'account-erased',
]);

/** Maps an error code (or a reason another tab broadcast) to a sign-out reason (§4.4). */
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

function clearBootRetry() {
  if (bootRetryTimer !== null) window.clearTimeout(bootRetryTimer);
  bootRetryTimer = null;
}

/**
 * Restores the session once (spec §4.5). Safe to call from anywhere, any number of
 * times: concurrent calls share one run, so React StrictMode cannot cause a second
 * refresh.
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
  useSession.setState({ status: 'restoring' });
  try {
    const restored = await restoreSession();
    if (!restored) {
      bootAttempt = 0;
      useSession.setState((state) => ({
        status: 'unauthenticated',
        bootIssue: null,
        reason: state.reason ?? null,
      }));
      return;
    }
    await loadCurrentUser();
    bootAttempt = 0;
  } catch (error) {
    handleBootError(error);
  }
}

/** Fetches /auth/me and marks the session authenticated, unless it ended meanwhile. */
async function loadCurrentUser(): Promise<CurrentUser | undefined> {
  let me: CurrentUser | undefined;
  try {
    me = await queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
  } catch (error) {
    // Email verification enforced: the session exists but every call is refused.
    // The global handler raised `emailVerificationRequired`; carry on so the
    // "verify your email" screen can render.
    if (!(isApiError(error) && error.code === 'ACCOUNT_EMAIL_NOT_VERIFIED')) throw error;
  }
  if (!hasActiveSession()) return undefined; // ended while loading; state already updated
  useSession.setState({ status: 'authenticated', reason: null, bootIssue: null });
  return me;
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

  if (isTransient(error)) {
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

/** Called by the throttle screen when its countdown ends. */
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

// ── Sign-in / sign-out ──────────────────────────────────────────────────────

/**
 * Completes any successful sign-in (E1, E2 response A, E3): installs the token,
 * loads /auth/me and flips the session to authenticated. The public-only guard then
 * routes the user (spec §6.3).
 */
export async function completeSignIn(auth: AuthResponse): Promise<void> {
  startSession(auth.tokens);
  useSession.setState({ knownEmail: auth.user.email, refreshBlockedUntil: null, emailVerificationRequired: false });
  try {
    await loadCurrentUser();
  } catch {
    // The session exists even if /auth/me failed transiently; the guards show a
    // retryable error while loading it.
    if (hasActiveSession()) useSession.setState({ status: 'authenticated', reason: null, bootIssue: null });
  }
}

/**
 * Sign out of this browser (spec §4.6): revoke the session family server-side when
 * possible, then clean up locally whatever happened.
 */
export async function signOut(reason: SignOutReason = 'signed-out'): Promise<void> {
  try {
    // If the access token already expired this tries one refresh; if that fails
    // the server call is skipped.
    const token = await getAccessToken().catch(() => null);
    if (token) await authApi.logout().catch(() => undefined);
  } finally {
    endSession(reason);
  }
}

/** Local cleanup only, for when the server already ended every session. */
export function endSessionLocally(reason: SignOutReason): void {
  endSession(reason);
}

/**
 * After the user verified their email elsewhere: re-check /auth/me and leave the
 * "verify your email" screen if it now succeeds.
 */
export async function recheckEmailVerification(): Promise<boolean> {
  try {
    await queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
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
  queryClient.clear();
  useSession.setState({
    status: 'unauthenticated',
    reason: reasonFromCode(reason),
    bootIssue: null,
    refreshBlockedUntil: null,
    emailVerificationRequired: false,
  });
});

authEvents.on('session-adopted', () => {
  // Signed in from another tab while this one was signed out.
  if (useSession.getState().status === 'unauthenticated') void bootstrapSession();
});

authEvents.on('refresh-throttled', ({ error }) => {
  useSession.setState({ refreshBlockedUntil: error.retryDeadline() });
});

connectivityEvents.on('restored', () => {
  const { status, bootIssue } = useSession.getState();
  if (status === 'restoring' && bootIssue?.kind === 'unreachable') {
    void bootstrapSession();
    return;
  }
  if (status === 'authenticated') {
    void queryClient.refetchQueries({ type: 'active', predicate: (query) => query.state.status === 'error' });
    void queryClient.resumePausedMutations();
  }
});
