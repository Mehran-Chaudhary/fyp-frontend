import { expandPermissions, permissionMatches } from '../permissions/expand';

/**
 * What a role's stored grants really are (Phase 2 spec §3 "Permission editor
 * behavior"). Roles keep wildcards such as `document:*` as written; the editor
 * shows them faithfully, previews what they expand to, and never turns them
 * into a fixed list unless the user deliberately replaces the grant set.
 */
export interface GrantAnalysis {
  /** Stored keys with a `*`, in stored order. */
  wildcards: string[];
  /** Wildcards that match nothing in the catalogue (e.g. `pii:policy:*`: not a prefix glob). */
  inertWildcards: string[];
  /** Concrete stored keys that aren't in the catalogue (a later module, or a removed key). */
  unknown: string[];
  /** Concrete keys the grants amount to: catalogue matches plus unknown concrete keys, sorted. */
  expanded: string[];
}

export function analyseGrants(stored: readonly string[], catalogueKeys: readonly string[]): GrantAnalysis {
  const catalogue = new Set(catalogueKeys);
  const wildcards = stored.filter((key) => key.includes('*'));
  return {
    wildcards,
    inertWildcards: wildcards.filter((key) => !catalogueKeys.some((candidate) => permissionMatches(key, candidate))),
    unknown: stored.filter((key) => !key.includes('*') && !catalogue.has(key)),
    expanded: expandPermissions(stored, catalogueKeys),
  };
}

export interface KeyDiff {
  added: string[];
  removed: string[];
}

/** What changes between two sets of keys or ids, each side sorted. */
export function diffKeys(before: Iterable<string>, after: Iterable<string>): KeyDiff {
  const from = new Set(before);
  const to = new Set(after);
  return {
    added: [...to].filter((key) => !from.has(key)).sort(),
    removed: [...from].filter((key) => !to.has(key)).sort(),
  };
}

export const isEmptyDiff = (diff: KeyDiff): boolean => diff.added.length === 0 && diff.removed.length === 0;

/** The permission key regex of the role DTO (spec §5). */
export const PERMISSION_KEY_PATTERN = /^[a-z][a-z0-9_]*(:[a-z0-9_*]+)+$|^\*:\*$/;
