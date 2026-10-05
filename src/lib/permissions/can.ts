import { permissionMatches } from './expand';

export interface Can {
  (permission: string): boolean;
  /** True if any of the permissions is held. */
  any: (...permissions: string[]) => boolean;
  /** True if all of the permissions are held. */
  all: (...permissions: string[]) => boolean;
}

/**
 * Builds the `can()` helper from your concrete permission keys in a workspace
 * (Phase 1 spec §5 "Permission-driven UI"). It fails closed: a key that isn't in
 * the list is not held, and an empty or missing list holds nothing. The server
 * expands wildcards before sending them; wildcards are still understood here so a
 * future response can't widen nothing into everything by accident.
 */
export function createCan(keys: readonly string[] | null | undefined): Can {
  const list = Array.isArray(keys) ? keys : [];
  const exact = new Set(list);
  const wildcards = list.filter((key) => key.includes('*'));

  const check = (permission: string): boolean =>
    exact.has(permission) || wildcards.some((granted) => permissionMatches(granted, permission));

  return Object.assign(check, {
    any: (...permissions: string[]) => permissions.some(check),
    all: (...permissions: string[]) => permissions.every(check),
  });
}
