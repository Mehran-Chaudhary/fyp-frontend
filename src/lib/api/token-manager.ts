import { markReachable, markUnreachable } from '@/lib/connectivity';
import { API_BASE_URL } from '@/lib/env';
import { createEmitter } from '@/lib/events';
import { STORAGE_KEYS, storage } from '@/lib/storage';
import { withAuthLock } from './auth-lock';
import { ApiError, networkError, readJson, timeoutError, toApiError } from './errors';
import type { ApiSuccess, RefreshResponse } from './types';

/**
 * The session coordinator's credential half (Phase 1 spec §4).
 *
 * The access token lives in this module's memory only: never in React state,
 * storage, the URL or logs. The refresh token is an HttpOnly cookie scoped to
 * /api/v1/auth that this code cannot see.
 *
 * Refresh tokens rotate and the backend has no grace window: presenting a spent
 * one revokes every session of the user. So:
 *   - within a tab, every caller awaits the same in-flight refresh;
 *   - across tabs, refresh (and every other cookie-changing call) runs under the
 *     auth lock, and the tab that refreshed broadcasts the new access token, so a
 *     waiting tab uses it instead of rotating again;
 *   - a refresh that timed out may have rotated the cookie server-side, so it is
 *     never retried automatically: the user decides (spec §4 "ambiguous timeout").
 * Refreshes happen on demand, when a token is missing or about to expire.
 *
 * Two counters keep late answers from undoing newer state:
 *   - `generation` moves whenever the credential changes (new token, expiry, end);
 *   - `sessionEpoch` moves only when a session starts or ends, so a request queued
 *     behind a refresh can tell that it now belongs to a different session.
 * Across tabs, a sign-out carries its time; a token obtained by an operation that
 * started before a sign-out is ignored.
 */

const CHANNEL_NAME = 'agentvault:auth';
/** Refresh before a request when the token has less than this left. */
const FRESH_MARGIN_MS = 30_000;
/** Only hand a token to another tab when it still has this long to live. */
const SHARE_MARGIN_MS = 60_000;
/** How long a booting tab waits for another tab to share its token. */
const BOOT_ASK_TIMEOUT_MS = 150;
const REFRESH_TIMEOUT_MS = 35_000;

type Message =
  | { type: 'token'; accessToken: string; expiresAt: number; startedAt: number }
  | { type: 'token-request' }
  | { type: 'expire' }
  | { type: 'signed-out'; reason?: string; at: number };

/** unknown: booting. active: a session exists. ended: signed out in this tab. */
type Phase = 'unknown' | 'active' | 'ended';

export const authEvents = createEmitter<{
  /** A new credential was installed; workspace sockets refresh in place. */
  'token-changed': undefined;
  /** The session is over (reason: an error code or a sign-out reason slug). */
  'session-ended': { reason: string | undefined };
  /** Another tab shared a token while this tab had no session (it signed in there). */
  'session-adopted': undefined;
  /** POST /auth/refresh answered 429. The session is kept. */
  'refresh-throttled': { error: ApiError };
  /** A refresh got no answer in time; automatic refreshes are paused. */
  'refresh-uncertain': undefined;
}>();

let accessToken: string | null = null;
let expiresAt = 0;
let generation = 0;
let sessionEpoch = 0;
let endedAt = 0;
let inFlight: Promise<string | null> | null = null;
let phase: Phase = 'unknown';
/** Set after an ambiguous refresh timeout: no automatic refresh until cleared. */
let uncertain = false;

const channel: BroadcastChannel | null = (() => {
  try {
    return typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;
  } catch {
    return null;
  }
})();

function post(message: Message): void {
  try {
    channel?.postMessage(message);
  } catch {
    /* channel closed */
  }
}

function isFresh(marginMs = FRESH_MARGIN_MS): boolean {
  return accessToken !== null && expiresAt - Date.now() > marginMs;
}

