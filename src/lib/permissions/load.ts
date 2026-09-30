import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { authApi, organizationsApi } from '@/lib/api/endpoints';
import { hasCode } from '@/lib/api/errors';
import { membershipQuery, permissionCatalogueQuery, queryKeys } from '@/lib/queries';
import { expandPermissions } from './expand';

/**
 * The current user's effective permissions in one workspace.
 * `keys === null` means "unknown": the member's roles cannot read the role list,
 * so the UI shows everything and relies on the server's 403s (spec §5.2).
 */
export interface PermissionSnapshot {
  keys: string[] | null;
  source: 'server' | 'computed' | 'unknown';
}

/**
 * Spec §5.2. Prefers the server's answer (GET /auth/me with X-Organization-Id) and
 * falls back to computing it from membership + roles + catalogue until BF-1 is
 * fixed. Once the backend returns `permissions`, this uses it automatically.
 */
export async function loadWorkspacePermissions(
  workspaceId: string,
  client: QueryClient,
): Promise<PermissionSnapshot> {
  const me = await authApi.me(workspaceId);
  if (Array.isArray(me.permissions)) {
    return { keys: [...me.permissions].sort(), source: 'server' };
  }

  // fetchQuery (not ensureQueryData) so a stale membership is re-read: an admin
  // may have changed this member's roles since it was cached.
  const [catalogue, membership] = await Promise.all([
    client.ensureQueryData(permissionCatalogueQuery),
    client.fetchQuery(membershipQuery(workspaceId)),
  ]);
  const allKeys = catalogue.permissions.map((permission) => permission.key);

  // The owner holds `*:*` by definition.
  if (membership.isOwner) return { keys: [...allKeys].sort(), source: 'computed' };

  let roles;
  try {
    roles = await organizationsApi.roles(workspaceId);
  } catch (error) {
    if (hasCode(error, 'PERMISSION_DENIED')) return { keys: null, source: 'unknown' };
    throw error;
  }

  const mine = new Set(membership.roles.map((role) => role.id));
  const granted = roles.filter((role) => mine.has(role.id)).flatMap((role) => role.permissionKeys);
  return { keys: expandPermissions(granted, allKeys), source: 'computed' };
}

export const permissionsQuery = (workspaceId: string, client: QueryClient) =>
  queryOptions({
    queryKey: queryKeys.permissions(workspaceId),
    queryFn: () => loadWorkspacePermissions(workspaceId, client),
    // Roles can change at any moment; treat permissions as server state (§5.2).
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
