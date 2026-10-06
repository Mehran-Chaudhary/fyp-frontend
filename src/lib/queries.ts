import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/react-query';
import {
  agentsApi,
  apiKeysApi,
  authApi,
  conversationsApi,
  documentsApi,
  invitationsApi,
  knowledgeBasesApi,
  llmApi,
  membersApi,
  organizationsApi,
  permissionsApi,
  piiApi,
  ragApi,
  rolesApi,
  workspaceApi,
} from './api/endpoints';
import type {
  AgentSummary,
  ConversationScope,
  CurrentUser,
  KnowledgeBase,
  ListAgentsParams,
  ListConversationsParams,
  ListDocumentsParams,
  ListInvitationsParams,
  ListKnowledgeBasesParams,
  ListMembersParams,
  MessagePage,
} from './api/types';
import { anyInProgress, processingPollInterval } from './knowledge/polling';
import { hashString } from './utils';

/**
 * Query keys (Phase 1 spec §5). Every workspace-scoped key starts with
 * ['ws', canonical UUID] so data can never leak from one workspace into another,
 * and leaving a workspace can drop all of it at once. Everything here belongs to
 * the signed-in user: the whole cache is cleared when the session ends or another
 * account signs in (lib/auth/session.ts).
 */
export const queryKeys = {
  /** Unscoped identity: profile and the first 100 memberships. */
  me: ['me'] as const,
  mfa: ['mfa'] as const,
  sessions: ['sessions'] as const,
  workspaces: ['workspaces'] as const,
  workspacesPage: (page: number) => ['workspaces', page] as const,
  workspacesInfinite: ['workspaces', 'infinite'] as const,
  /** A route's workspace reference (slug or UUID) resolved to the canonical UUID. */
  workspaceRef: (reference: string) => ['workspace-ref', reference] as const,
  /** Contextual identity: the workspace's access checks and your permissions in it. */
  context: (workspaceId: string) => ['ws', workspaceId, 'context'] as const,
  permissionCatalogue: ['permission-catalogue'] as const,
  /** Keyed by a hash: the link token itself stays out of the cache and devtools. */
  invitationPreview: (token: string) => ['invitation-preview', hashString(token)] as const,
  ws: (workspaceId: string) => ['ws', workspaceId] as const,
  membership: (workspaceId: string) => ['ws', workspaceId, 'membership'] as const,
  details: (workspaceId: string) => ['ws', workspaceId, 'details'] as const,
  /** Your permissions come with the contextual identity: the same entry. */
  permissions: (workspaceId: string) => ['ws', workspaceId, 'context'] as const,
  members: (workspaceId: string) => ['ws', workspaceId, 'members'] as const,
  membersList: (workspaceId: string, params: ListMembersParams) => ['ws', workspaceId, 'members', params] as const,
  member: (workspaceId: string) => ['ws', workspaceId, 'member'] as const,
  memberDetail: (workspaceId: string, memberId: string) => ['ws', workspaceId, 'member', memberId] as const,
  invitations: (workspaceId: string) => ['ws', workspaceId, 'invitations'] as const,
  invitationsList: (workspaceId: string, params: ListInvitationsParams) =>
    ['ws', workspaceId, 'invitations', params] as const,
  roles: (workspaceId: string) => ['ws', workspaceId, 'roles'] as const,
  role: (workspaceId: string) => ['ws', workspaceId, 'role'] as const,
  roleDetail: (workspaceId: string, roleId: string) => ['ws', workspaceId, 'role', roleId] as const,
  roleMemberCounts: (workspaceId: string) => ['ws', workspaceId, 'role-member-count'] as const,
  roleMemberCount: (workspaceId: string, roleId: string) => ['ws', workspaceId, 'role-member-count', roleId] as const,
  apiKeys: (workspaceId: string) => ['ws', workspaceId, 'api-keys'] as const,
  apiKeyScopes: (workspaceId: string) => ['ws', workspaceId, 'api-key-scopes'] as const,
  ipRules: (workspaceId: string) => ['ws', workspaceId, 'ip-rules'] as const,

  // ── Phase 3 (spec §9.1) ──
  knowledgeBases: (workspaceId: string) => ['ws', workspaceId, 'knowledge-bases'] as const,
  knowledgeBasesList: (workspaceId: string, params: ListKnowledgeBasesParams) =>
    ['ws', workspaceId, 'knowledge-bases', params] as const,
  /** Every base you can read, all pages: the sidebar, filters, names and statistics. */
  knowledgeBasesAll: (workspaceId: string) => ['ws', workspaceId, 'knowledge-bases', 'all'] as const,
  knowledgeBase: (workspaceId: string) => ['ws', workspaceId, 'knowledge-base'] as const,
  knowledgeBaseDetail: (workspaceId: string, knowledgeBaseId: string) =>
    ['ws', workspaceId, 'knowledge-base', knowledgeBaseId] as const,
  knowledgeBaseGrants: (workspaceId: string, knowledgeBaseId: string) =>
    ['ws', workspaceId, 'knowledge-base', knowledgeBaseId, 'grants'] as const,
  documents: (workspaceId: string) => ['ws', workspaceId, 'documents'] as const,
  documentsList: (workspaceId: string, params: ListDocumentsParams) => ['ws', workspaceId, 'documents', params] as const,
  document: (workspaceId: string) => ['ws', workspaceId, 'document'] as const,
  documentDetail: (workspaceId: string, documentId: string) => ['ws', workspaceId, 'document', documentId] as const,
  documentChunks: (workspaceId: string, documentId: string) =>
    ['ws', workspaceId, 'document', documentId, 'chunks'] as const,
  /** Keyed by the active version, so a finished reindex reads the new chunks (spec §9.1). */
  documentChunksPage: (workspaceId: string, documentId: string, activeIndexVersion: number | null, page: number) =>
    ['ws', workspaceId, 'document', documentId, 'chunks', activeIndexVersion, page] as const,
  documentPiiReport: (workspaceId: string, documentId: string) =>
    ['ws', workspaceId, 'document', documentId, 'pii-report'] as const,
  /** Keyed by the active version and the policy version: either changes what is masked. Never revealed pages. */
  documentPiiReportPage: (workspaceId: string, documentId: string, report: PiiReportKey) =>
    ['ws', workspaceId, 'document', documentId, 'pii-report', report] as const,
  ragScope: (workspaceId: string) => ['ws', workspaceId, 'rag-scope'] as const,
  pii: (workspaceId: string) => ['ws', workspaceId, 'pii'] as const,
  piiEntityTypes: (workspaceId: string) => ['ws', workspaceId, 'pii', 'types'] as const,
  piiPolicy: (workspaceId: string) => ['ws', workspaceId, 'pii', 'policy'] as const,

  // ── Phase 4 (spec §9.1) ──
  agents: (workspaceId: string) => ['ws', workspaceId, 'agents'] as const,
  agentsList: (workspaceId: string, params: ListAgentsParams) => ['ws', workspaceId, 'agents', 'list', params] as const,
  /** Every agent you can see, all pages: names for usage rows, pickers. */
  agentsAll: (workspaceId: string) => ['ws', workspaceId, 'agents', 'all'] as const,
  agent: (workspaceId: string) => ['ws', workspaceId, 'agent'] as const,
  agentDetail: (workspaceId: string, agentId: string) => ['ws', workspaceId, 'agent', agentId] as const,
  agentVersions: (workspaceId: string, agentId: string) => ['ws', workspaceId, 'agent', agentId, 'versions'] as const,
  agentVersionsPage: (workspaceId: string, agentId: string, page: number) =>
    ['ws', workspaceId, 'agent', agentId, 'versions', page] as const,
  /** Immutable: cached for the session. */
  agentVersion: (workspaceId: string, agentId: string, version: number) =>
    ['ws', workspaceId, 'agent', agentId, 'version', version] as const,
  conversations: (workspaceId: string) => ['ws', workspaceId, 'conversations'] as const,
  conversationsList: (workspaceId: string, scope: ConversationScope, filters: Omit<ListConversationsParams, 'scope'>) =>
    ['ws', workspaceId, 'conversations', scope, filters] as const,
  conversation: (workspaceId: string) => ['ws', workspaceId, 'conversation'] as const,
  conversationDetail: (workspaceId: string, conversationId: string) => ['ws', workspaceId, 'conversation', conversationId] as const,
  /** An infinite query keyed by `before`. Never revealed pages (§9.1). */
  conversationMessages: (workspaceId: string, conversationId: string) =>
    ['ws', workspaceId, 'conversation', conversationId, 'messages'] as const,
  llm: (workspaceId: string) => ['ws', workspaceId, 'llm'] as const,
  llmModels: (workspaceId: string) => ['ws', workspaceId, 'llm', 'models'] as const,
  llmPolicy: (workspaceId: string) => ['ws', workspaceId, 'llm', 'policy'] as const,
  llmUsage: (workspaceId: string, from: string, to: string) => ['ws', workspaceId, 'llm', 'usage', from, to] as const,
};