channel?.addEventListener('message', (event: MessageEvent<Message>) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;

  switch (message.type) {
    case 'token': {
      // Obtained by something that started before this tab's last sign-out:
      // it must not resurrect the session.
      if (typeof message.startedAt !== 'number' || message.startedAt < endedAt) return;
      const adopted = phase !== 'active';
      accessToken = message.accessToken;
      expiresAt = message.expiresAt;
      generation += 1;
      uncertain = false;
      authEvents.emit('token-changed', undefined);
      if (adopted) {
        phase = 'active';
        sessionEpoch += 1;
        authEvents.emit('session-adopted', undefined);
      }
      break;
    }
    case 'expire':
      if (phase === 'active') {
        expiresAt = 0;
        generation += 1;
      }
      break;
    case 'signed-out':
      endSession(message.reason, false, message.at);
      break;
    case 'token-request':
      if (phase === 'active' && isFresh(SHARE_MARGIN_MS) && accessToken) {
        post({ type: 'token', accessToken, expiresAt, startedAt: Date.now() });
      }
      break;
  }
});

/** Whether this tab currently holds a session. */
export function hasActiveSession(): boolean {
  return phase === 'active';
}

/** Changes whenever a session starts or ends in this tab. */
export function currentSessionEpoch(): number {
  return sessionEpoch;
}

/** Changes whenever the credential in memory changes. */
export function currentGeneration(): number {
  return generation;
}

/** The token currently in memory, without refreshing. Used to detect a refresh race. */
export function peekAccessToken(): string | null {
  return isFresh() ? accessToken : null;
}

/** Whether automatic refreshes are paused after an ambiguous timeout. */
export function isRefreshUncertain(): boolean {
  return uncertain;
}

function install(token: string, expiresInSeconds: number, startedAt: number, broadcast: boolean): void {
  const wasActive = phase === 'active';
  accessToken = token;
  expiresAt = Date.now() + expiresInSeconds * 1000;
  generation += 1;
  uncertain = false;
  phase = 'active';
  if (!wasActive) sessionEpoch += 1;
  storage.set(STORAGE_KEYS.hasSession, '1');
  authEvents.emit('token-changed', undefined);
  if (broadcast) post({ type: 'token', accessToken: token, expiresAt, startedAt });
}

/** A replacement access token for the current session (MFA enable returns one). */
export function installToken(token: string, expiresInSeconds: number): void {
  install(token, expiresInSeconds, Date.now(), true);
}

/** Call after any successful sign-in (register, login, mfa/verify). */
export function startSession(tokens: { accessToken: string; expiresIn: number }): void {
  storage.remove(STORAGE_KEYS.signOutPending);
  install(tokens.accessToken, tokens.expiresIn, Date.now(), true);
}

/**
 * Forget the session locally and tell every other tab. Idempotent: the first
 * reason wins, so a burst of failing requests cannot overwrite a more specific
 * reason such as AUTH_REFRESH_TOKEN_REUSED.
 */
export function endSession(reason?: string, broadcast = true, at = Date.now()): void {
  const alreadyEnded = phase === 'ended';
  accessToken = null;
  expiresAt = 0;
  generation += 1;
  endedAt = Math.max(endedAt, at);
  uncertain = false;
  storage.remove(STORAGE_KEYS.hasSession);
  if (alreadyEnded) return;
  phase = 'ended';
  sessionEpoch += 1;
  if (broadcast) post({ type: 'signed-out', reason, at });
  authEvents.emit('session-ended', { reason });
}

/**
 * Call right after a successful change-password: the server cut off every access
 * token issued before it, including the one in memory. Every tab refreshes on its
 * next request (the refresh cookie's family was kept).
 */
export function credentialsChanged(): void {
  expiresAt = 0;
  generation += 1;
  post({ type: 'expire' });
}

async function postRefresh(): Promise<Response> {
  try {
    return await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'TimeoutError') throw timeoutError();
    markUnreachable();
    throw networkError();
  }
}

/**
 * The only function that calls POST /auth/refresh for the session.
 *
 * Resolves with the new token, or null when the session is over (the
 * `session-ended` event has fired by then). Rejects with an ApiError for
 * transient trouble (429, 5xx, network, an ambiguous timeout), keeping the session.
 */
