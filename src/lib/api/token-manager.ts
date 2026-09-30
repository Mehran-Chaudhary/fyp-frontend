import { markReachable, markUnreachable } from '@/lib/connectivity';
import { API_BASE_URL } from '@/lib/env';
import { createEmitter } from '@/lib/events';
import { STORAGE_KEYS, storage } from '@/lib/storage';
import { ApiError, networkError, toApiError } from './errors';
import type { ApiSuccess, RefreshResponse } from './types';

/**
 * The token manager (spec §4, Appendix B).
 *
 * The access token lives in this module's memory only: never in React state,
 * storage, the URL or logs. The refresh token is an httpOnly cookie this code
 * cannot see.
 *
 * Refresh tokens rotate, and presenting a spent one makes the backend revoke every
 * session of the user. So there is exactly one refresh at a time:
 *   - within a tab, every caller awaits the same in-flight promise;
 *   - across tabs, the refresh runs under a Web Lock, and the tab that refreshed
 *     broadcasts the new token so waiting tabs reuse it instead of refreshing again.
 * Refreshes happen on demand only, never on a timer (the refresh bucket is small).
 */

const LOCK_NAME = 'agentvault:refresh';
const CHANNEL_NAME = 'agentvault:auth';
/** Refresh before a request when the token has less than this left (§4.3). */
const FRESH_MARGIN_MS = 30_000;
/** Only hand a token to another tab when it still has this long to live. */
const SHARE_MARGIN_MS = 60_000;
/** How long a booting tab waits for another tab to share its token (§4.5). */
const BOOT_ASK_TIMEOUT_MS = 150;
/** BF-3: a refresh in the same second as a password change is rejected. */
const PASSWORD_CHANGE_DELAY_MS = 1_100;
const REFRESH_TIMEOUT_MS = 35_000;

type Message =
  | { type: 'token'; accessToken: string; expiresAt: number }
  | { type: 'token-request' }
  | { type: 'expire'; notBefore: number }
  | { type: 'signed-out'; reason?: string };

/** unknown: booting. active: a session exists. ended: signed out in this tab. */
type Phase = 'unknown' | 'active' | 'ended';

export const authEvents = createEmitter<{
  /** The session is over (reason: an error code or a sign-out reason slug). */
  'session-ended': { reason: string | undefined };
  /** Another tab shared a token while this tab had no session (it signed in there). */
  'session-adopted': undefined;
  /** POST /auth/refresh answered 429. The session is kept (§4.4). */
  'refresh-throttled': { error: ApiError };
}>();

let accessToken: string | null = null;
let expiresAt = 0;
let generation = 0;
let notBefore = 0;
let inFlight: Promise<string | null> | null = null;
let phase: Phase = 'unknown';

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
      const adopted = phase !== 'active';
      accessToken = message.accessToken;
      expiresAt = message.expiresAt;
      generation += 1;
      phase = 'active';
      if (adopted) authEvents.emit('session-adopted', undefined);
      break;
    }
    case 'expire':
      expiresAt = 0;
      notBefore = message.notBefore;
      break;
    case 'signed-out':
      endSession(message.reason, false);
      break;
    case 'token-request':
      if (phase === 'active' && isFresh(SHARE_MARGIN_MS) && accessToken) {
        post({ type: 'token', accessToken, expiresAt });
      }
      break;
  }
});

/** Whether this tab currently holds a session. */
export function hasActiveSession(): boolean {
  return phase === 'active';
}

/** The token currently in memory, without refreshing. Used to detect a refresh race. */
export function peekAccessToken(): string | null {
  return isFresh() ? accessToken : null;
}

export function installToken(token: string, expiresInSeconds: number, broadcast = true): void {
  accessToken = token;
  expiresAt = Date.now() + expiresInSeconds * 1000;
  generation += 1;
  phase = 'active';
  if (broadcast) post({ type: 'token', accessToken: token, expiresAt });
}

