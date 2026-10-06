import type { KnowledgeBase, Paginated, PiiPolicy, VaultDocument } from '../api/types';
import { queryKeys } from '../queries';
import { queryClient } from '../query-client';
import { isInProgress } from './status';

/**
 * What to refetch or evict after each knowledge change (Phase 3 spec §9.4). Kept in
 * one place so every screen that makes the same change refreshes the same things.
 * Access, classification and deletion are never optimistic: these run after the
 * server confirmed.
 */

const invalidate = (queryKey: readonly unknown[]) => queryClient.invalidateQueries({ queryKey });

/** P3-API-02: a new base. */
export function afterKnowledgeBaseCreated(workspaceId: string, created: KnowledgeBase): Promise<unknown> {
  queryClient.setQueryData(queryKeys.knowledgeBaseDetail(workspaceId, created.id), created);
  return Promise.all([invalidate(queryKeys.knowledgeBases(workspaceId)), invalidate(queryKeys.ragScope(workspaceId))]);
}

/** P3-API-04: store the answer; base list, detail and the access scope move with it. */
export function afterKnowledgeBaseUpdated(
  workspaceId: string,
  updated: KnowledgeBase,
  previous: Pick<KnowledgeBase, 'accessMode'> | undefined,
): Promise<unknown> {
  queryClient.setQueryData(queryKeys.knowledgeBaseDetail(workspaceId, updated.id), updated);
  const modeChanged = !!previous && previous.accessMode !== updated.accessMode;
  return Promise.all([
    invalidate(queryKeys.knowledgeBases(workspaceId)),
    invalidate(queryKeys.ragScope(workspaceId)),
    modeChanged ? invalidate(queryKeys.documents(workspaceId)) : null,
    // Switching to RESTRICTED granted you MANAGE: the grant list has a new row.
    modeChanged ? invalidate(queryKeys.knowledgeBaseGrants(workspaceId, updated.id)) : null,
  ]);
}

