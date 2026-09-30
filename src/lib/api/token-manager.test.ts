import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type TokenManager = typeof import('./token-manager');
type Client = typeof import('./client');

let tm: TokenManager;
let client: Client;

beforeAll(async () => {
  // Isolate from other test files: no cross-tab channel in unit tests.
  vi.stubGlobal('BroadcastChannel', undefined);
  tm = await import('./token-manager');
  client = await import('./client');
});

beforeEach(() => {
  tm.__resetTokenManagerForTests();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
const ok = (data: unknown) =>
  json(200, { success: true, data, meta: { requestId: 'req-1', timestamp: new Date().toISOString() } });
const fail = (status: number, code: string, details?: Record<string, unknown>, headers?: Record<string, string>) =>
  json(status, { success: false, error: { code, message: code, details }, meta: { requestId: 'req-2', timestamp: '' } }, headers);
const tokens = (accessToken: string) => ({ accessToken, tokenType: 'Bearer', expiresIn: 900, expiresAt: '', refreshExpiresIn: 2592000 });

function urlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
}

describe('token manager', () => {
  it('shares one refresh between concurrent callers (single-flight, spec §4.2)', async () => {
    let release!: (res: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    vi.stubGlobal('fetch', fetchMock);

    const pending = [tm.refreshAccessToken(), tm.refreshAccessToken(), tm.refreshAccessToken()];
    release(ok(tokens('fresh')));

    expect(await Promise.all(pending)).toEqual(['fresh', 'fresh', 'fresh']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ends the session with the specific reason on reuse detection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fail(401, 'AUTH_REFRESH_TOKEN_REUSED')));
    localStorage.setItem('av.hasSession', '1');
    const ended = vi.fn();
    const off = tm.authEvents.on('session-ended', ended);

    expect(await tm.refreshAccessToken()).toBeNull();
    expect(ended).toHaveBeenCalledWith({ reason: 'AUTH_REFRESH_TOKEN_REUSED' });
    expect(localStorage.getItem('av.hasSession')).toBeNull();
    off();
  });

  it('keeps the session when the refresh is throttled (429 is never a sign-out)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fail(429, 'RATE_LIMIT_EXCEEDED', { retryAfterSeconds: 900 }, { 'retry-after': '900' })));
    tm.startSession({ accessToken: 'about-to-expire', expiresIn: 5 });
    const throttled = vi.fn();
    const ended = vi.fn();
    const offThrottle = tm.authEvents.on('refresh-throttled', throttled);
    const offEnded = tm.authEvents.on('session-ended', ended);

    await expect(tm.getAccessToken()).rejects.toMatchObject({ status: 429, retryAfterSeconds: 900 });
    expect(throttled).toHaveBeenCalledTimes(1);
    expect(ended).not.toHaveBeenCalled();
    expect(tm.hasActiveSession()).toBe(true);
    offThrottle();
    offEnded();
  });

  it('keeps the session when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    tm.startSession({ accessToken: 'about-to-expire', expiresIn: 5 });

    await expect(tm.getAccessToken()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(tm.hasActiveSession()).toBe(true);
  });

  it('does not spend a refresh at boot when the browser never had a session', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await tm.restoreSession()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never refreshes after sign-out', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    tm.startSession({ accessToken: 't', expiresIn: 900 });
    tm.endSession('signed-out', false);
    expect(await tm.getAccessToken()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('holds the next refresh after a password change (BF-3)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(tokens('after-change'))));
    tm.startSession({ accessToken: 'dead', expiresIn: 900 });
    tm.expireTokenAndDelayRefresh(60, false);

    const started = performance.now();
    expect(await tm.getAccessToken()).toBe('after-change');
    expect(performance.now() - started).toBeGreaterThanOrEqual(50);
  });
});

describe('API client', () => {
  it('refreshes once for a burst of expired-token 401s and retries each request', async () => {
    let refreshes = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (urlOf(input).endsWith('/auth/refresh')) {
          refreshes += 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return ok(tokens('fresh'));
        }
        const auth = (init?.headers as Record<string, string>).Authorization;
        return auth === 'Bearer fresh' ? ok({ path: urlOf(input) }) : fail(401, 'AUTH_TOKEN_EXPIRED');
      }),
    );
    tm.startSession({ accessToken: 'stale', expiresIn: 900 });

    const results = await Promise.all([client.call('/a'), client.call('/b'), client.call('/c')]);
    expect(results).toHaveLength(3);
    expect(refreshes).toBe(1);
  });

  it('never refreshes or signs out on wrong-input 401s', async () => {
    const fetchMock = vi.fn(async () => fail(401, 'AUTH_PASSWORD_MISMATCH'));
    vi.stubGlobal('fetch', fetchMock);
    tm.startSession({ accessToken: 't', expiresIn: 900 });
    const ended = vi.fn();
    const off = tm.authEvents.on('session-ended', ended);

    await expect(client.call('/auth/change-password', { method: 'POST', body: {} })).rejects.toMatchObject({
      code: 'AUTH_PASSWORD_MISMATCH',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ended).not.toHaveBeenCalled();
    expect(tm.hasActiveSession()).toBe(true);
    off();
  });

  it('sends the workspace header from the same id as the path', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => ok({}));
    vi.stubGlobal('fetch', fetchMock);
    tm.startSession({ accessToken: 't', expiresIn: 900 });

    const [path, scope] = client.workspacePath('79b7a713-eaa2-47c0-b9d5-11e738780fe4', '/members/me');
    await client.call(path, scope);

    const [url, init] = fetchMock.mock.calls[0];
    expect(urlOf(url)).toBe('/api/v1/organizations/79b7a713-eaa2-47c0-b9d5-11e738780fe4/members/me');
    expect((init?.headers as Record<string, string>)['X-Organization-Id']).toBe('79b7a713-eaa2-47c0-b9d5-11e738780fe4');
    expect(init?.credentials).toBe('include');
  });

  it('parses paginated lists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(200, {
          success: true,
          data: [{ id: 1 }, { id: 2 }],
          meta: {
            requestId: 'r',
            timestamp: '',
            pagination: { page: 1, limit: 20, totalItems: 2, totalPages: 1, hasPreviousPage: false, hasNextPage: false },
          },
        }),
      ),
    );
    tm.startSession({ accessToken: 't', expiresIn: 900 });
    const page = await client.callPaginated<{ id: number }>('/organizations');
    expect(page.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(page.pagination.totalItems).toBe(2);
  });
});
