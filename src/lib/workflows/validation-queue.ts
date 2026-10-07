/** Debounce editor snapshots while serializing reference checks. Stale answers never reach the UI. */
export function createValidationQueue<T, R>(options: {
  validate: (value: T, signal: AbortSignal) => Promise<R>;
  onResult: (value: T, result: R) => void;
  onError: (error: unknown) => void;
  onPending?: (pending: boolean) => void;
  delayMs?: number;
}) {
  const delay = options.delayMs ?? 600;
  let revision = 0;
  let queued: { value: T; revision: number; readyAt: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: AbortController | null = null;
  let closed = false;
  const schedule = (after: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), after);
  };
  const run = async () => {
    if (closed || active || !queued) return;
    const request = queued;
    queued = null;
    active = new AbortController();
    try {
      const result = await options.validate(request.value, active.signal);
      if (!closed && request.revision === revision) { options.onResult(request.value, result); options.onPending?.(false); }
    } catch (error) {
      if (!closed && request.revision === revision) { options.onError(error); options.onPending?.(false); }
    } finally {
      active = null;
      // Read through a function: submit() can replace queued while the request awaits.
      const next = nextRequest();
      if (!closed && next) schedule(Math.max(0, next.readyAt - Date.now()));
    }
  };
  const nextRequest = () => queued;
  return {
    submit(value: T) {
      if (closed) return;
      revision += 1;
      queued = { value, revision, readyAt: Date.now() + delay };
      options.onPending?.(true);
      schedule(delay);
    },
    close() {
      closed = true;
      revision += 1;
      queued = null;
      clearTimeout(timer);
      active?.abort();
    },
  };
}
