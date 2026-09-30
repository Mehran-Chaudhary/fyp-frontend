import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiEvents, call } from './client';

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
