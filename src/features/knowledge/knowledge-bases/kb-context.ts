import { useOutletContext } from 'react-router';
import type { KnowledgeBase } from '@/lib/api/types';
import { queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';

export interface KnowledgeBaseOutletContext {
  knowledgeBase: KnowledgeBase;
}

export function useKnowledgeBaseContext(): KnowledgeBaseOutletContext {
  return useOutletContext<KnowledgeBaseOutletContext>();
}

/** The base as last seen in the shared list, to open its page instantly. */
export function findCachedKnowledgeBase(workspaceId: string, knowledgeBaseId: string): KnowledgeBase | undefined {
  const lists = queryClient.getQueriesData<KnowledgeBase[] | { items: KnowledgeBase[] }>({ queryKey: queryKeys.knowledgeBases(workspaceId) });
  for (const [, data] of lists) {
    const items = Array.isArray(data) ? data : data?.items;
    const found = items?.find((knowledgeBase) => knowledgeBase.id === knowledgeBaseId);
    if (found) return found;
  }
  return undefined;
}