/** What a page of a document's redaction report depends on. */
export interface PiiReportKey {
  activeIndexVersion: number | null;
  policyVersion: number | null;
  page: number;
  limit: number;
}

export const meQuery = queryOptions({
  queryKey: queryKeys.me,
  queryFn: ({ signal }) => authApi.me(undefined, signal),
  staleTime: 60_000,
});

export const mfaQuery = queryOptions({
  queryKey: queryKeys.mfa,
  queryFn: ({ signal }) => authApi.mfaStatus(signal),
});

export const sessionsQuery = queryOptions({
  queryKey: queryKeys.sessions,
  queryFn: ({ signal }) => authApi.sessions(signal),
});

export const workspacesQuery = (page: number) =>
  queryOptions({
    queryKey: queryKeys.workspacesPage(page),
    queryFn: ({ signal }) => organizationsApi.list(page, 20, signal),
    placeholderData: keepPreviousData,
  });

/** Every workspace you belong to, a page at a time (the switcher). */
export const workspacesInfiniteQuery = infiniteQueryOptions({
  queryKey: queryKeys.workspacesInfinite,
  queryFn: ({ pageParam, signal }) => organizationsApi.list(pageParam, 20, signal),
  initialPageParam: 1,
  getNextPageParam: (last) => (last.pagination.hasNextPage ? last.pagination.page + 1 : undefined),
});

