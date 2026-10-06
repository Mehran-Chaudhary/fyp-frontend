import { describe, expect, it } from 'vitest';
import type { VaultDocument } from '../api/types';
import { canReindexNow, displayStatus, failedStage, failureHint, pipelineStates, retryCanHelp, statusGroupOf } from './status';

const base = { statusMessage: null, failureCode: null, isSearchable: false, activeIndexVersion: null };

describe('displayStatus (spec §4.1)', () => {
  it('uses the suggested labels', () => {
    expect(displayStatus({ ...base, status: 'UPLOADED' }).label).toBe('Queued');
    expect(displayStatus({ ...base, status: 'PARSING' })).toMatchObject({ label: 'Processing', stage: 'Reading text', tone: 'progress' });
    expect(displayStatus({ ...base, status: 'CHUNKING' }).stage).toBe('Saving chunks');
    expect(displayStatus({ ...base, status: 'EMBEDDING' }).stage).toBe('Indexing');
    expect(displayStatus({ ...base, status: 'READY', isSearchable: true, activeIndexVersion: 1 })).toMatchObject({ label: 'Ready', tone: 'success' });
    expect(displayStatus({ ...base, status: 'FAILED' })).toMatchObject({ label: 'Failed', tone: 'danger' });
  });

  it('says a reindex keeps the previous version searchable (§4.2)', () => {
    const status = displayStatus({ ...base, status: 'EMBEDDING', activeIndexVersion: 1, isSearchable: true });
    expect(status).toMatchObject({ label: 'Processing', stage: 'Reindexing · indexing', previousVersionServing: true, reindexing: true });
    expect(displayStatus({ ...base, status: 'UPLOADED', activeIndexVersion: 1, isSearchable: true }).stage).toBe('Reindex queued');
  });

  it('shows a failed reindex as "Reindex failed", not a plain failure', () => {
    const status = displayStatus({
      ...base,
      status: 'FAILED',
      statusMessage: 'The AI service was unavailable.',
      failureCode: 'AI_SERVICE_UNAVAILABLE',
      activeIndexVersion: 1,
      isSearchable: true,
    });
    expect(status).toMatchObject({ label: 'Reindex failed', tone: 'warning', previousVersionServing: true, retryHelps: true });
    expect(status.detail).toBe('The AI service was unavailable.');
  });

  it('treats a message on an in-progress document as a retry warning (§4.3)', () => {
    const status = displayStatus({ ...base, status: 'PARSING', statusMessage: 'Attempt 1 of 5 failed (AI_SERVICE_UNAVAILABLE); retrying.' });
    expect(status).toMatchObject({ retrying: true, tone: 'warning', label: 'Processing' });
    expect(displayStatus({ ...base, status: 'FAILED', statusMessage: 'x' }).retrying).toBe(false);
  });

  it('a retried never-indexed document is not a reindex', () => {
    const status = displayStatus({ ...base, status: 'PARSING' });
    expect(status.stage).toBe('Reading text');
    expect(status.previousVersionServing).toBe(false);
  });

  it('groups statuses for filters and counts', () => {
    expect(statusGroupOf('UPLOADED')).toBe('queued');
    expect(statusGroupOf('CHUNKING')).toBe('processing');
    expect(statusGroupOf('READY')).toBe('ready');
    expect(statusGroupOf('FAILED')).toBe('failed');
  });

  it('accepts a reindex only from READY or FAILED', () => {
    expect(canReindexNow({ status: 'READY' })).toBe(true);
    expect(canReindexNow({ status: 'FAILED' })).toBe(true);
    expect(canReindexNow({ status: 'EMBEDDING' })).toBe(false);
    expect(canReindexNow({ status: 'UPLOADED' })).toBe(false);
  });
});

describe('failures (the code set is open)', () => {
  it('knows which failures a retry can fix', () => {
    expect(retryCanHelp('ENCRYPTED_DOCUMENT')).toBe(false);
    expect(retryCanHelp('DOCUMENT_EMPTY')).toBe(false);
    expect(retryCanHelp('CONTENT_INTEGRITY_FAILURE')).toBe(false);
    expect(retryCanHelp('AI_SERVICE_UNAVAILABLE')).toBe(true);
    expect(retryCanHelp('SOMETHING_NEW_FROM_THE_AI_SERVICE')).toBe(true);
    expect(retryCanHelp(null)).toBe(true);
  });

  it('gives hints and icons without switching exhaustively', () => {
    expect(failureHint('DOCUMENT_EMPTY')).toMatchObject({ retryHelps: false, kind: 'file' });
    expect(failureHint('DOCUMENT_EMPTY').hint).toMatch(/text-based/);
    expect(failureHint('VECTOR_STORE_UNAVAILABLE')).toMatchObject({ transient: true, kind: 'service' });
    expect(failureHint('INGESTION_TIMEOUT')).toMatchObject({ retryHelps: true, kind: 'time' });
    expect(failureHint('UNHEARD_OF')).toEqual({ hint: null, retryHelps: true, transient: false, kind: 'unknown' });
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
