import { createContext, useContext, useMemo } from 'react';
import type { Member, MembershipSummary, Organization } from '@/lib/api/types';
import { createCan, type Can } from '@/lib/permissions/can';
import { humanizeSlug } from '@/lib/utils';

/** The workspace the user is inside, resolved by the workspace gate (Phase 1 spec §5). */
export interface ActiveWorkspace {
  /** Canonical UUID: every API call uses it for both path and header. */
  id: string;
  /** The URL segment: the slug when known (slugs never change), else the id. */
  slug: string;
  name: string;
  /** From the first 100 memberships embedded in /auth/me, when it is among them. */
  summary: MembershipSummary | null;
  /**
   * Your own membership (role labels, rank), when it could be read. A platform
   * admin entering without one has none, and nothing depends on it existing.
   */
  membership: Member | null;
  /** Concrete permission keys from contextual /auth/me. Absent keys are not held. */
  permissions: readonly string[];
  /** Workspace detail, when you hold `workspace:read`. */
  details: Organization | null;
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

/** `can('agent:create')`, `can.any(...)`, bound to the active workspace. Fails closed. */
export function useCan(): Can {
  const { permissions } = useWorkspace();
  return useMemo(() => createCan(permissions), [permissions]);
}

/** "Owner", or the highest-priority role's name; falls back to the embedded role slugs. */
export function primaryRoleLabel(
  membership: Pick<Member, 'isOwner' | 'roles'> | null,
  summary?: Pick<MembershipSummary, 'isOwner' | 'roleSlugs'> | null,
): string {
  if (membership?.isOwner || summary?.isOwner) return 'Owner';
  const top = membership ? [...membership.roles].sort((a, b) => b.priority - a.priority)[0] : undefined;
  if (top) return top.name;
  const slug = summary?.roleSlugs[0];
  return slug ? humanizeSlug(slug) : 'Member';
}
