import { useOutletContext } from 'react-router';
import type { KnowledgeBase, Paginated, VaultDocument } from '@/lib/api/types';
import { queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';

/** What the drawer hands to its tabs. */
export interface DocumentOutletContext {
  document: VaultDocument;
  knowledgeBase: KnowledgeBase | undefined;
  close: () => void;
}

export function useDocumentContext(): DocumentOutletContext {
  return useOutletContext<DocumentOutletContext>();
}

/** The document as last seen in any cached page of the vault, to open the drawer instantly. */
export function findCachedDocument(workspaceId: string, documentId: string): VaultDocument | undefined {
  const pages = queryClient.getQueriesData<Paginated<VaultDocument>>({ queryKey: queryKeys.documents(workspaceId) });
  for (const [, page] of pages) {
    const found = page?.items.find((document) => document.id === documentId);
    if (found) return found;
  }
  return undefined;
}
