import { useMutation } from '@tanstack/react-query';
import { workspaceApi } from '@/lib/api/endpoints';
import type { UpdateOrganizationRequest } from '@/lib/api/types';
import { invalidateKnowledgeAccess } from '@/lib/knowledge/cache';
import { queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { useWorkspace } from '@/features/workspaces/workspace-context';

/**
 * E30. Stores the returned workspace; a rename also refreshes the membership
 * list, which is where the sidebar and the switcher read the name from.
 */
export function useUpdateWorkspace() {
  const workspace = useWorkspace();
  return useMutation({
    mutationFn: (body: UpdateOrganizationRequest) => workspaceApi.update(workspace.id, body),
    onSuccess: (organization, body) => {
      queryClient.setQueryData(queryKeys.details(workspace.id), organization);
      if (body.name !== undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.me });
        void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      }
      // Chunking defaults show as "inherited" values in the knowledge-base form (Phase 3 §10.4).
      if (body.settings !== undefined) void invalidateKnowledgeAccess(workspace.id);
    },
  });
}
