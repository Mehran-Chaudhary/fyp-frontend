import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { ApiError, FORM_ERROR_KEY, isApiError } from './api/errors';
import { formatCountdown, formatTime, pluralize } from './utils';

/**
 * One place that turns an error into something a person can read (spec §9).
 * Falls back to the server's message, which is safe to show.
 */
export function messageFor(error: unknown): string {
  if (!isApiError(error)) {
    return error instanceof Error && error.message ? error.message : 'Something went wrong.';
  }
  const details = error.details ?? {};

  switch (error.code) {
    case 'NETWORK_ERROR':
      return "Can't reach AgentVault. Check your connection and try again.";
    case 'REQUEST_TIMEOUT':
      return 'The request took too long. Try again.';
    case 'INTERNAL_SERVER_ERROR':
      return 'Something went wrong on our side. Try again in a moment.';
    case 'SERVICE_UNAVAILABLE':
      return 'AgentVault is temporarily unavailable. Try again shortly.';
    case 'RATE_LIMIT_EXCEEDED':
      return error.retryAfterSeconds
        ? `Too many requests. Try again in ${formatCountdown(error.retryAfterSeconds)}.`
        : 'Too many requests. Wait a moment and try again.';
    case 'AUTH_INVALID_CREDENTIALS':
      return 'Invalid email address or password.';
    case 'ACCOUNT_LOCKED': {
      const until = typeof details.lockedUntil === 'string' ? details.lockedUntil : null;
      return until
        ? `Too many failed attempts. Try again at ${formatTime(until)}.`
        : 'Too many failed attempts. Try again later.';
    }
    case 'ACCOUNT_ALREADY_EXISTS':
      return 'An account with this email already exists.';
    case 'AUTH_PASSWORD_MISMATCH':
      return 'The password is incorrect.';
    case 'AUTH_PASSWORD_REUSED':
      return 'Must differ from your current password.';
    case 'AUTH_PASSWORD_BREACHED': {
      const occurrences = typeof details.occurrences === 'number' ? details.occurrences : null;
      return occurrences
        ? `This password has appeared in a known data breach (${occurrences.toLocaleString()} times). Choose a different one.`
        : 'This password has appeared in a known data breach. Choose a different one.';
    }
    case 'MFA_CODE_INVALID':
      return 'That code is not valid.';
    case 'TOKEN_NOT_FOUND':
    case 'TOKEN_EXPIRED':
    case 'TOKEN_ALREADY_USED':
      return 'This link is no longer valid.';
    case 'PERMISSION_DENIED': {
      const missing = Array.isArray(details.missingPermissions) ? (details.missingPermissions as string[]) : [];
      return missing.length
        ? `You don't have permission to do that (${missing.join(', ')}).`
        : "You don't have permission to do that.";
    }
    case 'ORGANIZATION_LIMIT_REACHED': {
      const limit = typeof details.limit === 'number' ? details.limit : null;
      return limit ? `You can own at most ${pluralize(limit, 'workspace')}.` : 'You have reached the workspace limit.';
    }
    case 'ORGANIZATION_SLUG_RESERVED':
      return 'That URL is reserved.';
    case 'ACCOUNT_ERASURE_DISABLED':
      return 'Account erasure is disabled on this deployment.';

    // ── Phase 2 (spec §7) ──
    case 'CANNOT_MODIFY_SELF':
      return "You can't change your own membership this way.";
    case 'FORBIDDEN':
      // Rank refusals carry both priorities; other FORBIDDENs have a specific message.
      return typeof details.targetPriority === 'number'
        ? "You can only manage members whose role ranks below yours."
        : error.message || "You're not allowed to do that.";
    case 'CANNOT_ESCALATE_PRIVILEGES': {
      const denied = stringList(details.deniedPermissions);
      const scopes = stringList(details.deniedScopes);
      if (denied.length) return `You can't grant permissions you don't hold: ${denied.join(', ')}.`;
      if (scopes.length) return `You can't grant scopes you don't hold: ${scopes.join(', ')}.`;
      return error.message || "You can't grant more access than you have.";
    }
    case 'ROLE_IMMUTABLE':
      return "Built-in roles can't be changed.";
    case 'ROLE_ALREADY_EXISTS':
      return 'A role with this name already exists.';
    case 'ROLE_IN_USE': {
      const count = typeof details.memberCount === 'number' ? details.memberCount : null;
      return count !== null
        ? `This role is assigned to ${pluralize(count, 'member')}. Reassign them before deleting it.`
        : 'This role is still assigned to members. Reassign them before deleting it.';
    }
    case 'ROLE_NOT_FOUND':
      return 'That role no longer exists. It may have just been deleted.';
    case 'PERMISSION_NOT_FOUND': {
      const unknown = stringList(details.unknownPermissions);
      return unknown.length ? `Unknown permission: ${unknown.join(', ')}.` : error.message;
    }
    case 'MEMBERSHIP_NOT_FOUND':
      return 'That member is no longer active in this workspace.';
    case 'MEMBERSHIP_ALREADY_EXISTS':
      return 'That person is already a member of this workspace.';
    case 'CANNOT_REMOVE_LAST_OWNER':
      return 'You own this workspace. Transfer ownership to someone else first.';
    case 'SEAT_LIMIT_REACHED': {
      const limit = typeof details.limit === 'number' ? details.limit : null;
      return limit !== null
        ? `This workspace has reached its member limit (${limit}).`
        : 'This workspace has reached its member limit.';
    }
    case 'INVITATION_NOT_FOUND':
      return "This invitation isn't valid any more. It may have been replaced or revoked.";
    case 'INVITATION_EXPIRED':
      return 'This invitation has expired.';
    case 'INVITATION_REVOKED':
      return 'This invitation was withdrawn.';
    case 'INVITATION_ALREADY_ACCEPTED':
      return 'This invitation has already been accepted.';
    case 'INVITATION_ALREADY_PENDING':
      return 'An invitation is already pending for this address.';
    case 'INVITATION_EMAIL_MISMATCH':
      return 'This invitation belongs to another email address.';
    case 'API_KEY_NOT_FOUND':
      return 'That API key no longer exists.';
    case 'IP_ALLOWLIST_SELF_LOCKOUT':
      return error.message || 'This change would block your own network address from the workspace.';
    default:
      return error.message || 'Something went wrong.';
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** A string[] from an error's `details`, e.g. `detailList(error, 'allowedDomains')`. */
export function detailList(error: unknown, key: string): string[] {
  return isApiError(error) ? stringList(error.details?.[key]) : [];
}

/** Short title for toasts; the body carries `messageFor`. */
export function titleFor(error: unknown, fallback = "That didn't work"): string {
  if (!isApiError(error)) return fallback;
  if (error.code === 'NETWORK_ERROR') return 'Connection problem';
  if (error.code === 'RATE_LIMIT_EXCEEDED') return 'Slow down';
  if (error.code === 'PERMISSION_DENIED' || error.code === 'FORBIDDEN' || error.code === 'CANNOT_ESCALATE_PRIVILEGES') {
    return 'Not allowed';
  }
  if (error.status >= 500) return 'Server error';
  return fallback;
}

/**
 * Applies a server error to a React Hook Form: 422 field errors go to their
 * fields (with the password-policy keys mapped per spec §3.3), anything else
 * becomes a form-level error. Returns true when at least one field got an error.
 */
export function applyServerErrors<T extends FieldValues>(
  form: UseFormReturn<T>,
  error: unknown,
  options: { passwordField?: Path<T>; fields: readonly Path<T>[]; aliases?: Record<string, Path<T>> },
): boolean {
  if (!(error instanceof ApiError)) {
    form.setError('root.server', { type: 'server', message: messageFor(error) });
    return false;
  }

  if (error.code === 'VALIDATION_FAILED') {
    const mapped = error.fieldErrors({
      passwordField: options.passwordField,
      fields: options.fields,
      aliases: options.aliases,
    });
    let applied = false;
    for (const [field, message] of Object.entries(mapped)) {
      if (field === FORM_ERROR_KEY) {
        form.setError('root.server', { type: 'server', message });
      } else {
        form.setError(field as Path<T>, { type: 'server', message }, { shouldFocus: !applied });
        applied = true;
      }
    }
    if (Object.keys(mapped).length === 0) {
      form.setError('root.server', { type: 'server', message: error.message });
    }
    return applied;
  }

  form.setError('root.server', { type: 'server', message: messageFor(error) });
  return false;
}
