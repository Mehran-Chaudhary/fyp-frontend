import { useMutation } from '@tanstack/react-query';
import { workspaceApi } from '@/lib/api/endpoints';
import { isOutcomeUnknown } from '@/lib/api/errors';
import type { UpdateOrganizationRequest } from '@/lib/api/types';
import { invalidateKnowledgeAccess } from '@/lib/knowledge/cache';
import { queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { invalidateAfterPolicyChange } from '@/lib/workspace/cache';
import { useWorkspace } from '@/features/workspaces/workspace-context';

const POLICY_KEYS = ['requireMfa', 'requireVerifiedEmail', 'allowedEmailDomains'] as const;

/**
 * P2-API-01. Stores the returned workspace (the server's merged settings, never
 * our guess). A rename refreshes the switcher; a policy change also re-reads your
 * own contextual access (spec §8). The workspace id is captured when the change is
 * sent, so the answer only ever lands in that workspace's cache.
 */
export function useUpdateWorkspace() {
  const workspace = useWorkspace();
  const workspaceId = workspace.id;
  return useMutation({
    mutationFn: (body: UpdateOrganizationRequest) => workspaceApi.update(workspaceId, body),
    onSuccess: (organization, body) => {
      queryClient.setQueryData(queryKeys.details(workspaceId), organization);
      if (body.name !== undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.me });
        void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      }
      if (body.settings && POLICY_KEYS.some((key) => key in body.settings!)) {
        void invalidateAfterPolicyChange(workspaceId);
      }
      // Chunking defaults show as "inherited" values in the knowledge-base form (Phase 3).
      if (body.settings !== undefined) void invalidateKnowledgeAccess(workspaceId);
    },
    onError: (error) => {
      // It may have been saved: show what the server holds now.
      if (isOutcomeUnknown(error)) void queryClient.invalidateQueries({ queryKey: queryKeys.details(workspaceId) });
    },
  });
}
