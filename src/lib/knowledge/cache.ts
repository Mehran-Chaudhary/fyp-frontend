import type { Paginated, VaultDocument, KnowledgeBase } from '../api/types';
import { queryKeys } from '../queries';
import { queryClient } from '../query-client';
import { isInProgress } from './status';

/**
 * What to refetch after each knowledge change (Phase 3 spec §10.4). Kept in one
 * place so every screen that makes the same change refreshes the same things.
 */

const invalidate = (queryKey: readonly unknown[]) => queryClient.invalidateQueries({ queryKey });

/** E61: a new base. */
export function afterKnowledgeBaseCreated(workspaceId: string, created: KnowledgeBase): Promise<unknown> {
  queryClient.setQueryData(queryKeys.knowledgeBaseDetail(workspaceId, created.id), created);
  return Promise.all([invalidate(queryKeys.knowledgeBases(workspaceId)), invalidate(queryKeys.ragScope(workspaceId))]);
}

/** E63: store the answer; the access mode decides what else moved. */
export function afterKnowledgeBaseUpdated(
  workspaceId: string,
  updated: KnowledgeBase,
  previous: Pick<KnowledgeBase, 'accessMode'> | undefined,
): Promise<unknown> {
  queryClient.setQueryData(queryKeys.knowledgeBaseDetail(workspaceId, updated.id), updated);
  const modeChanged = !!previous && previous.accessMode !== updated.accessMode;
  return Promise.all([
    invalidate(queryKeys.knowledgeBases(workspaceId)),
    modeChanged ? invalidate(queryKeys.ragScope(workspaceId)) : null,
    modeChanged ? invalidate(queryKeys.documents(workspaceId)) : null,
    updated.accessMode === 'RESTRICTED' ? invalidate(queryKeys.knowledgeBaseGrants(workspaceId, updated.id)) : null,
  ]);
}

/** E64: the base and every document of it are gone. Call after leaving its page. */
export function afterKnowledgeBaseDeleted(workspaceId: string, knowledgeBaseId: string): Promise<unknown> {
  // Documents of the base that are cached anywhere: drop them with their chunks and reports.
  const doomed = new Set<string>();
  for (const [, data] of queryClient.getQueriesData<VaultDocument>({ queryKey: queryKeys.document(workspaceId) })) {
    if (data && typeof data === 'object' && 'knowledgeBaseId' in data && data.knowledgeBaseId === knowledgeBaseId) {
      doomed.add(data.id);
    }
  }
  for (const documentId of doomed) queryClient.removeQueries({ queryKey: queryKeys.documentDetail(workspaceId, documentId) });
  queryClient.removeQueries({ queryKey: queryKeys.knowledgeBaseDetail(workspaceId, knowledgeBaseId) });
  // Drop its rows from the vault's pages right away; the refetch confirms it.
  queryClient.setQueriesData<Paginated<VaultDocument>>({ queryKey: queryKeys.documents(workspaceId) }, (page) =>
    page ? { ...page, items: page.items.filter((document) => document.knowledgeBaseId !== knowledgeBaseId) } : page,
  );
  return Promise.all([
    invalidate(queryKeys.knowledgeBases(workspaceId)),
    invalidate(queryKeys.documents(workspaceId)),
    invalidate(queryKeys.ragScope(workspaceId)),
  ]);
}

/** E66 / E67: your own access may have changed with the grant. */
export function afterGrantsChanged(workspaceId: string, knowledgeBaseId: string): Promise<unknown> {
  return Promise.all([
    invalidate(queryKeys.knowledgeBaseGrants(workspaceId, knowledgeBaseId)),
    invalidate(queryKeys.knowledgeBaseDetail(workspaceId, knowledgeBaseId)),
    invalidate(queryKeys.knowledgeBases(workspaceId)),
    invalidate(queryKeys.ragScope(workspaceId)),
    invalidate(queryKeys.documents(workspaceId)),
  ]);
}

