import { invalidateKnowledgeAccess } from '../knowledge/cache';
import { queryKeys } from '../queries';
import { queryClient } from '../query-client';
import { STORAGE_KEYS, storage } from '../storage';
import { clearWorkspaceBlock } from '../workspace-blocks';

/**
 * What to refetch after each kind of administrative change (Phase 2 spec §9).
 * Kept in one place so every screen that makes the same change refreshes the
 * same things.
 */

/**
 * Your own membership and permissions. Several admin actions can change what you
 * may do (transfer, editing a role you hold). Membership first: the permission
 * loader reads it.
 */
export async function refreshMyAccess(workspaceId: string): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: queryKeys.membership(workspaceId) });
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.permissions(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.me }),
  ]);
  // Clearance and knowledge-base grants follow roles (Phase 3 §10.4).
  await invalidateKnowledgeAccess(workspaceId);
}

/** E39–E43: a member's profile, roles or status changed. */
export function invalidateMembers(workspaceId: string): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.members(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.member(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.details(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.roleMemberCounts(workspaceId) }),
    // A removed member's grants stop working and leave the grant lists (Phase 3 §3.2).
    invalidateKnowledgeAccess(workspaceId),
  ]);
}

/** E46–E48 */
export function invalidateInvitations(workspaceId: string): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.invitations(workspaceId) });
}

/**
 * E52–E55: a role changed. Saving permissions or priority recomputes every
 * holder's permissions at once, possibly yours.
 */
export async function invalidateRoles(workspaceId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.roles(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.role(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.roleMemberCounts(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.members(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.member(workspaceId) }),
  ]);
  await refreshMyAccess(workspaceId);
}

/** E34–E36 */
export function invalidateIpRules(workspaceId: string): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.ipRules(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.details(workspaceId) }),
  ]);
}

/** E58–E59 */
export function invalidateApiKeys(workspaceId: string): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys(workspaceId) });
}

/** E32: ownership moved; your roles and the member list changed. */
export async function invalidateAfterTransfer(workspaceId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.details(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.members(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.member(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.roleMemberCounts(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces }),
  ]);
  await refreshMyAccess(workspaceId);
}

/**
 * E31 delete / E44 leave: the workspace is gone for this user. Call AFTER
 * navigating away, so the workspace gate isn't still mounted to refetch what we
 * drop here.
 */
export async function forgetWorkspace(workspaceId: string, slug: string): Promise<void> {
  if (storage.get(STORAGE_KEYS.lastWorkspace) === slug) storage.remove(STORAGE_KEYS.lastWorkspace);
  queryClient.removeQueries({ queryKey: queryKeys.ws(workspaceId) });
  clearWorkspaceBlock(workspaceId);
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.me }),
    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces }),
  ]);
}
