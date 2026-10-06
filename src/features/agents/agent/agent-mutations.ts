import { useMutation } from '@tanstack/react-query';
import { agentsApi } from '@/lib/api/endpoints';
import { hasCode, isOutcomeUnknown } from '@/lib/api/errors';
import type { Agent } from '@/lib/api/types';
import { afterAgentGone, afterAgentPublication } from '@/lib/agents/cache';
import { queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { useWorkspace } from '@/features/workspaces/workspace-context';

/**
 * Publish, unpublish and delete (P4-API-05/06/07). Pessimistic: the cache changes
 * only after the server confirmed. Publication is idempotent, so a lost answer is
 * settled by reading the agent back; a delete is checked the same way.
 */
export function useAgentLifecycle(agentId: string) {
  const workspace = useWorkspace();
  const reread = () => queryClient.invalidateQueries({ queryKey: queryKeys.agentDetail(workspace.id, agentId) });

  const onError = (error: unknown) => {
    if (hasCode(error, 'AGENT_NOT_FOUND')) void afterAgentGone(workspace.id, agentId);
    else if (isOutcomeUnknown(error)) void reread();
  };

  const publish = useMutation({
    mutationFn: () => agentsApi.publish(workspace.id, agentId),
    onSuccess: (agent: Agent) => void afterAgentPublication(workspace.id, agent),
    onError,
  });
  const unpublish = useMutation({
    mutationFn: () => agentsApi.unpublish(workspace.id, agentId),
    onSuccess: (agent: Agent) => void afterAgentPublication(workspace.id, agent),
    onError,
  });
  const remove = useMutation({
    mutationFn: () => agentsApi.remove(workspace.id, agentId),
    onError,
  });
  return { publish, unpublish, remove };
}
