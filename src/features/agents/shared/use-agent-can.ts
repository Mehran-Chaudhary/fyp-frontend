import { useMemo } from 'react';
import { agentCapabilities, type AgentCapabilities } from '@/lib/agents/capabilities';
import { useWorkspace } from '@/features/workspaces/workspace-context';

/** Phase 4 capabilities in the active workspace (spec §3.7: compute once, use everywhere). */
export function useAgentCan(): AgentCapabilities {
  const { permissions } = useWorkspace();
  return useMemo(() => agentCapabilities(permissions), [permissions]);
}
