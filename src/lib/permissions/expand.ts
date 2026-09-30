/**
 * Permission wildcard logic. Must match the server exactly (spec Appendix B).
 *
 * Keys are `resource:action`, split on the FIRST colon, so `pii:policy:read` is
 * resource `pii`, action `policy:read`. `*:*` grants everything; `agent:*` grants
 * every `agent:…` key.
 */
export function permissionMatches(granted: string, required: string): boolean {
  if (granted === '*:*') return true;
  const g = parse(granted);
  const r = parse(required);
  if (!g || !r) return false;
  return (g.resource === '*' || g.resource === r.resource) && (g.action === '*' || g.action === r.action);
}

function parse(permission: string): { resource: string; action: string } | null {
  const i = permission.indexOf(':');
  if (i <= 0 || i === permission.length - 1) return null;
  return {
    resource: permission.slice(0, i).trim().toLowerCase(),
    action: permission.slice(i + 1).trim().toLowerCase(),
  };
}

export function expandPermissions(granted: Iterable<string>, catalogue: readonly string[]): string[] {
  const list = Array.from(granted);
  if (list.includes('*:*')) return [...catalogue].sort();
  const out = new Set<string>();
  for (const permission of list) {
    if (permission.includes('*')) {
      for (const candidate of catalogue) if (permissionMatches(permission, candidate)) out.add(candidate);
    } else {
      out.add(permission);
    }
  }
  return Array.from(out).sort();
}
