import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Member } from '@/lib/api/types';
import { expandPermissions } from '@/lib/permissions/expand';
import { permissionCatalogueQuery } from '@/lib/queries';
import { canActOn } from '@/lib/rbac/rules';
import { useWorkspace } from './workspace-context';

export interface WorkspaceAccess {
  /** Your membership in this workspace (E26). */
  membership: Member;
  /** Your rank: the highest priority among your roles. */
  myPriority: number;
  /** Your permissions as concrete catalogue keys (wildcards expanded). */
  myPermissions: ReadonlySet<string>;
  /** Every permission key in the catalogue. */
  catalogueKeys: readonly string[];
  /** False until the catalogue has loaded. */
  ready: boolean;
  /** Rule 1 (§3.2): not yourself, and only members ranked strictly below you. */
  canActOn: (target: Pick<Member, 'id' | 'highestRolePriority'>) => boolean;
}

/**
 * The inputs of the anti-escalation rules (spec §3.3), computed once per render
 * of the workspace. When your permissions are unknown (your roles can't read the
 * role list) every catalogue key is assumed and the server decides.
 */
export function useAccess(): WorkspaceAccess {
  const workspace = useWorkspace();
  const catalogue = useQuery(permissionCatalogueQuery);

  return useMemo(() => {
    const catalogueKeys = catalogue.data?.permissions.map((permission) => permission.key) ?? [];
    const granted = workspace.permissions.keys;
    const myPermissions = new Set(granted === null ? catalogueKeys : expandPermissions(granted, catalogueKeys));
    const membership = workspace.membership;
    return {
      membership,
      myPriority: membership.highestRolePriority,
      myPermissions,
      catalogueKeys,
      ready: !!catalogue.data,
      canActOn: (target) => canActOn(membership, target),
    };
  }, [workspace.permissions, workspace.membership, catalogue.data]);
}