/** Call after any successful sign-in (register, login, mfa/verify). */
export function startSession(tokens: { accessToken: string; expiresIn: number }): void {
  storage.set(STORAGE_KEYS.hasSession, '1');
  installToken(tokens.accessToken, tokens.expiresIn);
}

/**
 * Forget the session locally and tell every other tab. Idempotent: the first
 * reason wins, so a burst of failing requests cannot overwrite a more specific
 * reason such as AUTH_REFRESH_TOKEN_REUSED.
 */
export function endSession(reason?: string, broadcast = true): void {
  const alreadyEnded = phase === 'ended';
  accessToken = null;
  expiresAt = 0;
  notBefore = 0;
  generation += 1;
  phase = 'ended';
  storage.remove(STORAGE_KEYS.hasSession);
  if (alreadyEnded) return;
  if (broadcast) post({ type: 'signed-out', reason });
  authEvents.emit('session-ended', { reason });
}

/**
 * Call right after a successful change-password (§4.7, BF-3). The token in memory
 * is already dead; the next refresh, in every tab, must wait until the next second.
 * Requests made meanwhile simply queue behind that refresh.
 */
export function expireTokenAndDelayRefresh(delayMs = PASSWORD_CHANGE_DELAY_MS, broadcast = true): void {
  expiresAt = 0;
  notBefore = Date.now() + delayMs;
  if (broadcast) post({ type: 'expire', notBefore });
}

function withCrossTabLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? locks.request(LOCK_NAME, fn) : fn();
}

/**
 * The only function that calls POST /auth/refresh.
 *
 * Resolves with the new token, or null when the session is over (the
 * `session-ended` event has fired by then). Rejects with an ApiError for transient
 * trouble (429, 5xx, network), in which case the session is kept.
 */
export function refreshAccessToken(): Promise<string | null> {
  if (inFlight) return inFlight;
  const seen = generation;

  inFlight = withCrossTabLock(async () => {
    // Something changed while this tab waited for the lock.
    if (generation !== seen) {
      if (isFresh()) return accessToken; // another tab refreshed and shared its token
      if (phase === 'ended') return null; // another tab signed out
    }

    // BF-3: never refresh in the same second as a password change.
    const wait = notBefore - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

    let res: Response;
    try {
      res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });
    } catch {
      markUnreachable();
      throw networkError();
    }

    if (res.ok) {
      markReachable();
      const body = (await res.json()) as ApiSuccess<RefreshResponse>;
      installToken(body.data.accessToken, body.data.expiresIn);
      return body.data.accessToken;
    }

    const { error, isEnvelope } = await toApiError(res);
    if (!isEnvelope && res.status >= 500) {
      markUnreachable();
      throw error;
    }
    markReachable();
    if (res.status === 429) {
      authEvents.emit('refresh-throttled', { error });
      throw error; // throttled: never a sign-out
    }
    if (res.status >= 500 || res.status === 408) throw error;

    endSession(error.code); // §4.4
    return null;
  }).finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** A token valid for at least 30 more seconds, or null when there is no session. */
export async function getAccessToken(): Promise<string | null> {
  // Never refresh without a session: after sign-out a stray query must not spend
  // the rate-limited refresh bucket.
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
 * App boot (§4.5). Resolves true when a session exists. Rejects with an ApiError
 * when the backend is unreachable or throttling, so the caller can retry.
 */
export async function restoreSession(): Promise<boolean> {
  if (phase === 'active' && isFresh()) return true;

  // No hint of a session in this browser: do not spend a rate-limited refresh on a
  // visitor who never signed in. If storage is unreadable, try anyway.
  const hinted = storage.get(STORAGE_KEYS.hasSession) === '1' || storage.unavailable();
  if (!hinted) return false;

  await askOtherTabs();
  if (isFresh()) return true;

  return (await refreshAccessToken()) !== null;
}

/** Test-only: reset module state between cases. */
export function __resetTokenManagerForTests(): void {
  accessToken = null;
  expiresAt = 0;
  generation = 0;
  notBefore = 0;
  inFlight = null;
  phase = 'unknown';
}
