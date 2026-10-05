import { describe, expect, it } from 'vitest';
import { ApiError, FORM_ERROR_KEY, isOutcomeUnknown, isWorkspaceAccessError, readRateLimit, toApiError } from './errors';

function validationError(fields: Record<string, string[]>) {
  return new ApiError({
    status: 422,
    code: 'VALIDATION_FAILED',
    message: 'One or more fields failed validation.',
    details: { fields },
  });
}

function silently<T>(run: () => T): T {
  const original = console.error;
  console.error = () => {};
  try {
    return run();
  } finally {
    console.error = original;
  }
}

describe('ApiError.fieldErrors (spec §3: keys are property paths)', () => {
  it('maps property keys to form fields', () => {
    const error = validationError({
      email: ['email must be a valid email address'],
      newPassword: ['Password must be at least 12 characters long. Password must contain a number.'],
    });
    expect(error.fieldErrors({ fields: ['email', 'newPassword'] })).toEqual({
      email: 'email must be a valid email address',
      newPassword: 'Password must be at least 12 characters long. Password must contain a number.',
    });
  });

  it('maps nested paths through aliases', () => {
    const error = validationError({ 'settings.defaultChunkSize': ['defaultChunkSize must not be less than 64'] });
    expect(error.fieldErrors({ fields: ['chunkSize'], aliases: { 'settings.defaultChunkSize': 'chunkSize' } })).toEqual({
      chunkSize: 'defaultChunkSize must not be less than 64',
    });
  });

  it('puts a rejected unknown property in the form-level summary (P1-T04)', () => {
    const error = validationError({ confirmPassword: ['property confirmPassword should not exist'] });
    expect(silently(() => error.fieldErrors({ fields: ['email', 'password'] }))).toEqual({
      [FORM_ERROR_KEY]: 'property confirmPassword should not exist',
    });
  });

  it('keeps reading the older first-word keys for password-policy failures', () => {
    const error = validationError({ Password: ['Password must contain a number.'], That: ['That password is too common.'] });
    expect(error.fieldErrors({ passwordField: 'password', fields: ['password'] })).toEqual({
      password: 'Password must contain a number. That password is too common.',
    });
  });

  it('matches keys case-insensitively and routes unknown keys to the form', () => {
    const error = validationError({ Email: ['bad'], mystery: ['?'] });
    expect(error.fieldErrors({ fields: ['email'] })).toEqual({ email: 'bad', [FORM_ERROR_KEY]: '?' });
  });

  it('returns raw keys without a field list, and nothing without details', () => {
    expect(validationError({ limit: ['limit must not be greater than 100'] }).fieldErrors()).toEqual({
      limit: 'limit must not be greater than 100',
    });
    expect(new ApiError({ status: 401, code: 'AUTH_INVALID_CREDENTIALS', message: 'x' }).fieldErrors()).toEqual({});
  });
});

describe('toApiError', () => {
  it('reads the envelope, request id, Retry-After and rate-limit headers', async () => {
    const reset = Math.floor(Date.now() / 1000) + 900;
    const res = new Response(
      JSON.stringify({
        success: false,
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Slow down', details: { retryAfterSeconds: 900 } },
        meta: { requestId: 'b726bf87-a089-4c3d-a402-82c54c8c471e', timestamp: 'now' },
      }),
      {
        status: 429,
        headers: {
          'retry-after': '900',
          'x-ratelimit-limit': '10',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(reset),
          'content-type': 'application/json',
        },
      },
    );
    const { error, isEnvelope } = await toApiError(res);
    expect(isEnvelope).toBe(true);
    expect(error.source).toBe('server');
    expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(error.requestId).toBe('b726bf87-a089-4c3d-a402-82c54c8c471e');
    expect(error.retryAfterSeconds).toBe(900);
    expect(error.rateLimit).toEqual({ limit: 10, remaining: 0, resetAt: reset * 1000 });
  });

  it('treats a bare 5xx from a proxy as the backend being unreachable', async () => {
    const { error, isEnvelope } = await toApiError(new Response('<html>Bad gateway</html>', { status: 502 }));
    expect(isEnvelope).toBe(false);
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.source).toBe('client');
  });

  it("doesn't invent a backend code or request id for a non-JSON 4xx", async () => {
    const { error } = await toApiError(new Response('<html>Not found</html>', { status: 404 }));
    expect(error).toMatchObject({ code: 'UNEXPECTED_RESPONSE', status: 404, source: 'client', requestId: undefined });
  });

  it('falls back to details.retryAfterSeconds without a header', async () => {
    const res = new Response(
      JSON.stringify({ success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'x', details: { retryAfterSeconds: 42 } }, meta: {} }),
      { status: 429 },
    );
    expect((await toApiError(res)).error.retryAfterSeconds).toBe(42);
  });
});

describe('readRateLimit', () => {
  it('reads the reset as Unix seconds, never milliseconds', () => {
    const info = readRateLimit(new Headers({ 'x-ratelimit-reset': '1800000000' }));
    expect(info?.resetAt).toBe(1_800_000_000_000);
  });

  it('is undefined when the headers are absent', () => {
    expect(readRateLimit(new Headers())).toBeUndefined();
  });
});

describe('retryDeadline', () => {
  it('uses the window reset when there is no Retry-After', () => {
    const resetAt = Date.now() + 120_000;
    const error = new ApiError({ status: 429, code: 'RATE_LIMIT_EXCEEDED', message: 'x', rateLimit: { resetAt } });
    expect(error.retryDeadline()).toBe(resetAt);
  });
});

describe('classification helpers', () => {
  it('tells a workspace email policy apart from the global email gate', () => {
    const policy = new ApiError({ status: 403, code: 'ACCOUNT_EMAIL_NOT_VERIFIED', message: 'x', details: { requiredBy: 'workspace' } });
    const gate = new ApiError({ status: 403, code: 'ACCOUNT_EMAIL_NOT_VERIFIED', message: 'x' });
    expect(isWorkspaceAccessError(policy)).toBe(true);
    expect(isWorkspaceAccessError(gate)).toBe(false);
    expect(isWorkspaceAccessError(new ApiError({ status: 403, code: 'IP_NOT_ALLOWED', message: 'x' }))).toBe(true);
  });

  it('marks answerless failures and 5xx answers as an unknown outcome', () => {
    expect(isOutcomeUnknown(new ApiError({ status: 0, code: 'NETWORK_TIMEOUT', message: 'x', source: 'client' }))).toBe(true);
    expect(isOutcomeUnknown(new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'x', source: 'client' }))).toBe(true);
    // The server may have written before it failed (Phase 2 spec §9).
    expect(isOutcomeUnknown(new ApiError({ status: 500, code: 'INTERNAL_SERVER_ERROR', message: 'x' }))).toBe(true);
    expect(isOutcomeUnknown(new ApiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'x' }))).toBe(true);
    expect(isOutcomeUnknown(new ApiError({ status: 409, code: 'ORGANIZATION_SLUG_TAKEN', message: 'x' }))).toBe(false);
    expect(isOutcomeUnknown(new ApiError({ status: 429, code: 'RATE_LIMIT_EXCEEDED', message: 'x' }))).toBe(false);
    expect(isOutcomeUnknown(new Error('x'))).toBe(false);
  });
});
