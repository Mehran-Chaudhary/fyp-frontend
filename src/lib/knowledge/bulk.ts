/**
 * Bulk actions (Phase 3 spec §4.5, §5): there are no bulk endpoints (P3-G08), so
 * the single calls run one at a time, at most four per second, well under the
 * 120-per-minute budget. A rate limit pauses the run for the server's Retry-After
 * and tries the same item again; an error that would fail every remaining call too
 * (a missing service, a lost permission) stops the run early. Each item's outcome
 * is reported as it happens, and all of them at the end.
 */

export interface BulkFailure<T> {
  item: T;
  error: unknown;
}

export interface BulkOutcome<T> {
  succeeded: T[];
  failed: BulkFailure<T>[];
  /** Items never attempted because the run stopped early or was cancelled. */
  skipped: T[];
  /** Why the run stopped early, if it did. */
  stoppedBy: unknown;
}

export type ItemOutcome = { ok: true; value: unknown } | { ok: false; error: unknown };

export interface BulkOptions<T> {
  /** Minimum time between the starts of two calls. Default 250 ms (4 per second). */
  minIntervalMs?: number;
  onProgress?: (done: number, total: number) => void;
  /** Called once per item with its final outcome. */
  onItem?: (item: T, outcome: ItemOutcome) => void;
  /** Return true to stop the run after this failure. */
  stopOn?: (error: unknown) => boolean;
  /**
   * Return how long to wait before trying the same item again (a 429's Retry-After),
   * or null for an ordinary failure. Each item waits at most `maxWaits` times.
   */
  waitFor?: (error: unknown) => number | null;
  maxWaits?: number;
  /** Told when the run pauses, with the epoch ms it resumes at (null when it resumes). */
  onWait?: (until: number | null) => void;
  signal?: AbortSignal;
}

export async function runSequentially<T>(
  items: readonly T[],
  task: (item: T) => Promise<unknown>,
  options: BulkOptions<T> = {},
): Promise<BulkOutcome<T>> {
  const { minIntervalMs = 250, onProgress, onItem, stopOn, waitFor, maxWaits = 3, onWait, signal } = options;
  const outcome: BulkOutcome<T> = { succeeded: [], failed: [], skipped: [], stoppedBy: undefined };
  let lastStart = 0;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    let waits = 0;
    let settled = false;
    while (!settled) {
      if (signal?.aborted) {
        outcome.skipped.push(...items.slice(index));
        return outcome;
      }
      const gap = lastStart + minIntervalMs - Date.now();
      if (lastStart > 0 && gap > 0) await delay(gap, signal);
      lastStart = Date.now();
      try {
        const value = await task(item);
        outcome.succeeded.push(item);
        onItem?.(item, { ok: true, value });
        settled = true;
      } catch (error) {
        const wait = waitFor?.(error) ?? null;
        if (wait !== null && waits < maxWaits) {
          waits += 1;
          onWait?.(Date.now() + wait);
          await delay(wait, signal);
          onWait?.(null);
          continue;
        }
        outcome.failed.push({ item, error });
        onItem?.(item, { ok: false, error });
        settled = true;
        if (stopOn?.(error)) {
          outcome.stoppedBy = error;
          outcome.skipped.push(...items.slice(index + 1));
          onProgress?.(index + 1, items.length);
          return outcome;
        }
      }
    }
    onProgress?.(index + 1, items.length);
  }
  return outcome;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}
