import { createContext, useContext, useMemo } from 'react';
import type { Member, MembershipSummary } from '@/lib/api/types';
import { createCan, type Can } from '@/lib/permissions/can';
import type { PermissionSnapshot } from '@/lib/permissions/load';

/** The workspace the user is inside, resolved by the workspace gate (spec §6.2). */
export interface ActiveWorkspace {
  id: string;
  slug: string;
  name: string;
  summary: MembershipSummary;
  membership: Member;
  permissions: PermissionSnapshot;
}

export const WorkspaceContext = createContext<ActiveWorkspace | null>(null);

export function useWorkspace(): ActiveWorkspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error('useWorkspace() must be used inside the workspace gate.');
  return workspace;
}

export function useOptionalWorkspace(): ActiveWorkspace | null {
  return useContext(WorkspaceContext);
}

/** `can('agent:create')`, `can.any(...)`, bound to the active workspace (spec §5.3). */
export function useCan(): Can {
  const { permissions } = useWorkspace();
  return useMemo(() => createCan(permissions), [permissions]);
}

/** "Owner", or the highest-priority role's name. */
export function primaryRoleLabel(membership: Pick<Member, 'isOwner' | 'roles'>): string {
  if (membership.isOwner) return 'Owner';
  const top = [...membership.roles].sort((a, b) => b.priority - a.priority)[0];
  return top?.name ?? 'Member';
}