/** P2-API-20: workspace-independent, cached for the signed-in session (cleared with it). */
export const permissionCatalogueQuery = queryOptions({
  queryKey: queryKeys.permissionCatalogue,
  queryFn: ({ signal }) => permissionsApi.catalogue(signal),
  staleTime: Infinity,
  gcTime: Infinity,
});

/** What the contextual identity call tells the workspace shell. */
export interface WorkspaceAccessContext {
  /** Canonical UUID. */
  id: string;
  /** Concrete keys, sorted; [] when the server omitted them (spec §5: never full access). */
  permissions: string[];
  user: CurrentUser;
}

export function toAccessContext(user: CurrentUser, requested: string): WorkspaceAccessContext {
  const permissions = Array.isArray(user.permissions)
    ? Array.from(new Set(user.permissions.filter((key) => typeof key === 'string'))).sort()
    : [];
  return { id: user.activeOrganizationId ?? requested, permissions, user };
}

/**
 * Contextual identity (P1-API-12 with X-Organization-Id): runs the workspace's
 * access checks and returns your permissions in it. Re-checked on focus because
 * roles and policies can change at any moment.
 */
export const contextQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.context(workspaceId),
    queryFn: async ({ signal }) => toAccessContext(await authApi.me(workspaceId, signal), workspaceId),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

