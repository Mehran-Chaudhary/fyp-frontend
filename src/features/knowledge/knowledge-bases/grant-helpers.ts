import { useNavigate } from 'react-router';
import { hasCode } from '@/lib/api/errors';
import type { KnowledgeBase, KnowledgeBaseGrant } from '@/lib/api/types';
import { atLeast } from '@/lib/knowledge/access';
import { knowledgeBaseQuery, queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast } from '@/lib/toast';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { ACCESS_LEVEL_META } from '../shared/meta';

/** A grant's `subjectLabel` (role name, member name, or "key name (prefix)"), with a fallback. */
export function grantLabel(grant: Pick<KnowledgeBaseGrant, 'subjectLabel' | 'subjectType'>): string {
  return grant.subjectLabel ?? (grant.subjectType === 'ROLE' ? 'This role' : grant.subjectType === 'MEMBER' ? 'This member' : 'This API key');
}

/**
 * After changing a grant that concerns you (spec §5 "Access tab"): read the base
 * again. Gone (404) → say so and leave; still visible below Manage → say what's left.
 */
export function useRecheckOwnAccess(knowledgeBase: Pick<KnowledgeBase, 'id' | 'name'>) {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  return async () => {
    try {
      const fresh = await queryClient.fetchQuery({ ...knowledgeBaseQuery(workspace.id, knowledgeBase.id), staleTime: 0 });
      if (!atLeast(fresh.access, 'MANAGE')) {
        toast.info(`You now have ${ACCESS_LEVEL_META[fresh.access].label} access to ${knowledgeBase.name}`, {
          description: 'Only its managers or the workspace owner can change who has access.',
        });
      }
    } catch (error) {
      if (!hasCode(error, 'KNOWLEDGE_BASE_NOT_FOUND')) return;
      toast.info(`You no longer have access to ${knowledgeBase.name}`, {
        description: 'Only another manager or the workspace owner can give it back.',
      });
      queryClient.removeQueries({ queryKey: queryKeys.knowledgeBaseDetail(workspace.id, knowledgeBase.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBases(workspace.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ragScope(workspace.id) });
      void navigate(`/w/${workspace.slug}/knowledge-bases`, { replace: true });
    }
  };
}
