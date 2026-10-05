import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Member } from '@/lib/api/types';
import { expandPermissions } from '@/lib/permissions/expand';
import { permissionCatalogueQuery } from '@/lib/queries';
import { canActOn } from '@/lib/rbac/rules';
import { useWorkspace } from './workspace-context';

export interface WorkspaceAccess {
  /** Your membership in this workspace, when it could be read (a platform admin may have none). */
  membership: Member | null;
  /** Your rank: the highest priority among your roles; -1 without a membership. */
  myPriority: number;
  /** Your permissions as concrete catalogue keys. */
  myPermissions: ReadonlySet<string>;
  /** Every permission key in the catalogue. */
  catalogueKeys: readonly string[];
  /** False until the catalogue has loaded. */
  ready: boolean;
  /** Rule 1: not yourself, and only members ranked strictly below you. */
  canActOn: (target: Pick<Member, 'id' | 'highestRolePriority'>) => boolean;
}

/**
 * The inputs of the anti-escalation rules, computed once per render of the
 * workspace. Permissions come from contextual /auth/me (already concrete); without
 * a readable membership, rank-based actions are not offered and the server decides.
 */
export function useAccess(): WorkspaceAccess {
  const workspace = useWorkspace();
  const catalogue = useQuery(permissionCatalogueQuery);

  return useMemo(() => {
    const catalogueKeys = catalogue.data?.permissions.map((permission) => permission.key) ?? [];
    const myPermissions = new Set(expandPermissions(workspace.permissions, catalogueKeys));
    const membership = workspace.membership;
    return {
      membership,
      myPriority: membership?.highestRolePriority ?? -1,
      myPermissions,
      catalogueKeys,
      ready: !!catalogue.data,
      canActOn: (target) => (membership ? canActOn(membership, target) : false),
    };
  }, [workspace.permissions, workspace.membership, catalogue.data]);
}
