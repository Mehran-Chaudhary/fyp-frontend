import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL } from '@/lib/env';

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
  it('shares one refresh between concurrent callers (single-flight, P1-T23)', async () => {
    let release: ((res: Response) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    vi.stubGlobal('fetch', fetchMock);

    const pending = [tm.refreshAccessToken(), tm.refreshAccessToken(), tm.refreshAccessToken()];
    // The refresh starts once this tab holds the cross-tab lock.
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    release!(ok(tokens('fresh')));

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

  it('renews right after a password change, with no artificial delay', async () => {
    const fetchMock = vi.fn(async () => ok(tokens('after-change')));
    vi.stubGlobal('fetch', fetchMock);
    tm.startSession({ accessToken: 'cut-off', expiresIn: 900 });
    tm.credentialsChanged();

    expect(tm.peekAccessToken()).toBeNull();
    expect(await tm.getAccessToken()).toBe('after-change');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('discards a refresh answer that arrives after sign-out (no resurrection, P1-T25)', async () => {
    let release!: (res: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => (release = resolve))));
    tm.startSession({ accessToken: 'about-to-expire', expiresIn: 5 });

    const pending = tm.getAccessToken();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    tm.endSession('signed-out', false);
    release(ok(tokens('late')));

    expect(await pending).toBeNull();
    expect(tm.hasActiveSession()).toBe(false);
    expect(tm.peekAccessToken()).toBeNull();
  });

  it('never repeats a refresh that timed out: the user decides (no grace window on reuse)', async () => {
    const fetchMock = vi.fn(async () => Promise.reject(new DOMException('timed out', 'TimeoutError')));
    vi.stubGlobal('fetch', fetchMock);
    tm.startSession({ accessToken: 'about-to-expire', expiresIn: 5 });
    const uncertain = vi.fn();
    const off = tm.authEvents.on('refresh-uncertain', uncertain);

    await expect(tm.getAccessToken()).rejects.toMatchObject({ code: 'NETWORK_TIMEOUT', source: 'client' });
    await expect(tm.getAccessToken()).rejects.toMatchObject({ code: 'NETWORK_TIMEOUT' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(uncertain).toHaveBeenCalledTimes(1);
    expect(tm.hasActiveSession()).toBe(true);

    vi.stubGlobal('fetch', vi.fn(async () => ok(tokens('confirmed'))));
    expect(await tm.retryUncertainRefresh()).toBe('confirmed');
    off();
  });

  it('finishes an unconfirmed sign-out without signing anyone back in', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const auth = (init?.headers as Record<string, string>).Authorization;
        seen.push(`${urlOf(input).replace(API_BASE_URL, '')}${auth ? ` ${auth}` : ''}`);
        return urlOf(input).endsWith('/auth/refresh') ? ok(tokens('throwaway')) : ok({ revokedSessions: 1 });
      }),
    );
    expect(await tm.revokeCookieSession()).toBe(true);
    expect(seen).toEqual(['/auth/refresh', '/auth/logout Bearer throwaway']);
    expect(tm.hasActiveSession()).toBe(false);
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
    expect(urlOf(url)).toBe(`${API_BASE_URL}/organizations/79b7a713-eaa2-47c0-b9d5-11e738780fe4/members/me`);
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

describe('API client: renewal rules (spec §4) and responses (spec §3)', () => {
  it('ends the session on AUTH_TOKEN_INVALID without trying a refresh', async () => {
    const fetchMock = vi.fn(async () => fail(401, 'AUTH_TOKEN_INVALID'));
    vi.stubGlobal('fetch', fetchMock);
    tm.startSession({ accessToken: 'forged', expiresIn: 900 });

    await expect(client.call('/auth/me')).rejects.toMatchObject({ code: 'AUTH_TOKEN_INVALID' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tm.hasActiveSession()).toBe(false);
  });

  it('lets one refresh decide an AUTH_TOKEN_REVOKED (a password change keeps the family)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (urlOf(input).endsWith('/auth/refresh')) return ok(tokens('renewed'));
        const auth = (init?.headers as Record<string, string>).Authorization;
        return auth === 'Bearer renewed' ? ok({ fine: true }) : fail(401, 'AUTH_TOKEN_REVOKED');
      }),
    );
    tm.startSession({ accessToken: 'cut-off', expiresIn: 900 });
    expect(await client.call('/auth/sessions')).toEqual({ fine: true });
    expect(tm.hasActiveSession()).toBe(true);
  });

  it('ends the session when the refresh after AUTH_TOKEN_REVOKED is refused too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fail(401, 'AUTH_TOKEN_REVOKED')));
    tm.startSession({ accessToken: 'revoked', expiresIn: 900 });
    await expect(client.call('/auth/sessions')).rejects.toMatchObject({ code: 'AUTH_TOKEN_REVOKED' });
    expect(tm.hasActiveSession()).toBe(false);
  });

  it('does not replay a request into a different session', async () => {
    let release: ((res: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        urlOf(input).endsWith('/auth/refresh')
          ? new Promise<Response>((resolve) => (release = resolve))
          : Promise.resolve(fail(401, 'AUTH_TOKEN_EXPIRED')),
      ),
    );
    tm.startSession({ accessToken: 'old', expiresIn: 900 });
    const pending = client.call('/organizations');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    tm.endSession('signed-out', false);
    tm.startSession({ accessToken: 'someone-else', expiresIn: 900 });
    release!(ok(tokens('late')));

    await expect(pending).rejects.toMatchObject({ code: 'SESSION_CHANGED', source: 'client' });
    expect(tm.peekAccessToken()).toBe('someone-else');
  });

  it('rejects a success that is not the API envelope (an HTML page from a proxy)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<!doctype html><title>app</title>', { status: 200, headers: { 'content-type': 'text/html' } })),
    );
    tm.startSession({ accessToken: 't', expiresIn: 900 });
    await expect(client.call('/auth/me')).rejects.toMatchObject({
      code: 'UNEXPECTED_RESPONSE',
      source: 'client',
      requestId: undefined,
    });
  });

  it('reports a network failure without inventing a request id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    tm.startSession({ accessToken: 't', expiresIn: 900 });
    await expect(client.call('/auth/me')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0, requestId: undefined });
  });

  it('never attaches a bearer or workspace to public calls, and always sends cookies', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => ok({ sent: true }));
    vi.stubGlobal('fetch', fetchMock);
    tm.startSession({ accessToken: 'secret', expiresIn: 900 });
    await client.call('/auth/forgot-password', { method: 'POST', body: { email: 'a@b.c' }, auth: false });
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
    expect((init?.headers as Record<string, string>)['X-Organization-Id']).toBeUndefined();
    expect(init?.credentials).toBe('include');
  });

  it('gives every attempt a fresh X-Request-Id, replays included', async () => {
    const ids: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (urlOf(input).endsWith('/auth/refresh')) return ok(tokens('fresh'));
        ids.push((init?.headers as Record<string, string>)['X-Request-Id']);
        return ids.length === 1 ? fail(401, 'AUTH_TOKEN_EXPIRED') : ok({});
      }),
    );
    tm.startSession({ accessToken: 'stale', expiresIn: 900 });
    await client.call('/auth/sessions');
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
