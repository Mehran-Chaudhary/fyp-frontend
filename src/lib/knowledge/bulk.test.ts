import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSequentially } from './bulk';

describe('runSequentially', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs one call at a time, at most four per second', async () => {
    const starts: number[] = [];
    let running = 0;
    let maxRunning = 0;
    const task = async () => {
      starts.push(Date.now());
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await Promise.resolve();
      running -= 1;
    };
    const run = runSequentially([1, 2, 3, 4, 5], task);
    await vi.runAllTimersAsync();
    const outcome = await run;

    expect(outcome.succeeded).toEqual([1, 2, 3, 4, 5]);
    expect(maxRunning).toBe(1);
    for (let index = 1; index < starts.length; index += 1) {
      expect(starts[index] - starts[index - 1]).toBeGreaterThanOrEqual(250);
    }
  });

  it('collects failures and reports progress', async () => {
    const progress: string[] = [];
    const run = runSequentially(
      ['a', 'b', 'c'],
      async (item) => {
        if (item === 'b') throw new Error('nope');
      },
      { onProgress: (done, total) => progress.push(`${done}/${total}`) },
    );
    await vi.runAllTimersAsync();
    const outcome = await run;

    expect(outcome.succeeded).toEqual(['a', 'c']);
    expect(outcome.failed.map((failure) => failure.item)).toEqual(['b']);
    expect(progress).toEqual(['1/3', '2/3', '3/3']);
  });

  it('stops early on an error every other call would hit too', async () => {
    const run = runSequentially(
      [1, 2, 3, 4],
      async (item) => {
        if (item === 2) throw new Error('rate limited');
      },
      { stopOn: (error) => error instanceof Error && error.message === 'rate limited' },
    );
    await vi.runAllTimersAsync();
    const outcome = await run;

    expect(outcome.succeeded).toEqual([1]);
    expect(outcome.failed.map((failure) => failure.item)).toEqual([2]);
    expect(outcome.skipped).toEqual([3, 4]);
    expect(outcome.stoppedBy).toBeInstanceOf(Error);
  });
});
