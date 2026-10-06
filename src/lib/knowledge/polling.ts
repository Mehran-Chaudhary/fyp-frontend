import { useSyncExternalStore } from 'react';
import { isApiError } from '../api/errors';
import { authEvents } from '../api/token-manager';
import type { VaultDocument } from '../api/types';
import { isInProgress } from './status';

/**
 * Bounded polling while documents process (Phase 3 spec §9.3). There are no push
 * events until Phase 5, so lists and details poll, but only while something
 * visible is in progress, more slowly as time passes, and never for ever:
 *
 *   first minute 2 s · up to 5 minutes 5 s · up to 30 minutes 15 s · then stop
 *
 * A "poll session" starts when a query first sees an in-progress document and ends
 * when everything it shows is terminal. Sessions are kept per query (its hash), so
 * a filter change starts a fresh one, and "refresh to check" restarts it.
 */

export const POLL_LIMIT_MS = 30 * 60_000;
/** In progress with no heartbeat for this long: "taking longer than usual", never "failed". */
export const SLOW_AFTER_MS = 10 * 60_000;
/** After a network failure or a 5xx, wait at least this long: never spin. */
const ERROR_BACKOFF_MS = 30_000;

/** Delay before the next poll, or null to stop automatic polling. */
export function nextPollDelay(elapsedMs: number): number | null {
  if (elapsedMs < 60_000) return 2_000;
  if (elapsedMs < 5 * 60_000) return 5_000;
  if (elapsedMs < POLL_LIMIT_MS) return 15_000;
  return null;
}

export const anyInProgress = (documents: readonly Pick<VaultDocument, 'status'>[] | undefined): boolean =>
  !!documents?.some((document) => isInProgress(document.status));

/** In progress, and `lastStatusAt` (which also beats during embedding) is older than 10 minutes. */
export function isSlow(document: Pick<VaultDocument, 'status' | 'lastStatusAt'>, now: number): boolean {
  if (!isInProgress(document.status)) return false;
  const last = Date.parse(document.lastStatusAt);
  return Number.isFinite(last) && now - last > SLOW_AFTER_MS;
}

/** The least the next poll must wait after this error: Retry-After on 429, a backoff on outages. */
export function errorBackoffMs(error: unknown): number {
  if (!isApiError(error)) return 0;
  if (error.code === 'RATE_LIMIT_EXCEEDED') return (error.retryAfterSeconds ?? 60) * 1000;
  if (error.status === 0 || error.status >= 500) return ERROR_BACKOFF_MS;
  return 0;
}

// ── Poll sessions: a tiny external store ────────────────────────────────────

const sessions = new Map<string, number>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * TanStack Query `refetchInterval` for a query of documents: false when nothing it
 * shows is in progress or the session ran past 30 minutes.
 */
export function processingPollInterval(
  key: string,
  documents: readonly Pick<VaultDocument, 'status'>[] | undefined,
  error: unknown = null,
  now = Date.now(),
): number | false {
  if (!anyInProgress(documents)) {
    if (sessions.delete(key)) emit();
    return false;
  }
  let started = sessions.get(key);
  if (started === undefined) {
    started = now;
    sessions.set(key, started);
    emit();
  }
  const delay = nextPollDelay(now - started);
  if (delay === null) return false;
  return Math.max(delay, errorBackoffMs(error));
}

/** When the query's poll session started (epoch ms), if one is running. */
export const pollSessionStart = (key: string): number | undefined => sessions.get(key);

/** "Refresh to check": the next fetch starts a fresh session at 2 s. */
export function restartPollSession(key: string): void {
  if (sessions.delete(key)) emit();
}

/** Forget every session (sign-out, tests). */
export function resetPollSessions(): void {
  if (sessions.size === 0) return;
  sessions.clear();
  emit();
}

// The next account starts with fresh sessions.
authEvents.on('session-ended', resetPollSessions);

/** The start of a query's poll session, kept in step with the store. */
export function usePollSessionStart(key: string): number | undefined {
  return useSyncExternalStore(
    subscribe,
    () => sessions.get(key),
    () => undefined,
  );
}

/** Automatic polling gave up while documents are still in progress (spec §9.3: "refresh to check"). */
export function pollingExpired(
  started: number | undefined,
  documents: readonly Pick<VaultDocument, 'status'>[] | undefined,
  now: number,
): boolean {
  return started !== undefined && anyInProgress(documents) && now - started >= POLL_LIMIT_MS;
}
