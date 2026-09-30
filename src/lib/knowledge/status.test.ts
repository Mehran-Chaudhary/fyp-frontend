import { describe, expect, it } from 'vitest';
import type { VaultDocument } from '../api/types';
import { displayStatus, failedStage, failureHint, pipelineStates, pollInterval, retryCanHelp } from './status';

const base = { statusMessage: null, isSearchable: false, indexVersion: 1, activeIndexVersion: null };

describe('displayStatus', () => {
  it('maps statuses to the mockup badges', () => {
    expect(displayStatus({ ...base, status: 'UPLOADED' }).badge).toBe('PENDING');
    expect(displayStatus({ ...base, status: 'PARSING' }).badge).toBe('INDEXING');
    expect(displayStatus({ ...base, status: 'CHUNKING' }).badge).toBe('INDEXING');
    expect(displayStatus({ ...base, status: 'EMBEDDING' }).badge).toBe('INDEXING');
    expect(displayStatus({ ...base, status: 'READY', isSearchable: true, activeIndexVersion: 1 }).badge).toBe('INDEXED');
    expect(displayStatus({ ...base, status: 'FAILED' }).badge).toBe('FAILED');
  });

  it('says a reindex keeps the previous version searchable', () => {
    const status = displayStatus({ status: 'EMBEDDING', statusMessage: null, indexVersion: 2, activeIndexVersion: 1, isSearchable: true });
    expect(status.badge).toBe('INDEXING');
    expect(status.stage).toBe('Reindexing: embedding');
    expect(status.previousVersionServing).toBe(true);
  });

  it('says a failed reindex keeps the previous version searchable', () => {
    const status = displayStatus({ status: 'FAILED', statusMessage: 'The AI service was unavailable.', indexVersion: 2, activeIndexVersion: 1, isSearchable: true });
    expect(status.badge).toBe('FAILED');
    expect(status.previousVersionServing).toBe(true);
  });

  it('marks an in-progress document with a message as retrying', () => {
    const status = displayStatus({ ...base, status: 'PARSING', statusMessage: 'Attempt 1 of 3 failed (AI_SERVICE_UNAVAILABLE); retrying.' });
    expect(status.retrying).toBe(true);
    expect(displayStatus({ ...base, status: 'FAILED', statusMessage: 'x' }).retrying).toBe(false);
  });

  it('a first run is not a reindex', () => {
    expect(displayStatus({ ...base, status: 'PARSING' }).stage).toBe('Extracting text');
    expect(displayStatus({ ...base, status: 'PARSING' }).previousVersionServing).toBe(false);
  });
});

describe('retries', () => {
  it('knows which failures a retry can fix', () => {
    expect(retryCanHelp('ENCRYPTED_DOCUMENT')).toBe(false);
    expect(retryCanHelp('DOCUMENT_EMPTY')).toBe(false);
    expect(retryCanHelp('CONTENT_INTEGRITY_FAILURE')).toBe(false);
    expect(retryCanHelp('AI_SERVICE_UNAVAILABLE')).toBe(true);
    expect(retryCanHelp('SOMETHING_NEW_FROM_THE_AI_SERVICE')).toBe(true);
    expect(retryCanHelp(null)).toBe(true);
  });

  it('gives hints without switching exhaustively', () => {
    expect(failureHint('DOCUMENT_EMPTY').hint).toMatch(/text-based/);
    expect(failureHint('VECTOR_STORE_UNAVAILABLE').transient).toBe(true);
    expect(failureHint('UNHEARD_OF')).toEqual({ hint: null, retryHelps: true, transient: false });
  });
});

describe('pipeline stages', () => {
  const doc = (status: VaultDocument['status'], failureCode: string | null = null, processingMetrics = {}) => ({
    status,
    failureCode,
    processingMetrics,
  });

  it('shows progress up to the current stage', () => {
    expect(pipelineStates(doc('UPLOADED'))).toEqual({ extract: 'pending', chunk: 'pending', embed: 'pending', store: 'pending' });
    expect(pipelineStates(doc('PARSING'))).toEqual({ extract: 'active', chunk: 'pending', embed: 'pending', store: 'pending' });
    expect(pipelineStates(doc('EMBEDDING'))).toEqual({ extract: 'done', chunk: 'done', embed: 'active', store: 'pending' });
    expect(pipelineStates(doc('READY'))).toEqual({ extract: 'done', chunk: 'done', embed: 'done', store: 'done' });
  });

  it('marks the stage a failure happened in', () => {
    expect(pipelineStates(doc('FAILED', 'ENCRYPTED_DOCUMENT', { parseMs: 1505, attempts: 1 }))).toEqual({
      extract: 'failed',
      chunk: 'pending',
      embed: 'pending',
      store: 'pending',
    });
    expect(failedStage(doc('FAILED', 'VECTOR_STORE_UNAVAILABLE'))).toBe('store');
    expect(failedStage(doc('FAILED', 'TOO_MANY_CHUNKS'))).toBe('chunk');
  });

  it('infers the stage from the timings when the code does not say', () => {
    expect(failedStage(doc('FAILED', 'AI_SERVICE_UNAVAILABLE', {}))).toBe('extract');
    expect(failedStage(doc('FAILED', 'AI_SERVICE_UNAVAILABLE', { parseMs: 1, persistMs: 2 }))).toBe('embed');
    expect(failedStage(doc('FAILED', 'INGESTION_ERROR', { parseMs: 1 }))).toBe('chunk');
  });
});

describe('pollInterval', () => {
  const now = Date.parse('2026-09-30T12:00:00.000Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('does not poll when nothing is in progress', () => {
    expect(pollInterval([], now)).toBe(false);
    expect(pollInterval([{ status: 'READY', lastStatusAt: ago(1_000) }], now)).toBe(false);
  });

  it('polls faster while statuses are moving', () => {
    expect(pollInterval([{ status: 'PARSING', lastStatusAt: ago(5_000) }], now)).toBe(2_000);
    expect(pollInterval([{ status: 'EMBEDDING', lastStatusAt: ago(5 * 60_000) }], now)).toBe(5_000);
    expect(pollInterval([{ status: 'PARSING', lastStatusAt: ago(20 * 60_000) }], now)).toBe(15_000);
  });

  it('uses the most recent change among the moving documents', () => {
    expect(
      pollInterval(
        [
          { status: 'PARSING', lastStatusAt: ago(20 * 60_000) },
          { status: 'UPLOADED', lastStatusAt: ago(3_000) },
          { status: 'READY', lastStatusAt: ago(1_000) },
        ],
        now,
      ),
    ).toBe(2_000);
  });
});
