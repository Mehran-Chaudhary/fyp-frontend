import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Lock = typeof import('./auth-lock');

/** Two "tabs": separate module instances sharing one localStorage, as real tabs do. */
async function twoTabs(): Promise<[Lock, Lock]> {
  vi.resetModules();
  const a = await import('./auth-lock');
  vi.resetModules();
  const b = await import('./auth-lock');
  return [a, b];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('auth lock (spec §4 cross-tab coordination)', () => {
  beforeEach(() => {
    localStorage.clear();
    // jsdom has no Web Locks: this exercises the storage-lease fallback.
    vi.stubGlobal('navigator', { ...navigator, locks: undefined });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('falls back to a storage lease when Web Locks are missing', async () => {
    const [tab] = await twoTabs();
    expect(tab.lockMode()).toBe('storage-lease');
  });

  it('never lets two tabs hold the lock at once', async () => {
    const [tabA, tabB] = await twoTabs();
    const log: string[] = [];
    const work = (name: string) => async () => {
      log.push(`${name}:in`);
      await sleep(40);
      log.push(`${name}:out`);
      return name;
    };

    const results = await Promise.all([tabA.withAuthLock(work('A')), tabB.withAuthLock(work('B'))]);
    expect(results.sort()).toEqual(['A', 'B']);
    // Whoever enters first leaves before the other enters.
    const first = log[0].split(':')[0];
    const second = first === 'A' ? 'B' : 'A';
    expect(log).toEqual([`${first}:in`, `${first}:out`, `${second}:in`, `${second}:out`]);
    expect(localStorage.getItem('av.authLease')).toBeNull();
  });

  it('releases the lease when the work fails', async () => {
    const [tab] = await twoTabs();
    await expect(
      tab.withAuthLock(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(localStorage.getItem('av.authLease')).toBeNull();
    expect(await tab.withAuthLock(async () => 'next')).toBe('next');
  });

  it('takes over a lease whose holder died (it expired)', async () => {
    localStorage.setItem('av.authLease', JSON.stringify({ owner: 'crashed-tab', until: Date.now() - 1 }));
    const [tab] = await twoTabs();
    expect(await tab.withAuthLock(async () => 'mine')).toBe('mine');
  });

  it('uses Web Locks when the browser has them', async () => {
    const request = vi.fn((_name: string, _options: unknown, run: () => Promise<unknown>) => run());
    vi.stubGlobal('navigator', { ...navigator, locks: { request } });
    const [tab] = await twoTabs();
    expect(tab.lockMode()).toBe('web-locks');
    expect(await tab.withAuthLock(async () => 'ok')).toBe('ok');
    expect(request).toHaveBeenCalledWith('agentvault:auth', { mode: 'exclusive' }, expect.any(Function));
  });
});
