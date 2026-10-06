import { useMutation } from '@tanstack/react-query';
import { conversationsApi } from '@/lib/api/endpoints';
import { hasCode, isOutcomeUnknown } from '@/lib/api/errors';
import type { Conversation, UpdateConversationInput } from '@/lib/api/types';
import { afterConversationGone, afterConversationUpdated, patchConversationInLists } from '@/lib/agents/cache';
import { queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { useWorkspace } from '@/features/workspaces/workspace-context';

/**
 * Rename, archive and delete (P4-API-15/16). Pessimistic; a lost answer is
 * settled by reading the conversation back, never by repeating the call.
 */
export function useConversationActions() {
  const workspace = useWorkspace();

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateConversationInput }) => conversationsApi.update(workspace.id, id, body),
    onSuccess: (conversation: Conversation) => {
      patchConversationInLists(workspace.id, conversation);
      void afterConversationUpdated(workspace.id, conversation);
    },
    onError: (error, { id }) => {
      if (hasCode(error, 'CONVERSATION_NOT_FOUND')) void afterConversationGone(workspace.id, id);
      else if (isOutcomeUnknown(error)) void queryClient.invalidateQueries({ queryKey: queryKeys.conversationDetail(workspace.id, id) });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => conversationsApi.remove(workspace.id, id),
    onSuccess: (_result, id) => void afterConversationGone(workspace.id, id),
    onError: (error, id) => {
      // Already gone (a second delete answers 404): the same end state.
      if (hasCode(error, 'CONVERSATION_NOT_FOUND')) void afterConversationGone(workspace.id, id);
      else if (isOutcomeUnknown(error)) void queryClient.invalidateQueries({ queryKey: queryKeys.conversations(workspace.id) });
    },
  });

  return { update, remove };
}
