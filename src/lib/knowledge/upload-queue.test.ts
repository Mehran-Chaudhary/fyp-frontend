import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import type { VaultDocument } from '../api/types';
import type { UploadOptions, UploadResult } from './upload';
import { createUploadQueue, matchesUpload, summarizeUploads, type NewUpload } from './upload-queue';

interface Pending {
  options: UploadOptions;
  resolve: (result: UploadResult) => void;
  reject: (error: unknown) => void;
}

function setup(found: VaultDocument | null = null) {
  const pending: Pending[] = [];
  const onUploaded = vi.fn();
  const onRefetch = vi.fn();
  const onLayerMissing = vi.fn();
  const findUploaded = vi.fn(async () => found);
  let counter = 0;
  const queue = createUploadQueue({
    upload: (options) =>
      new Promise<UploadResult>((resolve, reject) => {
        pending.push({ options, resolve, reject });
        options.signal?.addEventListener('abort', () => reject(new DOMException('Upload cancelled', 'AbortError')));
      }),
    findUploaded,
    onUploaded,
    onRefetch,
    onLayerMissing,
    newId: () => `id-${(counter += 1)}`,
  });
  return { queue, pending, onUploaded, onRefetch, onLayerMissing, findUploaded };
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

  it('sends at most two files at a time (spec §5 "Upload")', async () => {
    const { queue, pending } = setup();
    queue.enqueue('ws', ['a.txt', 'b.txt', 'c.txt', 'd.txt'].map((name) => upload(name)));
    expect(pending).toHaveLength(2);

    pending[0].resolve(accepted());
    await vi.advanceTimersByTimeAsync(0);
    expect(pending).toHaveLength(3);
    expect(summarizeUploads(queue.store.getState().items)).toMatchObject({ done: 1, uploading: 2, queued: 1 });
  });

  it('always sends the classification it was given', () => {
    const { queue, pending } = setup();
    queue.enqueue('ws', [upload('a.txt')]);
    expect(pending[0].options.fields.classification).toBe('INTERNAL');
  });

  it('holds the rest when the hourly budget is spent, then resumes', async () => {
    const { queue, pending } = setup();
    queue.enqueue('ws', ['a.txt', 'b.txt', 'c.txt'].map((name) => upload(name)));
    const resetAt = Date.now() + 30_000;
    pending[0].resolve(accepted(0, resetAt));
    await vi.advanceTimersByTimeAsync(0);

    expect(queue.store.getState().holds.ws?.until).toBe(resetAt);
    expect(pending).toHaveLength(2); // c.txt waits
    await vi.advanceTimersByTimeAsync(30_000);
    expect(pending).toHaveLength(3);
  });

  it('requeues a rate-limited file after Retry-After', async () => {
    const { queue, pending } = setup();
    queue.enqueue('ws', [upload('a.txt')]);
    pending[0].reject(
      new ApiError({ status: 429, code: 'RATE_LIMIT_EXCEEDED', message: 'Slow down', retryAfterSeconds: 10, rateLimit: { remaining: 0 } }),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(queue.store.getState().items[0].status).toBe('queued');
    expect(queue.store.getState().remaining.ws).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pending).toHaveLength(2);
    expect(queue.store.getState().items[0].status).toBe('uploading');
  });

  it('stops the waiting files when an error would fail them too', async () => {
    const { queue, pending, onRefetch } = setup();
    queue.enqueue('ws', ['a.txt', 'b.txt', 'c.txt', 'd.txt'].map((name) => upload(name)));
    pending[0].reject(new ApiError({ status: 403, code: 'PERMISSION_DENIED', message: 'No' }));
    await vi.advanceTimersByTimeAsync(0);

    const statuses = queue.store.getState().items.map((item) => item.status);
    expect(statuses).toEqual(['failed', 'uploading', 'failed', 'failed']);
    expect(queue.store.getState().items[2].error?.message).toMatch(/^Not sent:/);
    expect(onRefetch).toHaveBeenCalledWith('ws', 'permissions');
  });

  it('never resends an upload whose answer was lost; checks the vault first', async () => {
    const stored = { id: 'found', status: 'UPLOADED' } as VaultDocument;
    const { queue, pending, findUploaded, onUploaded } = setup(stored);
    queue.enqueue('ws', [upload('a.txt')]);
    pending[0].reject(new ApiError({ status: 0, code: 'NETWORK_TIMEOUT', message: 'Timed out', source: 'client' }));
    await vi.advanceTimersByTimeAsync(0);

    const [item] = queue.store.getState().items;
    expect(item.status).toBe('unknown');
    queue.retry(item.id); // refused: it must be checked first
    expect(queue.store.getState().items[0].status).toBe('unknown');
    expect(pending).toHaveLength(1);

    queue.check(item.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(findUploaded).toHaveBeenCalledTimes(1);
    expect(queue.store.getState().items[0]).toMatchObject({ status: 'done', foundByCheck: true, document: stored });
    expect(onUploaded).toHaveBeenCalledWith('ws', stored);
  });

  it('offers to send again only when the check finds nothing', async () => {
    const { queue, pending } = setup(null);
    queue.enqueue('ws', [upload('a.txt')]);
    pending[0].reject(new ApiError({ status: 502, code: 'NETWORK_ERROR', message: 'Bad gateway', source: 'client' }));
    await vi.advanceTimersByTimeAsync(0);
    const [item] = queue.store.getState().items;
    queue.check(item.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.store.getState().items[0]).toMatchObject({ status: 'failed', error: { retryable: true } });
    queue.retry(item.id);
    expect(pending).toHaveLength(2);
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
    expect(settled).toHaveBeenCalledWith({ batchId, workspaceId: 'ws', done: 1, failed: 1, cancelled: 0, unknown: 0 });
  });
});

describe('matchesUpload', () => {
  const document = {
    knowledgeBaseId: 'kb-1',
    sizeBytes: '1486',
    originalFilename: 'quarterly _draft_.txt',
    title: 'quarterly _draft_',
    createdAt: '2026-10-06T10:00:30.000Z',
  };
  const sent = Date.parse('2026-10-06T10:00:00.000Z');
  const upload = { knowledgeBaseId: 'kb-1', size: 1486, filename: 'quarterly _draft_.txt', title: 'quarterly _draft_', sentAt: sent };

  it('matches on base, size, stored name and time', () => {
    expect(matchesUpload(document, upload)).toBe(true);
  });

  it('rejects another base, another size, or an older document', () => {
    expect(matchesUpload(document, { ...upload, knowledgeBaseId: 'kb-2' })).toBe(false);
    expect(matchesUpload(document, { ...upload, size: 1487 })).toBe(false);
    expect(matchesUpload({ ...document, createdAt: '2026-10-06T09:50:00.000Z' }, upload)).toBe(false);
  });

  it('accepts a matching title when the stored name differs', () => {
    expect(matchesUpload({ ...document, originalFilename: 'other.txt' }, upload)).toBe(true);
    expect(matchesUpload({ ...document, originalFilename: 'other.txt', title: 'Other' }, upload)).toBe(false);
  });
});
