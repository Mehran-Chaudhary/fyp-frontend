import { afterEach, describe, expect, it, vi } from 'vitest';
import { healthApi, summarizeReport } from './health';

describe('health diagnostics (P1-API-27–29)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('summarises components by name and state only', () => {
    expect(
      summarizeReport({
        status: 'error',
        details: {
          redis: { status: 'up' },
          database: { status: 'down', message: 'connect ECONNREFUSED 10.0.0.5:5432' },
          vector_store: { status: 'degraded', reason: 'x' },
        },
      }),
    ).toEqual([
      { name: 'database', status: 'down' },
      { name: 'redis', status: 'up' },
      { name: 'vector_store', status: 'degraded' },
    ]);
  });

  it('handles reports without details', () => {
    expect(summarizeReport(null)).toEqual([]);
    expect(summarizeReport({ status: 'ok', info: { database: { status: 'up' } }, details: undefined as never })).toEqual([
      { name: 'database', status: 'up' },
    ]);
  });

  it('reads the enveloped liveness answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ success: true, data: { status: 'ok', uptime: 42, environment: 'development', timestamp: 'now' }, meta: { requestId: 'r1' } }),
      ),
    );
    const outcome = await healthApi.live();
    expect(outcome).toMatchObject({ kind: 'ok', status: 200, requestId: 'r1', data: { uptime: 42 } });
  });

  it('reports a 503 readiness as failing, with whatever report came with it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable' }, meta: { requestId: 'r2' } },
          { status: 503 },
        ),
      ),
    );
    const outcome = await healthApi.ready();
    expect(outcome).toMatchObject({ kind: 'failed', status: 503, data: null, requestId: 'r2' });
  });

  it('says so when nothing answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    expect((await healthApi.full()).kind).toBe('unreachable');
  });
});
