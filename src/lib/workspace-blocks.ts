import { create } from 'zustand';
import type { ApiError } from './api/errors';

/**
 * Workspace access problems reported by ANY workspace-scoped request (spec §7.11):
 * an admin may enable "require MFA" or suspend a membership while someone is
 * working. The workspace gate reads this and switches to the matching state.
 */
interface WorkspaceBlocksState {
  blocks: Record<string, ApiError>;
}

export const useWorkspaceBlocks = create<WorkspaceBlocksState>(() => ({ blocks: {} }));

export function blockWorkspace(workspaceId: string, error: ApiError): void {
  useWorkspaceBlocks.setState((state) => ({ blocks: { ...state.blocks, [workspaceId]: error } }));
}

export function clearWorkspaceBlock(workspaceId: string): void {
  if (!useWorkspaceBlocks.getState().blocks[workspaceId]) return;
  useWorkspaceBlocks.setState((state) => {
    const next = { ...state.blocks };
    delete next[workspaceId];
    return { blocks: next };
  });
}