/** A UUID in any version, as the backend's resolver accepts. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves a workspace slug that isn't among the embedded memberships to its
 * canonical UUID. The header accepts a slug, and the answer comes with the same
 * access checks as any contextual call. A slug never changes, so it is cached.
 */
export const workspaceRefQuery = (reference: string) =>
  queryOptions({
    queryKey: queryKeys.workspaceRef(reference),
    queryFn: async ({ signal }) => toAccessContext(await authApi.me(reference, signal), reference).id,
    staleTime: Infinity,
  });

/** Your own membership: role labels and rank. Optional (spec §5 step 5): never retried. */
export const membershipQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.membership(workspaceId),
    queryFn: ({ signal }) => organizationsApi.myMembership(workspaceId, signal),
    staleTime: 60_000,
    retry: false,
  });

/** Needs `workspace:read`. */
export const workspaceDetailsQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.details(workspaceId),
    queryFn: ({ signal }) => organizationsApi.get(workspaceId, signal),
    staleTime: 60_000,
  });

// ── Phase 2 (spec §8: every key starts with the canonical workspace id) ─────

export const membersQuery = (workspaceId: string, params: ListMembersParams) =>
  queryOptions({
    queryKey: queryKeys.membersList(workspaceId, params),
    // The signal cancels a search that a newer keystroke has replaced.
    queryFn: ({ signal }) => membersApi.list(workspaceId, params, signal),
    placeholderData: keepPreviousData,
  });

/** Active members a page at a time, for pickers that must reach everyone (transfer ownership). */
export const activeMembersInfiniteQuery = (workspaceId: string, search: string) =>
  infiniteQueryOptions({
    queryKey: [...queryKeys.members(workspaceId), 'active-infinite', search] as const,
    queryFn: ({ pageParam, signal }) =>
      membersApi.list(
        workspaceId,
        { page: pageParam, limit: 50, status: 'ACTIVE', sortBy: 'name', sortDirection: 'ASC', ...(search ? { search } : {}) },
        signal,
      ),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.pagination.hasNextPage ? last.pagination.page + 1 : undefined),
  });

/** Pages through a list endpoint at its maximum page size, up to a hard stop. */
async function fetchAllPages<T>(
  fetchPage: (page: number) => Promise<{ items: T[]; pagination: { hasNextPage: boolean } }>,
  maxPages = 20,
): Promise<{ items: T[]; complete: boolean }> {
  const items: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await fetchPage(page);
    items.push(...result.items);
    if (!result.pagination.hasNextPage) return { items, complete: true };
  }
  return { items, complete: false };
}

/**
 * Display names by USER id, for API-key creators (keys only carry `createdById`).
 * Includes removed members, whose keys may still be listed. Needs member:read.
 */
export const memberNamesQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: [...queryKeys.members(workspaceId), 'names'] as const,
    queryFn: async ({ signal }) => {
      const [current, removed] = await Promise.all([
        fetchAllPages((page) => membersApi.list(workspaceId, { page, limit: 100 }, signal), 10),
        fetchAllPages((page) => membersApi.list(workspaceId, { page, limit: 100, status: 'REMOVED' }, signal), 10),
      ]);
      const names = new Map<string, { name: string; removed: boolean }>();
      for (const member of removed.items) names.set(member.userId, { name: member.displayName, removed: true });
      for (const member of current.items) names.set(member.userId, { name: member.displayName, removed: false });
      return names;
    },
    staleTime: 60_000,
  });

export const memberQuery = (workspaceId: string, memberId: string) =>
  queryOptions({
    queryKey: queryKeys.memberDetail(workspaceId, memberId),
    queryFn: ({ signal }) => membersApi.get(workspaceId, memberId, signal),
  });

export const invitationsQuery = (workspaceId: string, params: ListInvitationsParams) =>
  queryOptions({
    queryKey: queryKeys.invitationsList(workspaceId, params),
    queryFn: ({ signal }) => invitationsApi.list(workspaceId, params, signal),
    placeholderData: keepPreviousData,
  });

