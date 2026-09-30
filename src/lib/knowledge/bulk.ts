/**
 * Bulk actions (Phase 3 spec §6.1): there are no bulk endpoints, so the single calls
 * run one at a time, at most four per second, well under the 120-per-minute budget.
 * Failures are collected and reported at the end; an error that will fail every
 * remaining call too (a rate limit, a missing service) stops the run early.
 */

export interface BulkFailure<T> {
  item: T;
  error: unknown;
}

export interface BulkOutcome<T> {
  succeeded: T[];
  failed: BulkFailure<T>[];
  /** Items never attempted because the run stopped early. */
  skipped: T[];
  /** Why the run stopped early, if it did. */
  stoppedBy: unknown;
}

export interface BulkOptions {
  /** Minimum time between the starts of two calls. Default 250 ms (4 per second). */
  minIntervalMs?: number;
  onProgress?: (done: number, total: number) => void;
  /** Return true to stop the run after this failure. */
  stopOn?: (error: unknown) => boolean;
  signal?: AbortSignal;
}

export async function runSequentially<T>(
  items: readonly T[],
  task: (item: T) => Promise<unknown>,
  options: BulkOptions = {},
): Promise<BulkOutcome<T>> {
  const { minIntervalMs = 250, onProgress, stopOn, signal } = options;
  const outcome: BulkOutcome<T> = { succeeded: [], failed: [], skipped: [], stoppedBy: undefined };
  let lastStart = 0;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (signal?.aborted) {
      outcome.skipped.push(...items.slice(index));
      break;
    }
    const wait = lastStart + minIntervalMs - Date.now();
    if (index > 0 && wait > 0) await delay(wait);
    lastStart = Date.now();
    try {
      await task(item);
      outcome.succeeded.push(item);
    } catch (error) {
      outcome.failed.push({ item, error });
      if (stopOn?.(error)) {
        outcome.stoppedBy = error;
        outcome.skipped.push(...items.slice(index + 1));
        onProgress?.(index + 1, items.length);
        break;
      }
    }
    onProgress?.(index + 1, items.length);
  }
  return outcome;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
