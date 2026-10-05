import { invalidateKnowledgeAccess } from '../knowledge/cache';
import { meQuery, queryKeys } from '../queries';
import { queryClient } from '../query-client';
import { lastWorkspace } from '../storage';
import { clearAllWorkspaceBlocks, clearWorkspaceBlock } from '../workspace-blocks';

/**
 * What to refetch after each kind of administrative change (Phase 2 spec §9).
 * Kept in one place so every screen that makes the same change refreshes the
 * same things.
 */

/**
 * Your own membership and permissions. Several admin actions can change what you
 * may do (transfer, editing a role you hold): re-read the contextual identity.
 */
export async function refreshMyAccess(workspaceId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.membership(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.context(workspaceId) }),
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
export async function forgetWorkspace(workspaceId: string): Promise<void> {
  const userId = queryClient.getQueryData(meQuery.queryKey)?.id;
  if (userId) lastWorkspace.clear(userId, workspaceId);
  queryClient.removeQueries({ queryKey: queryKeys.ws(workspaceId) });
  queryClient.removeQueries({ queryKey: ['workspace-ref'] });
  clearWorkspaceBlock(workspaceId);
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.me }),
    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces }),
  ]);
}

/**
 * Your account's security changed (MFA turned on or off, email verified): every
 * workspace re-checks its policies against the new state on next use, and any
 * block it recorded is lifted until then.
 */
export async function revalidateWorkspaceAccess(): Promise<void> {
  clearAllWorkspaceBlocks();
  queryClient.removeQueries({ queryKey: ['workspace-ref'] });
  await queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] === 'ws' && query.queryKey[2] === 'context',
  });
}
