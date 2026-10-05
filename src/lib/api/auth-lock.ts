/**
 * One exclusive, same-origin lock for every request that reads or replaces the
 * refresh cookie: refresh, sign-in, registration, MFA sign-in and sign-out
 * (Phase 1 spec §4, "Cross-tab coordination is required").
 *
 * Refresh tokens rotate, and presenting a spent one makes the backend revoke every
 * session of the user, so two tabs must never send the same cookie at once.
 *
 *  - **Web Locks** (`navigator.locks`) wherever they exist: Chrome/Edge 69+,
 *    Firefox 96+, Safari 15.4+, in a secure context (HTTPS or localhost).
 *  - **Storage lease** otherwise (an old browser, or plain HTTP on a LAN address):
 *    claim a localStorage record, wait, and confirm the claim survived. The lease
 *    outlives the slowest request it guards and is renewed while held, so it
 *    cannot lapse under a live holder; a crashed holder blocks others for at most
 *    one lease.
 *  - **None** when storage is blocked too: one tab at a time is safe, several tabs
 *    are not. `lockMode()` reports which applies so the UI can say so.
 *
 * Calls never nest: code that needs a token inside the lock receives it first.
 */

const LOCK_NAME = 'agentvault:auth';
const LEASE_KEY = 'av.authLease';
/** Longer than the 35 s request timeout, so a live holder never loses the lease. */
const LEASE_MS = 45_000;
const RENEW_MS = 5_000;
/** Time for a competing claim to land before a claim is confirmed. */
const SETTLE_MS = 60;
const POLL_MS = 100;

export type LockMode = 'web-locks' | 'storage-lease' | 'none';

interface Lease {
  owner: string;
  until: number;
}

let held = false;

function webLocks(): LockManager | undefined {
  try {
    return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : undefined;
  } catch {
    return undefined;
  }
}

function storageWorks(): boolean {
  try {
    const probe = 'av.lockProbe';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** Which mechanism coordinates tabs in this browser. */
export function lockMode(): LockMode {
  if (webLocks()) return 'web-locks';
  return storageWorks() ? 'storage-lease' : 'none';
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

function readLease(): Lease | null {
  try {
    const raw = window.localStorage.getItem(LEASE_KEY);
    if (!raw) return null;
    const lease = JSON.parse(raw) as Partial<Lease>;
    return typeof lease.owner === 'string' && typeof lease.until === 'number' ? (lease as Lease) : null;
  } catch {
    return null;
  }
}

function writeLease(lease: Lease): void {
  try {
    window.localStorage.setItem(LEASE_KEY, JSON.stringify(lease));
  } catch {
    /* storage vanished mid-flight: the caller's confirm step fails safe */
  }
}

function releaseLease(owner: string): void {
  try {
    if (readLease()?.owner === owner) window.localStorage.removeItem(LEASE_KEY);
  } catch {
    /* nothing to release */
  }
}

async function withLease<T>(run: () => Promise<T>): Promise<T> {
  const owner = randomId();
  for (;;) {
    const current = readLease();
    if (!current || current.until <= Date.now()) {
      // Claim, give a competing claim time to land, then confirm. Read and write
      // happen in one synchronous step, so two claimants cannot both confirm.
      writeLease({ owner, until: Date.now() + LEASE_MS });
      await sleep(SETTLE_MS);
      if (readLease()?.owner === owner) break;
    }
    await sleep(POLL_MS);
  }

  const renew = setInterval(() => {
    if (readLease()?.owner === owner) writeLease({ owner, until: Date.now() + LEASE_MS });
  }, RENEW_MS);
  const onPageHide = () => releaseLease(owner);
  window.addEventListener('pagehide', onPageHide);
  try {
    return await run();
  } finally {
    clearInterval(renew);
    window.removeEventListener('pagehide', onPageHide);
    releaseLease(owner);
  }
}

/**
 * Runs `fn` while holding the auth lock, across every tab of this origin. Never
 * call it from inside `fn`: Web Locks are not reentrant, so a nested call would
 * wait forever. A nested call is detected and run directly instead.
 */
export async function withAuthLock<T>(fn: () => Promise<T>): Promise<T> {
  if (held) {
    if (import.meta.env.DEV) console.warn('[auth-lock] nested acquisition; running without waiting');
    return fn();
  }
  const run = async () => {
    held = true;
    try {
      return await fn();
    } finally {
      held = false;
    }
  };

  const locks = webLocks();
  if (locks) return locks.request(LOCK_NAME, { mode: 'exclusive' }, run);
  if (storageWorks()) return withLease(run);
  return run();
}

/** Test-only. */
export function __resetAuthLockForTests(): void {
  held = false;
}