/**
 * Every invitation stored as PENDING, all pages (newest first). Used to find the
 * invitation behind an uncertain "send", and the ones a role deletion would break.
 * Some may already have expired: check `expiresAt`.
 */
export const pendingInvitationsQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: [...queryKeys.invitations(workspaceId), 'pending-all'] as const,
    queryFn: ({ signal }) =>
      fetchAllPages((page) => invitationsApi.list(workspaceId, { page, limit: 100, status: 'PENDING' }, signal), 10),
  });

export const rolesQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.roles(workspaceId),
    queryFn: ({ signal }) => rolesApi.list(workspaceId, signal),
  });

export const roleQuery = (workspaceId: string, roleId: string) =>
  queryOptions({
    queryKey: queryKeys.roleDetail(workspaceId, roleId),
    queryFn: ({ signal }) => rolesApi.get(workspaceId, roleId, signal),
  });

/** Members holding a role (active and suspended, as ROLE_IN_USE counts them): one cheap request per role. */
export const roleMemberCountQuery = (workspaceId: string, roleId: string) =>
  queryOptions({
    queryKey: queryKeys.roleMemberCount(workspaceId, roleId),
    queryFn: async ({ signal }) =>
      (await membersApi.list(workspaceId, { roleId, limit: 1 }, signal)).pagination.totalItems,
  });

/** Metadata only. A newly created key's secret never enters this (or any) cache. */
export const apiKeysQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.apiKeys(workspaceId),
    queryFn: ({ signal }) => apiKeysApi.list(workspaceId, signal),
  });

export const apiKeyScopesQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.apiKeyScopes(workspaceId),
    queryFn: async ({ signal }) => (await apiKeysApi.scopes(workspaceId, signal)).scopes,
    staleTime: 5 * 60_000,
  });

export const ipRulesQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.ipRules(workspaceId),
    queryFn: ({ signal }) => workspaceApi.ipRules(workspaceId, signal),
  });

export const invitationPreviewQuery = (token: string) =>
  queryOptions({
    queryKey: queryKeys.invitationPreview(token),
    queryFn: () => invitationsApi.preview(token),
    // Preview shares the per-IP auth throttle (10 per 15 min): once per page load.
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

// ── Phase 3 (spec §9: every key starts with the canonical workspace id; reads are cancellable) ──

export const knowledgeBasesQuery = (workspaceId: string, params: ListKnowledgeBasesParams) =>
  queryOptions({
    queryKey: queryKeys.knowledgeBasesList(workspaceId, params),
    queryFn: ({ signal }) => knowledgeBasesApi.list(workspaceId, params, signal),
    placeholderData: keepPreviousData,
  });

/** Pages through P3-API-01 at its maximum page size; almost always one request. */
async function fetchAllKnowledgeBases(workspaceId: string, signal: AbortSignal): Promise<KnowledgeBase[]> {
  const all: KnowledgeBase[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const result = await knowledgeBasesApi.list(workspaceId, { page, limit: 100, sortBy: 'name', sortDirection: 'ASC' }, signal);
    all.push(...result.items);
    if (!result.pagination.hasNextPage) break;
  }
  return all;
}

export const allKnowledgeBasesQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.knowledgeBasesAll(workspaceId),
    queryFn: ({ signal }) => fetchAllKnowledgeBases(workspaceId, signal),
  });

export const knowledgeBaseQuery = (workspaceId: string, knowledgeBaseId: string) =>
  queryOptions({
    queryKey: queryKeys.knowledgeBaseDetail(workspaceId, knowledgeBaseId),
    queryFn: ({ signal }) => knowledgeBasesApi.get(workspaceId, knowledgeBaseId, signal),
  });

export const knowledgeBaseGrantsQuery = (workspaceId: string, knowledgeBaseId: string) =>
  queryOptions({
    queryKey: queryKeys.knowledgeBaseGrants(workspaceId, knowledgeBaseId),
    queryFn: ({ signal }) => knowledgeBasesApi.grants(workspaceId, knowledgeBaseId, signal),
  });

