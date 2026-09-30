import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import type { VaultDocument } from '../api/types';
import { UploadError, type UploadOptions, type UploadResult } from './upload';
import { createUploadQueue, summarizeUploads, type NewUpload } from './upload-queue';

interface Pending {
  options: UploadOptions;
  resolve: (result: UploadResult) => void;
  reject: (error: unknown) => void;
}

function setup() {
  const pending: Pending[] = [];
  const onUploaded = vi.fn();
  const onRefetch = vi.fn();
  const onLayerMissing = vi.fn();
  let counter = 0;
  const queue = createUploadQueue({
    upload: (options) =>
      new Promise<UploadResult>((resolve, reject) => {
        pending.push({ options, resolve, reject });
        options.signal?.addEventListener('abort', () => reject(new DOMException('Upload cancelled', 'AbortError')));
      }),
    onUploaded,
    onRefetch,
    onLayerMissing,
    newId: () => `id-${(counter += 1)}`,
  });
  return { queue, pending, onUploaded, onRefetch, onLayerMissing };
}

const file = (name: string) => new File(['x'], name, { type: 'text/plain' });
const upload = (name: string, knowledgeBaseId = 'kb-1'): NewUpload => ({
  knowledgeBaseId,
  knowledgeBaseName: 'Handbook',
  file: file(name),
  fields: { classification: 'INTERNAL' },
});
const accepted = (remaining: number | null = 50, resetAt: number | null = null): UploadResult => ({
  document: { id: 'doc', status: 'UPLOADED' } as VaultDocument,
  remaining,
  resetAt,
});

describe('upload queue', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('sends at most three files at a time', async () => {
    const { queue, pending } = setup();
    queue.enqueue('ws', ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt'].map((name) => upload(name)));
    expect(pending).toHaveLength(3);

    pending[0].resolve(accepted());
    await vi.advanceTimersByTimeAsync(0);
    expect(pending).toHaveLength(4);
    expect(summarizeUploads(queue.store.getState().items)).toMatchObject({ done: 1, uploading: 3, queued: 1 });
  });

  it('holds the rest when the hourly budget is spent, then resumes', async () => {
    const { queue, pending } = setup();
    queue.enqueue('ws', ['a.txt', 'b.txt', 'c.txt', 'd.txt'].map((name) => upload(name)));
    const resetAt = Date.now() + 30_000;
    pending[0].resolve(accepted(0, resetAt));
    await vi.advanceTimersByTimeAsync(0);

    expect(queue.store.getState().holds.ws?.until).toBe(resetAt);
    expect(pending).toHaveLength(3); // d.txt waits
    await vi.advanceTimersByTimeAsync(30_000);
    expect(pending).toHaveLength(4);
  });

  it('requeues a rate-limited file after Retry-After', async () => {
    const { queue, pending } = setup();
    queue.enqueue('ws', [upload('a.txt')]);
    const limited = new ApiError({ status: 429, code: 'RATE_LIMIT_EXCEEDED', message: 'Slow down', retryAfterSeconds: 10 });
    pending[0].reject(new UploadError(limited, { remaining: 0, resetAt: null }));
    await vi.advanceTimersByTimeAsync(0);

    expect(queue.store.getState().items[0].status).toBe('queued');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pending).toHaveLength(2);
    expect(queue.store.getState().items[0].status).toBe('uploading');
  });

  it('stops the waiting files when an error would fail them too', async () => {
    const { queue, pending, onRefetch } = setup();
    queue.enqueue('ws', ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt'].map((name) => upload(name)));
    pending[0].reject(new ApiError({ status: 403, code: 'PERMISSION_DENIED', message: 'No' }));
    await vi.advanceTimersByTimeAsync(0);

    const statuses = queue.store.getState().items.map((item) => item.status);
    expect(statuses).toEqual(['failed', 'uploading', 'uploading', 'failed', 'failed']);
    expect(queue.store.getState().items[3].error?.message).toMatch(/^Not sent:/);
    expect(onRefetch).toHaveBeenCalledWith('ws', 'permissions');
  });

  it('cancels mid-transfer and retries on request', async () => {
    const { queue, pending, onLayerMissing } = setup();
    queue.enqueue('ws', [upload('a.txt'), upload('b.txt')]);
    const [first] = queue.store.getState().items;
    queue.cancel(first.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.store.getState().items[0].status).toBe('cancelled');

    queue.retry(first.id);
    expect(queue.store.getState().items[0].status).toBe('uploading');

    pending[2].reject(
      new ApiError({ status: 503, code: 'KNOWLEDGE_LAYER_NOT_CONFIGURED', message: 'x', details: { missingConfiguration: ['QDRANT_URL'] } }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(onLayerMissing).toHaveBeenCalledWith('ws', ['QDRANT_URL']);
  });

  it('announces a settled batch once', async () => {
    const { queue, pending } = setup();
    const { uploadEvents } = await import('./upload-queue');
    const settled = vi.fn();
    const off = uploadEvents.on('batch-settled', settled);
    const batchId = queue.enqueue('ws', [upload('a.txt'), upload('b.txt')]);
    pending[0].resolve(accepted());
    pending[1].reject(new ApiError({ status: 415, code: 'DOCUMENT_EMPTY', message: 'The file is empty.' }));
    await vi.advanceTimersByTimeAsync(0);
    off();

    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith({ batchId, workspaceId: 'ws', done: 1, failed: 1, cancelled: 0 });
  });
});
