import { describe, expect, it } from 'vitest';
import { ApiError, FORM_ERROR_KEY, toApiError } from './errors';

function validationError(fields: Record<string, string[]>) {
  return new ApiError({
    status: 422,
    code: 'VALIDATION_FAILED',
    message: 'One or more fields failed validation.',
    details: { fields },
  });
}

describe('ApiError.fieldErrors (spec §3.3, BF-4)', () => {
  it('maps plain field keys', () => {
    const error = validationError({
      email: ['email must be a valid email address'],
      firstName: ['firstName should not be empty'],
    });
    expect(error.fieldErrors({ fields: ['email', 'firstName'] })).toEqual({
      email: 'email must be a valid email address',
      firstName: 'firstName should not be empty',
    });
  });

  it('sends "Password" and "That" to the password field of the form', () => {
    const error = validationError({
      Password: ['Password must be at least 12 characters long. Password must contain an uppercase letter.'],
      That: ['That password is too common. Please choose something less predictable.'],
    });
    expect(error.fieldErrors({ passwordField: 'newPassword', fields: ['currentPassword', 'newPassword'] })).toEqual({
      newPassword:
        'Password must be at least 12 characters long. Password must contain an uppercase letter. That password is too common. Please choose something less predictable.',
    });
  });

  it('turns "property" (a field the server does not accept) into a form-level error', () => {
    const error = validationError({ property: ['property extra should not exist'] });
    const original = console.error;
    console.error = () => {};
    try {
      expect(error.fieldErrors({ fields: ['email'] })).toEqual({ [FORM_ERROR_KEY]: 'property extra should not exist' });
    } finally {
      console.error = original;
    }
  });

  it('matches keys case-insensitively and routes unknown keys to the form', () => {
    const error = validationError({ Email: ['bad'], mystery: ['?'] });
    expect(error.fieldErrors({ fields: ['email'] })).toEqual({ email: 'bad', [FORM_ERROR_KEY]: '?' });
  });

  it('returns nothing when there are no field details', () => {
    expect(new ApiError({ status: 401, code: 'AUTH_INVALID_CREDENTIALS', message: 'x' }).fieldErrors()).toEqual({});
  });
});

describe('toApiError', () => {
  it('reads the envelope, request id and Retry-After', async () => {
    const res = new Response(
      JSON.stringify({
        success: false,
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Slow down', details: { retryAfterSeconds: 900 } },
        meta: { requestId: 'b726bf87-a089-4c3d-a402-82c54c8c471e', timestamp: 'now' },
      }),
      { status: 429, headers: { 'retry-after': '900', 'content-type': 'application/json' } },
    );
    const { error, isEnvelope } = await toApiError(res);
    expect(isEnvelope).toBe(true);
    expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(error.requestId).toBe('b726bf87-a089-4c3d-a402-82c54c8c471e');
    expect(error.retryAfterSeconds).toBe(900);
  });

  it('treats a bare 5xx from a proxy as the backend being unreachable', async () => {
    const { error, isEnvelope } = await toApiError(new Response('', { status: 502 }));
    expect(isEnvelope).toBe(false);
    expect(error.code).toBe('NETWORK_ERROR');
  });

  it('falls back to details.retryAfterSeconds without a header', async () => {
    const res = new Response(
      JSON.stringify({ success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'x', details: { retryAfterSeconds: 42 } }, meta: {} }),
      { status: 429 },
    );
    expect((await toApiError(res)).error.retryAfterSeconds).toBe(42);
  });
});
