import { useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react';

// ── A shared one-second clock ───────────────────────────────────────────────
// Countdowns (rate limits, lockouts, MFA challenge expiry) all read this one
// clock, which only ticks while something is subscribed.

const clockListeners = new Set<() => void>();
let clockNow = Date.now();
let clockTimer: number | null = null;

function subscribeClock(listener: () => void): () => void {
  clockListeners.add(listener);
  clockNow = Date.now();
  if (clockTimer === null) {
    clockTimer = window.setInterval(() => {
      clockNow = Date.now();
      for (const notify of clockListeners) notify();
    }, 1_000);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer !== null) {
      window.clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

const getClock = () => clockNow;

/** The current time, updated every second while mounted. */
export function useNow(): number {
  return useSyncExternalStore(subscribeClock, getClock, getClock);
}

/**
 * Seconds left until `target` (epoch ms). Calls `onDone` once when it reaches zero.
 * Returns 0 when there is no target.
 */
export function useCountdown(target: number | null | undefined, onDone?: () => void): number {
  const now = useNow();
  const remaining = target ? Math.max(0, Math.ceil((target - now) / 1000)) : 0;
  const finished = !!target && remaining === 0;
  const notify = useEffectEvent(() => onDone?.());

  useEffect(() => {
    if (finished) notify();
  }, [finished, target]);

  return remaining;
}

/** `value`, once it has stopped changing for `delayMs` (search boxes). */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Sets document.title for the lifetime of a page. */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} · AgentVault`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
