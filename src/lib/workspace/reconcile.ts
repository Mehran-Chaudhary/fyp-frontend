import { organizationsApi } from '../api/endpoints';

/**
 * Whether a workspace is still among yours, read from the workspace-independent
 * list (P1-API-22). Used after a delete or leave whose answer was lost: a
 * workspace-scoped read would be refused once access ends, and that refusal alone
 * can't tell "deleted" from "you lost access" (spec P2-API-02, P2-API-15).
 */
export async function isWorkspaceStillListed(workspaceId: string, maxPages = 10): Promise<boolean> {
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await organizationsApi.list(page, 100);
    if (result.items.some((workspace) => workspace.id === workspaceId)) return true;
    if (!result.pagination.hasNextPage) return false;
  }
  // Too many workspaces to scan: assume it is still there and let the user decide.
  return true;
}
