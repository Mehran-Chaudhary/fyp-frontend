import { create } from 'zustand';
import { HEALTH_URL } from './env';
import { createEmitter } from './events';

/**
 * Tracks whether the backend is reachable (spec §7.15). A network failure or a
 * gateway 5xx flips the app into "unreachable": a banner appears, the session is
 * kept, and a light heartbeat against GET /health/live (E29) decides when things
 * are back. Recovery emits `restored` so the app can refetch what failed.
 */
interface ConnectivityState {
  status: 'online' | 'unreachable';
  since: number | null;
  nextCheckAt: number | null;
}

export const useConnectivity = create<ConnectivityState>(() => ({
  status: 'online',
  since: null,
  nextCheckAt: null,
}));

export const connectivityEvents = createEmitter<{ restored: void }>();

const BACKOFF_MS = [2_000, 4_000, 8_000, 15_000, 30_000];
let attempt = 0;
let timer: number | null = null;

function schedule() {
  if (timer !== null) window.clearTimeout(timer);
  const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  useConnectivity.setState({ nextCheckAt: Date.now() + delay });
  timer = window.setTimeout(() => void probe(), delay);
}

async function probe(): Promise<void> {
  timer = null;
  try {
    const res = await fetch(HEALTH_URL, { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
    if (res.ok) {
      markReachable();
      return;
    }
  } catch {
    /* still down */
  }
  attempt += 1;
  if (useConnectivity.getState().status === 'unreachable') schedule();
}

export function markUnreachable(): void {
  if (useConnectivity.getState().status === 'unreachable') return;
  attempt = 0;
  useConnectivity.setState({ status: 'unreachable', since: Date.now() });
  schedule();
}

export function markReachable(): void {
  if (useConnectivity.getState().status === 'online') return;
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  attempt = 0;
  useConnectivity.setState({ status: 'online', since: null, nextCheckAt: null });
  connectivityEvents.emit('restored', undefined);
}

/** "Retry now" from the banner. */
export function checkConnectivityNow(): void {
  if (useConnectivity.getState().status !== 'unreachable') return;
  if (timer !== null) window.clearTimeout(timer);
  void probe();
}

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => markUnreachable());
  window.addEventListener('online', () => checkConnectivityNow());
}
