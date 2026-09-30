import { permissionMatches } from './expand';
import type { PermissionSnapshot } from './load';

export interface Can {
  (permission: string): boolean;
  /** True if any of the permissions is held. */
  any: (...permissions: string[]) => boolean;
  /** True if all of the permissions are held. */
  all: (...permissions: string[]) => boolean;
  /** False when the permissions could not be determined (everything is allowed then). */
  known: boolean;
}

/**
 * Builds the `can()` helper for a permission snapshot (spec §5.3). Unknown
 * permissions allow everything; the server remains the authority.
 */
export function createCan(snapshot: PermissionSnapshot | null | undefined): Can {
  const keys = snapshot?.keys ?? null;
  const exact = new Set(keys ?? []);
  const wildcards = (keys ?? []).filter((key) => key.includes('*'));

  const check = (permission: string): boolean => {
    if (keys === null) return true;
    if (exact.has(permission)) return true;
    return wildcards.some((granted) => permissionMatches(granted, permission));
  };

  return Object.assign(check, {
    any: (...permissions: string[]) => permissions.some(check),
    all: (...permissions: string[]) => permissions.every(check),
    known: keys !== null,
  });
}
