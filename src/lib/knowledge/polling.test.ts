import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors';
import {
  errorBackoffMs,
  isSlow,
  nextPollDelay,
  pollingExpired,
  pollSessionStart,
  processingPollInterval,
  resetPollSessions,
  restartPollSession,
} from './polling';

const minutes = (value: number) => value * 60_000;

describe('nextPollDelay (spec §9.3)', () => {
  it('slows down over time and stops after 30 minutes', () => {
    expect(nextPollDelay(0)).toBe(2_000);
    expect(nextPollDelay(minutes(1) - 1)).toBe(2_000);
    expect(nextPollDelay(minutes(1))).toBe(5_000);
    expect(nextPollDelay(minutes(5))).toBe(15_000);
    expect(nextPollDelay(minutes(30) - 1)).toBe(15_000);
    expect(nextPollDelay(minutes(30))).toBeNull();
  });
});

describe('processingPollInterval', () => {
  afterEach(() => resetPollSessions());
  const t0 = Date.parse('2026-10-06T10:00:00Z');

  it('polls only while something shown is in progress', () => {
    expect(processingPollInterval('list', [{ status: 'READY' }, { status: 'FAILED' }], null, t0)).toBe(false);
    expect(processingPollInterval('list', [], null, t0)).toBe(false);
    expect(processingPollInterval('list', undefined, null, t0)).toBe(false);
  });

  it('times the session from the first in-progress answer', () => {
    expect(processingPollInterval('list', [{ status: 'UPLOADED' }], null, t0)).toBe(2_000);
    expect(pollSessionStart('list')).toBe(t0);
    expect(processingPollInterval('list', [{ status: 'EMBEDDING' }], null, t0 + minutes(2))).toBe(5_000);
    expect(processingPollInterval('list', [{ status: 'EMBEDDING' }], null, t0 + minutes(10))).toBe(15_000);
    expect(processingPollInterval('list', [{ status: 'EMBEDDING' }], null, t0 + minutes(31))).toBe(false);
    expect(pollingExpired(pollSessionStart('list'), [{ status: 'EMBEDDING' }], t0 + minutes(31))).toBe(true);
  });

  it('ends the session when everything is terminal, and restarts on request', () => {
    processingPollInterval('detail', [{ status: 'PARSING' }], null, t0);
    processingPollInterval('detail', [{ status: 'READY' }], null, t0 + 5_000);
    expect(pollSessionStart('detail')).toBeUndefined();

    processingPollInterval('detail', [{ status: 'PARSING' }], null, t0);
    restartPollSession('detail');
    expect(processingPollInterval('detail', [{ status: 'PARSING' }], null, t0 + minutes(40))).toBe(2_000);
  });

  it('waits for Retry-After on 429 and backs off on outages', () => {
    const limited = new ApiError({ status: 429, code: 'RATE_LIMIT_EXCEEDED', message: 'x', retryAfterSeconds: 20 });
    expect(errorBackoffMs(limited)).toBe(20_000);
    expect(processingPollInterval('list', [{ status: 'PARSING' }], limited, t0)).toBe(20_000);
    expect(errorBackoffMs(new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'x', source: 'client' }))).toBe(30_000);
    expect(errorBackoffMs(new ApiError({ status: 404, code: 'DOCUMENT_NOT_FOUND', message: 'x' }))).toBe(0);
  });
});

describe('isSlow', () => {
  const now = Date.parse('2026-10-06T10:30:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('flags in-progress documents without a heartbeat for 10 minutes, never terminal ones', () => {
    expect(isSlow({ status: 'EMBEDDING', lastStatusAt: ago(minutes(11)) }, now)).toBe(true);
    expect(isSlow({ status: 'EMBEDDING', lastStatusAt: ago(minutes(9)) }, now)).toBe(false);
    expect(isSlow({ status: 'READY', lastStatusAt: ago(minutes(60)) }, now)).toBe(false);
  });
});
