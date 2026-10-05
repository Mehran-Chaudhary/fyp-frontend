import { create } from 'zustand';
import type { ApiError } from './api/errors';

/**
 * Workspace access problems reported by ANY workspace-scoped request (Phase 1
 * spec §11): an admin may require MFA, restrict networks or suspend a membership
 * while someone is working. The workspace gate reads this and switches to the
 * matching recovery state; the global account stays usable.
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

/** Sign-out, another account, or a credential change that may lift every block (MFA turned on). */
export function clearAllWorkspaceBlocks(): void {
  if (Object.keys(useWorkspaceBlocks.getState().blocks).length === 0) return;
  useWorkspaceBlocks.setState({ blocks: {} });
}
