import type { InfiniteData } from '@tanstack/react-query';
import { conversationsApi } from '../api/endpoints';
import type { Agent, Conversation, LlmPolicy, Message, MessagePage, Paginated } from '../api/types';
import { queryKeys } from '../queries';
import { queryClient } from '../query-client';
import { withMessages } from './messages';

/**
 * What to refresh or evict after each Phase 4 change (spec §9.5), in one place so
 * every screen that makes the same change refreshes the same things. Agent
 * configuration, publication, policy and deletion are pessimistic: these run after
 * the server confirmed.
 */

const invalidate = (queryKey: readonly unknown[]) => queryClient.invalidateQueries({ queryKey });

/** P4-API-02 / 04 / 10: create, update, restore. Store the answer; lists and history move with it. */
export function afterAgentSaved(workspaceId: string, agent: Agent, previousVersion?: number): Promise<unknown> {
  queryClient.setQueryData(queryKeys.agentDetail(workspaceId, agent.id), agent);
  return Promise.all([
    invalidate(queryKeys.agents(workspaceId)),
    previousVersion === undefined || previousVersion !== agent.currentVersion
      ? invalidate(queryKeys.agentVersions(workspaceId, agent.id))
      : null,
  ]);
}

/** P4-API-06 / 07: publication changes who sees it, not its versions. */
export function afterAgentPublication(workspaceId: string, agent: Agent): Promise<unknown> {
  queryClient.setQueryData(queryKeys.agentDetail(workspaceId, agent.id), agent);
  return invalidate(queryKeys.agents(workspaceId));
}

/**
 * P4-API-05, or any 404 on an agent: it's gone for this user. Its conversations
 * remain (with `agentName` kept), so only the agent's own entries are evicted.
 */
export function afterAgentGone(workspaceId: string, agentId: string): Promise<unknown> {
  queryClient.removeQueries({ queryKey: queryKeys.agentDetail(workspaceId, agentId) });
  return Promise.all([invalidate(queryKeys.agents(workspaceId)), invalidate(queryKeys.conversations(workspaceId))]);
}

/** P4-API-24: the policy applies to the next request everywhere; `allowed` flags and pickers follow. */
export function afterLlmPolicyUpdated(workspaceId: string, policy: LlmPolicy): Promise<unknown> {
  queryClient.setQueryData(queryKeys.llmPolicy(workspaceId), policy);
  return Promise.all([invalidate(queryKeys.llmModels(workspaceId)), invalidate(queryKeys.agent(workspaceId))]);
}

/** P4-API-13: a new conversation tops the list. */
export function afterConversationCreated(workspaceId: string, conversation: Conversation): Promise<unknown> {
  queryClient.setQueryData(queryKeys.conversationDetail(workspaceId, conversation.id), conversation);
  return invalidate(queryKeys.conversations(workspaceId));
}

/** P4-API-15: rename, archive, unarchive. */
export function afterConversationUpdated(workspaceId: string, conversation: Conversation): Promise<unknown> {
  queryClient.setQueryData(queryKeys.conversationDetail(workspaceId, conversation.id), conversation);
  return invalidate(queryKeys.conversations(workspaceId));
}

/** P4-API-16, or a 404 on a conversation: evict it and its messages. */
export function afterConversationGone(workspaceId: string, conversationId: string): Promise<unknown> {
  queryClient.removeQueries({ queryKey: queryKeys.conversationDetail(workspaceId, conversationId) });
  return invalidate(queryKeys.conversations(workspaceId));
}

/**
 * A turn finished or was reconciled: put the stored messages into the newest page
 * at once (no flash), then refresh the conversation (count, title, classification)
 * and the lists. The whole history isn't refetched: older pages didn't change.
 */
export function afterTurnSettled(workspaceId: string, conversationId: string, stored: readonly Message[]): Promise<unknown> {
  if (stored.length) {
    queryClient.setQueryData<InfiniteData<MessagePage, number | undefined>>(
      queryKeys.conversationMessages(workspaceId, conversationId),
      (data) => (data && data.pages.length ? { ...data, pages: [withMessages(data.pages[0], stored), ...data.pages.slice(1)] } : data),
    );
  }
  return Promise.all([
    invalidate(queryKeys.conversationDetail(workspaceId, conversationId)),
    invalidate(queryKeys.conversations(workspaceId)),
    // `lastUsedAt` on the agent's card.
    invalidate(queryKeys.agents(workspaceId)),
  ]);
}

/** Re-reads only the newest page of a conversation's history (reconciliation, §9.4). */
export async function refetchNewestPage(workspaceId: string, conversationId: string): Promise<Message[]> {
  const key = queryKeys.conversationMessages(workspaceId, conversationId);
  const page = await conversationsApi.messages(workspaceId, conversationId, { limit: 50 });
  queryClient.setQueryData<InfiniteData<MessagePage, number | undefined>>(key, (data) =>
    data && data.pages.length
      ? { ...data, pages: [{ ...page, messages: withMessages(data.pages[0], page.messages).messages }, ...data.pages.slice(1)] }
      : data,
  );
  return page.messages;
}

/** Replace one conversation in every cached list page, plain or infinite (archive state shows at once). */
export function patchConversationInLists(workspaceId: string, conversation: Conversation): void {
  const swap = (page: Paginated<Conversation>): Paginated<Conversation> => ({
    ...page,
    items: page.items.map((item) => (item.id === conversation.id ? conversation : item)),
  });
  queryClient.setQueriesData<Paginated<Conversation> | InfiniteData<Paginated<Conversation>>>(
    { queryKey: queryKeys.conversations(workspaceId) },
    (data) => {
      if (!data) return data;
      if ('pages' in data) return { ...data, pages: data.pages.map(swap) };
      return Array.isArray(data.items) ? swap(data) : data;
    },
  );
}

/**
 * Phase 3 changes that move labels (a document deleted or reclassified, grants,
 * roles): open message pages may now withhold messages (§9.5 last row).
 */
export function invalidateConversationLabels(workspaceId: string): Promise<unknown> {
  return Promise.all([invalidate(queryKeys.conversation(workspaceId)), invalidate(queryKeys.conversations(workspaceId))]);
}