/** E68: new rows in the table, new counts in the stats. */
export function afterUpload(workspaceId: string): Promise<unknown> {
  return Promise.all([invalidate(queryKeys.documents(workspaceId)), invalidate(queryKeys.knowledgeBases(workspaceId))]);
}

/** Replaces a document in every cached list page, so the table changes before the refetch. */
function patchDocumentInLists(workspaceId: string, document: VaultDocument): void {
  queryClient.setQueriesData<Paginated<VaultDocument>>({ queryKey: queryKeys.documents(workspaceId) }, (page) =>
    page ? { ...page, items: page.items.map((item) => (item.id === document.id ? document : item)) } : page,
  );
}

/** E73: edit or reclassify. A reclassification changes who counts it and what the report shows. */
export function afterDocumentUpdated(workspaceId: string, document: VaultDocument): Promise<unknown> {
  queryClient.setQueryData(queryKeys.documentDetail(workspaceId, document.id), document);
  patchDocumentInLists(workspaceId, document);
  return Promise.all([
    invalidate(queryKeys.documents(workspaceId)),
    invalidate(queryKeys.knowledgeBases(workspaceId)),
    invalidate(queryKeys.documentPiiReport(workspaceId, document.id)),
  ]);
}

/** E74: reindex or retry; the status restarts at UPLOADED and polling picks it up. */
export function afterReindex(workspaceId: string, document: VaultDocument): Promise<unknown> {
  queryClient.setQueryData(queryKeys.documentDetail(workspaceId, document.id), document);
  patchDocumentInLists(workspaceId, document);
  return Promise.all([invalidate(queryKeys.documents(workspaceId)), invalidate(queryKeys.knowledgeBases(workspaceId))]);
}

/** E75, or any 404 on a document: it's gone for this user. */
export function afterDocumentGone(workspaceId: string, documentId: string): Promise<unknown> {
  queryClient.removeQueries({ queryKey: queryKeys.documentDetail(workspaceId, documentId) });
  queryClient.setQueriesData<Paginated<VaultDocument>>({ queryKey: queryKeys.documents(workspaceId) }, (page) =>
    page ? { ...page, items: page.items.filter((item) => item.id !== documentId) } : page,
  );
  return Promise.all([invalidate(queryKeys.documents(workspaceId)), invalidate(queryKeys.knowledgeBases(workspaceId))]);
}

/**
 * A poll showed documents leaving the in-progress states: the stats changed, and
 * their chunks now exist (or are a new version).
 */
export function afterProcessingSettled(workspaceId: string, documentIds: readonly string[]): Promise<unknown> {
  return Promise.all([
    invalidate(queryKeys.knowledgeBases(workspaceId)),
    ...documentIds.flatMap((documentId) => [
      invalidate(queryKeys.documentChunks(workspaceId, documentId)),
      invalidate(queryKeys.documentPiiReport(workspaceId, documentId)),
    ]),
  ]);
}

/**
 * Phase 2 role or member changes and E30 settings: clearance and grants may have
 * moved, so everything the knowledge layer filters by access is stale.
 */
export function invalidateKnowledgeAccess(workspaceId: string): Promise<unknown> {
  return Promise.all([
    invalidate(queryKeys.knowledgeBases(workspaceId)),
    invalidate(queryKeys.knowledgeBase(workspaceId)),
    invalidate(queryKeys.ragScope(workspaceId)),
    invalidate(queryKeys.documents(workspaceId)),
  ]);
}

/** Ids of documents that were processing in `before` and aren't in `after`. */
export function settledDocuments(
  before: ReadonlyMap<string, VaultDocument['status']>,
  after: readonly Pick<VaultDocument, 'id' | 'status'>[],
): string[] {
  return after
    .filter((document) => {
      const previous = before.get(document.id);
      return previous !== undefined && isInProgress(previous) && !isInProgress(document.status);
    })
    .map((document) => document.id);
}
