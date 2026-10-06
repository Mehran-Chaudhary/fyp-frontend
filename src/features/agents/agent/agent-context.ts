import { useOutletContext } from 'react-router';
import type { Agent } from '@/lib/api/types';

/** What the agent layout hands its tabs: the agent as the server last returned it. */
export interface AgentOutletContext {
  agent: Agent;
  /** True while a background refetch is running. */
  refreshing: boolean;
  /** Opens the publish confirmation, when you may publish this agent. */
  requestPublish: (() => void) | null;
}

export function useAgentOutlet(): AgentOutletContext {
  return useOutletContext<AgentOutletContext>();
}
