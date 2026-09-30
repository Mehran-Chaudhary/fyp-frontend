import type { PermissionDefinition } from '@/lib/api/types';

/** Category order and labels for the permission grid (spec §5.6). */
export const PERMISSION_CATEGORIES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'workspace', label: 'Workspace' },
  { key: 'members', label: 'Members' },
  { key: 'access_control', label: 'Access control' },
  { key: 'security', label: 'Security' },
  { key: 'knowledge', label: 'Knowledge' },
  { key: 'clearance', label: 'Document clearance' },
  { key: 'agents', label: 'Agents' },
  { key: 'workflows', label: 'Workflows' },
  { key: 'tools', label: 'Tools' },
  { key: 'privacy', label: 'Privacy' },
  { key: 'observability', label: 'Audit & usage' },
];

export interface PermissionGroup {
  key: string;
  label: string;
  permissions: PermissionDefinition[];
}

/** Catalogue entries grouped by category, in the spec's order; unknown categories go last. */
export function groupPermissions(permissions: readonly PermissionDefinition[]): PermissionGroup[] {
  const byCategory = new Map<string, PermissionDefinition[]>();
  for (const permission of permissions) {
    const list = byCategory.get(permission.category) ?? [];
    list.push(permission);
    byCategory.set(permission.category, list);
  }
  const known = PERMISSION_CATEGORIES.filter((category) => byCategory.has(category.key)).map((category) => ({
    ...category,
    permissions: byCategory.get(category.key)!,
  }));
  const extra = [...byCategory.keys()]
    .filter((key) => !PERMISSION_CATEGORIES.some((category) => category.key === key))
    .sort()
    .map((key) => ({
      key,
      label: key.replace(/_/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase()),
      permissions: byCategory.get(key)!,
    }));
  return [...known, ...extra];
}
