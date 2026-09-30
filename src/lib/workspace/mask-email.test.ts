import { describe, expect, it } from 'vitest';
import { maskEmail } from './mask-email';

describe('maskEmail (matches the server)', () => {
  it('keeps two characters and masks the rest of the local part', () => {
    expect(maskEmail('invitee.x@example.com')).toBe('in*******@example.com');
    expect(maskEmail('invitee@example.com')).toBe('in*****@example.com');
  });

  it('always shows at least two asterisks', () => {
    expect(maskEmail('a@x.com')).toBe('a**@x.com');
    expect(maskEmail('ab@x.com')).toBe('ab**@x.com');
  });

  it('refuses something that is not an address', () => {
    expect(maskEmail('not-an-email')).toBe('[REDACTED]');
    expect(maskEmail('@x.com')).toBe('[REDACTED]');
  });

  it('is compared against the lowercased address', () => {
    expect(maskEmail('Invitee@Example.com'.toLowerCase())).toBe('in*****@example.com');
  });
});
