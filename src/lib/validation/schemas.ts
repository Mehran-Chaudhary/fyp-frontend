import { z } from 'zod';
import { evaluatePassword, PASSWORD_MAX_LENGTH } from './password-policy';
import { RESERVED_SLUGS, SLUG_MAX_LENGTH, SLUG_PATTERN } from './slug';

/** Shared field schemas mirroring the server's validation (spec §10). */

export const emailField = z
  .string()
  .trim()
  .min(1, 'Enter your email address.')
  .max(320, 'Email addresses are at most 320 characters.')
  .pipe(z.email('Enter a valid email address.'));

/** Sign-in accepts any existing password: old ones predate the policy. */
export const existingPasswordField = z
  .string()
  .min(1, 'Enter your password.')
  .max(1024, 'That password is too long.');

/** A new password must satisfy the policy (the checklist shows which rule fails). */
export const newPasswordField = z
  .string()
  .min(1, 'Choose a password.')
  .max(PASSWORD_MAX_LENGTH, `Use no more than ${PASSWORD_MAX_LENGTH} characters.`)
  .refine((value) => evaluatePassword(value).valid, 'This password does not meet every rule below.');

export const nameField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter your ${label.toLowerCase()}.`)
    .max(100, `${label} is at most 100 characters.`);

/** Authenticator code: "123456" or "123 456". */
export const TOTP_PATTERN = /^\s*\d{3}\s?\d{3}\s*$/;

export const totpField = z
  .string()
  .trim()
  .min(1, 'Enter the 6-digit code.')
  .regex(TOTP_PATTERN, 'Enter the 6-digit code from your authenticator app.');

export const recoveryCodeField = z
  .string()
  .trim()
  .min(1, 'Enter a recovery code.')
  .max(32, 'Recovery codes look like xxxxx-xxxxx.');

export const workspaceNameField = z
  .string()
  .trim()
  .min(2, 'Use at least 2 characters.')
  .max(120, 'Use no more than 120 characters.');

export const workspaceSlugField = z
  .string()
  .trim()
  .refine((value) => value === '' || value.length >= 2, 'Use at least 2 characters.')
  .refine((value) => value.length <= SLUG_MAX_LENGTH, `Use no more than ${SLUG_MAX_LENGTH} characters.`)
  .refine(
    (value) => value === '' || SLUG_PATTERN.test(value),
    'Use lowercase letters, numbers and hyphens, starting and ending with a letter or number.',
  )
  .refine((value) => !RESERVED_SLUGS.has(value), 'That URL is reserved.');

export const workspaceDescriptionField = z.string().max(2000, 'Use no more than 2000 characters.');

/** Normalises a TOTP entry to six digits. */
export function normaliseTotp(value: string): string {
  return value.replace(/\s+/g, '');
}