/**
 * P3-API-10, polled while anything it shows is processing (spec §9.3): 2 s, then
 * 5 s, then 15 s, stopping after 30 minutes. Paused while the tab is hidden and
 * refetched as soon as it is shown again.
 */
export const documentsQuery = (workspaceId: string, params: ListDocumentsParams) =>
  queryOptions({
    queryKey: queryKeys.documentsList(workspaceId, params),
    queryFn: ({ signal }) => documentsApi.list(workspaceId, params, signal),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => processingPollInterval(query.queryHash, query.state.data?.items, query.state.error),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: (query) => (anyInProgress(query.state.data?.items) ? 'always' : true),
  });

/** P3-API-11 for one open document, polled the same way while it processes. */
export const documentQuery = (workspaceId: string, documentId: string) =>
  queryOptions({
    queryKey: queryKeys.documentDetail(workspaceId, documentId),
    queryFn: ({ signal }) => documentsApi.get(workspaceId, documentId, signal),
    refetchInterval: (query) =>
      processingPollInterval(query.queryHash, query.state.data ? [query.state.data] : undefined, query.state.error),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: (query) => (query.state.data && anyInProgress([query.state.data]) ? 'always' : true),
  });

/** P3-API-12. Chunk text is sensitive: memory only, never persisted (spec §9.2). */
export const documentChunksQuery = (workspaceId: string, documentId: string, activeIndexVersion: number | null, page: number) =>
  queryOptions({
    queryKey: queryKeys.documentChunksPage(workspaceId, documentId, activeIndexVersion, page),
    queryFn: ({ signal }) => documentsApi.chunks(workspaceId, documentId, page, 20, signal),
    placeholderData: keepPreviousData,
  });

/**
 * P3-API-21 without reveal (revealed pages are never cached). The privacy budget is
 * 30 a minute, shared with the analysis preview, so a page stays fresh for a minute.
 */
export const documentPiiReportQuery = (workspaceId: string, documentId: string, report: PiiReportKey) =>
  queryOptions({
    queryKey: queryKeys.documentPiiReportPage(workspaceId, documentId, report),
    queryFn: ({ signal }) =>
      piiApi.documentReport(workspaceId, documentId, { page: report.page, limit: report.limit }, signal),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

/** P3-API-23. Needs rag:query. */
export const ragScopeQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.ragScope(workspaceId),
    queryFn: ({ signal }) => ragApi.accessScope(workspaceId, signal),
    staleTime: 60_000,
  });

/** P3-API-19. `enabled` follows the policy, so it is refetched after every policy save. */
export const piiEntityTypesQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.piiEntityTypes(workspaceId),
    queryFn: ({ signal }) => piiApi.entityTypes(workspaceId, signal),
    staleTime: 5 * 60_000,
    retry: false,
  });

/** P3-API-17. Takes effect on the next request everywhere, so it is re-read on focus. */
export const piiPolicyQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.piiPolicy(workspaceId),
    queryFn: ({ signal }) => piiApi.policy(workspaceId, signal),
    staleTime: 60_000,
    retry: false,
  });

// ── Phase 4 (spec §9: keys start with the canonical workspace id; content lives in memory only) ──

/** P4-API-01. Only agents you can see; name A→Z always. */
export const agentsQuery = (workspaceId: string, params: ListAgentsParams) =>
  queryOptions({
    queryKey: queryKeys.agentsList(workspaceId, params),
    queryFn: ({ signal }) => agentsApi.list(workspaceId, params, signal),
    placeholderData: keepPreviousData,
  });

/** Every agent you can see (at most 2,000): pickers and the usage page's names. */
export const allAgentsQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.agentsAll(workspaceId),
    queryFn: async ({ signal }): Promise<{ items: AgentSummary[]; complete: boolean }> =>
      fetchAllPages((page) => agentsApi.list(workspaceId, { page, limit: 100 }, signal), 20),
    staleTime: 60_000,
  });