export function refreshAccessToken(): Promise<string | null> {
  if (inFlight) return inFlight;
  if (uncertain) return Promise.reject(timeoutError('Your session needs to be confirmed.'));
  const seenGeneration = generation;
  const epoch = sessionEpoch;

  inFlight = withAuthLock(async () => {
    // Something changed while this tab waited for the lock.
    if (generation !== seenGeneration) {
      if (isFresh()) return accessToken; // another tab refreshed and shared its token
      if (phase === 'ended') return null; // another tab signed out
    }
    const startedAt = Date.now();

    let res: Response;
    try {
      res = await postRefresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'NETWORK_TIMEOUT') {
        // The server may have rotated the cookie without us seeing the new one.
        // Presenting the old one again would look like theft: stop and ask.
        uncertain = true;
        authEvents.emit('refresh-uncertain', undefined);
      }
      throw error;
    }

    if (res.ok) {
      markReachable();
      const body = (await readJson(res)) as ApiSuccess<RefreshResponse> | null;
      if (!body?.data?.accessToken) throw new ApiError({ status: res.status, code: 'UNEXPECTED_RESPONSE', message: 'The server sent an unexpected answer.', source: 'client' });
      // Signed out (here or in another tab) after this refresh started: the answer
      // belongs to a session that is over, so it must not resurrect it.
      if (sessionEpoch !== epoch && (phase === 'ended' || endedAt >= startedAt)) return phase === 'active' ? accessToken : null;
      install(body.data.accessToken, body.data.expiresIn, startedAt, true);
      return body.data.accessToken;
    }

    const { error, isEnvelope } = await toApiError(res);
    if (!isEnvelope) {
      if (res.status >= 500) markUnreachable();
      throw error;
    }
    markReachable();
    if (res.status === 429) {
      authEvents.emit('refresh-throttled', { error });
      throw error; // throttled: never a sign-out
    }
    if (res.status === 401 || res.status === 403) {
      endSession(error.code); // missing, expired, revoked, reused, or an unusable account
      return null;
    }
    throw error;
  }).finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** After an ambiguous timeout, the user chose to try again. */
export function retryUncertainRefresh(): Promise<string | null> {
  uncertain = false;
  return refreshAccessToken();
}

/** A token valid for at least 30 more seconds, or null when there is no session. */
export async function getAccessToken(): Promise<string | null> {
  // Never refresh without a session: after sign-out a stray query must not spend
  // the rate-limited refresh budget.
  if (phase !== 'active') return null;
  if (isFresh()) return accessToken;
  return refreshAccessToken();
}

function askOtherTabs(): Promise<void> {
  if (!channel) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      channel.removeEventListener('message', listener);
      resolve();
    };
    const listener = (event: MessageEvent<Message>) => {
      if (event.data?.type === 'token') done();
    };
    const timer = setTimeout(done, BOOT_ASK_TIMEOUT_MS);
    channel.addEventListener('message', listener);
    post({ type: 'token-request' });
  });
}

/**
 * App boot. Resolves true when a session exists. Rejects with an ApiError when the
 * backend is unreachable, throttling or slow, so the caller can offer recovery.
 *
 * A browser that never signed in here (or signed out) skips the refresh: there is
 * no cookie to restore, and the probe would only log a 401.
 */
export async function restoreSession(): Promise<boolean> {
  if (phase === 'active' && isFresh()) return true;
  const hinted = storage.get(STORAGE_KEYS.hasSession) === '1' || storage.unavailable();
  if (!hinted) return false;

  await askOtherTabs();
  if (isFresh()) return true;

  return (await refreshAccessToken()) !== null;
}

/**
 * Completes a sign-out the server never confirmed (spec §4 "Logout network
 * failure"). Uses the cookie to get a throwaway token and revokes that session,
 * without installing anything, so no tab is signed back in. Resolves true when
 * the server-side session is certainly over.
 */
export async function revokeCookieSession(): Promise<boolean> {
  return withAuthLock(async () => {
    const res = await postRefresh();
    if (!res.ok) {
      const { error, isEnvelope } = await toApiError(res);
      // No usable refresh cookie: there is no server session left to end.
      if (isEnvelope && (res.status === 401 || res.status === 403)) return true;
      throw error;
    }
    const body = (await readJson(res)) as ApiSuccess<RefreshResponse> | null;
    const token = body?.data?.accessToken;
    if (!token) return false;
    let logout: Response;
    try {
      logout = await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
        body: '{}',
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });
    } catch {
      throw networkError();
    }
    if (logout.ok || logout.status === 401) return true;
    throw (await toApiError(logout)).error;
  });
}

/** Test-only: reset module state between cases. */
export function __resetTokenManagerForTests(): void {
  accessToken = null;
  expiresAt = 0;
  generation = 0;
  sessionEpoch = 0;
  endedAt = 0;
  inFlight = null;
  phase = 'unknown';
  uncertain = false;
}
