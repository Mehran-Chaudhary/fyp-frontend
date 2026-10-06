import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiEvents, call, parseResponseHeaders, request } from './client';

function answerWith(code: string, status = 403) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: { code, message: 'Refused.' },
            meta: { requestId: 'req-1', timestamp: '2026-09-30T00:00:00.000Z' },
          }),
          { status, headers: { 'content-type': 'application/json' } },
        ),
    ),
  );
}

describe('localCodes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps codes the caller handles away from the global handler', async () => {
    answerWith('MFA_REQUIRED');
    const seen: string[] = [];
    const off = apiEvents.on('error', ({ error }) => seen.push(error.code));

    // E30 "require two-step verification": a refusal of the change, not lost access.
    await expect(
      call('/organizations/w', { auth: false, workspaceId: 'w', method: 'PATCH', body: {}, localCodes: ['MFA_REQUIRED'] }),
    ).rejects.toMatchObject({ code: 'MFA_REQUIRED', status: 403 });
    expect(seen).toEqual([]);

    // Any other workspace call with the same code still reaches the global handler.
    await expect(call('/organizations/w/agents', { auth: false, workspaceId: 'w' })).rejects.toMatchObject({
      code: 'MFA_REQUIRED',
    });
    expect(seen).toEqual(['MFA_REQUIRED']);
    off();
  });

  it('still reports codes the caller did not claim', async () => {
    answerWith('PERMISSION_DENIED');
    const seen: string[] = [];
    const off = apiEvents.on('error', ({ error }) => seen.push(error.code));
    await expect(
      call('/organizations/w/invitations', { auth: false, workspaceId: 'w', method: 'POST', body: {}, localCodes: ['MEMBERSHIP_SUSPENDED'] }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(seen).toEqual(['PERMISSION_DENIED']);
    off();
  });
});

describe('multipart and raw transports (Phase 3 spec §2)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lets the browser set the multipart boundary', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, data: { id: 'doc' }, meta: { requestId: 'r', timestamp: 't' } }), {
          status: 202,
          headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '99' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const form = new FormData();
    form.append('classification', 'INTERNAL');
    const result = await request<{ id: string }>('/organizations/w/knowledge-bases/k/documents', {
      auth: false,
      workspaceId: 'w',
      method: 'POST',
      body: form,
    });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.body).toBe(form);
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect((init.headers as Record<string, string>)['X-Organization-Id']).toBe('w');
    expect(result.data.id).toBe('doc');
    expect(result.rateLimit?.remaining).toBe(99);
  });

  it('parses the headers of an XMLHttpRequest answer', () => {
    const headers = parseResponseHeaders('X-Request-Id: abc\r\nx-ratelimit-reset: 1700000000\r\ncontent-disposition: attachment; filename="a.pdf"\r\n');
    expect(headers.get('x-request-id')).toBe('abc');
    expect(headers.get('X-RateLimit-Reset')).toBe('1700000000');
    expect(headers.get('content-disposition')).toContain('a.pdf');
  });
});