/** P4-API-03. Refetched before the editor opens (P4-G05). */
export const agentQuery = (workspaceId: string, agentId: string) =>
  queryOptions({
    queryKey: queryKeys.agentDetail(workspaceId, agentId),
    queryFn: ({ signal }) => agentsApi.get(workspaceId, agentId, signal),
  });

/** P4-API-08, 20 a page. Each version carries its whole configuration. */
export const agentVersionsQuery = (workspaceId: string, agentId: string, page: number) =>
  queryOptions({
    queryKey: queryKeys.agentVersionsPage(workspaceId, agentId, page),
    queryFn: ({ signal }) => agentsApi.versions(workspaceId, agentId, page, 20, signal),
    placeholderData: keepPreviousData,
  });

/** P4-API-09. Versions never change, so they're never refetched. */
export const agentVersionQuery = (workspaceId: string, agentId: string, version: number) =>
  queryOptions({
    queryKey: queryKeys.agentVersion(workspaceId, agentId, version),
    queryFn: ({ signal }) => agentsApi.version(workspaceId, agentId, version, signal),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  });

/** P4-API-12, newest activity first. */
export const conversationsQuery = (
  workspaceId: string,
  scope: ConversationScope,
  filters: Omit<ListConversationsParams, 'scope'>,
) =>
  queryOptions({
    queryKey: queryKeys.conversationsList(workspaceId, scope, filters),
    queryFn: ({ signal }) => conversationsApi.list(workspaceId, { ...filters, scope }, signal),
    placeholderData: keepPreviousData,
  });

/** P4-API-12 as an endless list (the chat sidebar). */
export const conversationsInfiniteQuery = (
  workspaceId: string,
  scope: ConversationScope,
  filters: Omit<ListConversationsParams, 'scope' | 'page'>,
) =>
  infiniteQueryOptions({
    queryKey: [...queryKeys.conversationsList(workspaceId, scope, filters), 'infinite'] as const,
    queryFn: ({ pageParam, signal }) => conversationsApi.list(workspaceId, { ...filters, scope, page: pageParam }, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.pagination.hasNextPage ? last.pagination.page + 1 : undefined),
  });

/** P4-API-14. Title, counts and classification move with every turn. */
export const conversationQuery = (workspaceId: string, conversationId: string) =>
  queryOptions({
    queryKey: queryKeys.conversationDetail(workspaceId, conversationId),
    queryFn: ({ signal }) => conversationsApi.get(workspaceId, conversationId, signal),
  });

export const MESSAGE_PAGE_SIZE = 50;

/**
 * P4-API-17 as an infinite query: the first page is the newest, each next page is
 * older (`before`), until `nextBefore` is null. Masked or visible pages only: a
 * revealed page is never cached (§9.1).
 */
export const conversationMessagesQuery = (workspaceId: string, conversationId: string) =>
  infiniteQueryOptions({
    queryKey: queryKeys.conversationMessages(workspaceId, conversationId),
    queryFn: ({ pageParam, signal }): Promise<MessagePage> =>
      conversationsApi.messages(workspaceId, conversationId, { limit: MESSAGE_PAGE_SIZE, before: pageParam }, signal),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });

/** P4-API-22. The server caches the endpoint's list for 60 s. */
export const llmModelsQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.llmModels(workspaceId),
    queryFn: ({ signal }) => llmApi.models(workspaceId, signal),
    staleTime: 60_000,
  });

/** P4-API-23. Takes effect on the next request everywhere. */
export const llmPolicyQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.llmPolicy(workspaceId),
    queryFn: ({ signal }) => llmApi.policy(workspaceId, signal),
    staleTime: 60_000,
  });

/** P4-API-25 for one window. */
export const llmUsageQuery = (workspaceId: string, from: string, to: string) =>
  queryOptions({
    queryKey: queryKeys.llmUsage(workspaceId, from, to),
    queryFn: ({ signal }) => llmApi.usage(workspaceId, { from, to }, signal),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