/** P3-API-05: the base and every document of it are gone. Call after leaving its page. */
export function afterKnowledgeBaseDeleted(workspaceId: string, knowledgeBaseId: string): Promise<unknown> {
  // Documents of the base that are cached anywhere: drop them with their chunks and reports.
  const doomed = new Set<string>();
  for (const [, data] of queryClient.getQueriesData<VaultDocument>({ queryKey: queryKeys.document(workspaceId) })) {
    if (data && typeof data === 'object' && 'knowledgeBaseId' in data && data.knowledgeBaseId === knowledgeBaseId) {
      doomed.add(data.id);
    }
  }
  for (const [, page] of queryClient.getQueriesData<Paginated<VaultDocument>>({ queryKey: queryKeys.documents(workspaceId) })) {
    for (const document of page?.items ?? []) if (document.knowledgeBaseId === knowledgeBaseId) doomed.add(document.id);
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

/** P3-API-07 / P3-API-08: your own access may have changed with the grant. */
export function afterGrantsChanged(workspaceId: string, knowledgeBaseId: string): Promise<unknown> {
  return Promise.all([
    invalidate(queryKeys.knowledgeBaseGrants(workspaceId, knowledgeBaseId)),
    invalidate(queryKeys.knowledgeBaseDetail(workspaceId, knowledgeBaseId)),
    invalidate(queryKeys.knowledgeBases(workspaceId)),
    invalidate(queryKeys.ragScope(workspaceId)),
    invalidate(queryKeys.documents(workspaceId)),
  ]);
}

/** P3-API-09: new rows in the table, new counts in the stats. Polling starts from the list. */
export function afterUpload(workspaceId: string): Promise<unknown> {
  return Promise.all([invalidate(queryKeys.documents(workspaceId)), invalidate(queryKeys.knowledgeBases(workspaceId))]);
}

/** Replaces a document in every cached list page, so the table changes before the refetch. */
function patchDocumentInLists(workspaceId: string, document: VaultDocument): void {
  queryClient.setQueriesData<Paginated<VaultDocument>>({ queryKey: queryKeys.documents(workspaceId) }, (page) =>
    page ? { ...page, items: page.items.map((item) => (item.id === document.id ? document : item)) } : page,
  );
}

/** P3-API-14: edit or reclassify. A reclassification changes who counts it and what the report shows. */
export function afterDocumentUpdated(workspaceId: string, document: VaultDocument): Promise<unknown> {
  queryClient.setQueryData(queryKeys.documentDetail(workspaceId, document.id), document);
  patchDocumentInLists(workspaceId, document);
  return Promise.all([
    invalidate(queryKeys.documents(workspaceId)),
    invalidate(queryKeys.knowledgeBases(workspaceId)),
    invalidate(queryKeys.documentPiiReport(workspaceId, document.id)),
  ]);
}

/** P3-API-15: reindex or retry; the status restarts at UPLOADED and polling picks it up. */
export function afterReindex(workspaceId: string, document: VaultDocument): Promise<unknown> {
  queryClient.setQueryData(queryKeys.documentDetail(workspaceId, document.id), document);
  patchDocumentInLists(workspaceId, document);
  return Promise.all([invalidate(queryKeys.documents(workspaceId)), invalidate(queryKeys.knowledgeBases(workspaceId))]);
}

/** P3-API-16, or any 404 on a document: it's gone for this user. Evict detail, chunks and report. */
export function afterDocumentGone(workspaceId: string, documentId: string): Promise<unknown> {
  queryClient.removeQueries({ queryKey: queryKeys.documentDetail(workspaceId, documentId) });
  queryClient.setQueriesData<Paginated<VaultDocument>>({ queryKey: queryKeys.documents(workspaceId) }, (page) =>
    page ? { ...page, items: page.items.filter((item) => item.id !== documentId) } : page,
  );
  return Promise.all([invalidate(queryKeys.documents(workspaceId)), invalidate(queryKeys.knowledgeBases(workspaceId))]);
}

/**
 * A poll showed documents leaving the in-progress states (spec §9.3): the stats
 * changed, and their detail, chunks and report are a new version (or none).
 */
export function afterProcessingSettled(workspaceId: string, documentIds: readonly string[]): Promise<unknown> {
  return Promise.all([
    invalidate(queryKeys.knowledgeBases(workspaceId)),
    ...documentIds.flatMap((documentId) => [
      invalidate(queryKeys.documentDetail(workspaceId, documentId)),
      invalidate(queryKeys.documentChunks(workspaceId, documentId)),
      invalidate(queryKeys.documentPiiReport(workspaceId, documentId)),
    ]),
  ]);
}

/**
 * P3-API-18: the new policy applies to the next request everywhere. Entity types
 * carry `enabled` flags, and every open redaction report was masked the old way.
 */
export function afterPolicyUpdated(workspaceId: string, policy: PiiPolicy): Promise<unknown> {
  queryClient.setQueryData(queryKeys.piiPolicy(workspaceId), policy);
  return Promise.all([
    invalidate(queryKeys.piiEntityTypes(workspaceId)),
    queryClient.invalidateQueries({
      queryKey: queryKeys.document(workspaceId),
      predicate: (query) => query.queryKey.includes('pii-report'),
    }),
  ]);
}

/**
 * Phase 2 role or member changes and workspace settings: clearance and grants may
 * have moved, so everything the knowledge layer filters by access is stale.
 */
export function invalidateKnowledgeAccess(workspaceId: string): Promise<unknown> {
  return Promise.all([
    invalidate(queryKeys.knowledgeBases(workspaceId)),
    invalidate(queryKeys.knowledgeBase(workspaceId)),
    invalidate(queryKeys.ragScope(workspaceId)),
    invalidate(queryKeys.documents(workspaceId)),
    invalidate(queryKeys.document(workspaceId)),
    invalidate(queryKeys.pii(workspaceId)),
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
