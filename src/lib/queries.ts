import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/react-query';
import {
  apiKeysApi,
  authApi,
  documentsApi,
  invitationsApi,
  knowledgeBasesApi,
  membersApi,
  organizationsApi,
  permissionsApi,
  piiApi,
  ragApi,
  rolesApi,
  workspaceApi,
} from './api/endpoints';
import type {
  CurrentUser,
  KnowledgeBase,
  ListDocumentsParams,
  ListInvitationsParams,
  ListKnowledgeBasesParams,
  ListMembersParams,
} from './api/types';
import { pollInterval } from './knowledge/status';
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

  // ── Phase 3 (spec §10.1) ──
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
  documentChunksPage: (workspaceId: string, documentId: string, page: number) =>
    ['ws', workspaceId, 'document', documentId, 'chunks', page] as const,
  documentPiiReport: (workspaceId: string, documentId: string) =>
    ['ws', workspaceId, 'document', documentId, 'pii-report'] as const,
  documentPiiReportPage: (workspaceId: string, documentId: string, page: number, limit: number) =>
    ['ws', workspaceId, 'document', documentId, 'pii-report', { page, limit }] as const,
  ragScope: (workspaceId: string) => ['ws', workspaceId, 'rag-scope'] as const,
  piiEntityTypes: (workspaceId: string) => ['ws', workspaceId, 'pii-entity-types'] as const,
  piiPolicy: (workspaceId: string) => ['ws', workspaceId, 'pii-policy'] as const,
};

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

export const permissionCatalogueQuery = queryOptions({
  queryKey: queryKeys.permissionCatalogue,
  queryFn: () => permissionsApi.catalogue(),
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

// ── Phase 2 ─────────────────────────────────────────────────────────────────

export const membersQuery = (workspaceId: string, params: ListMembersParams) =>
  queryOptions({
    queryKey: queryKeys.membersList(workspaceId, params),
    queryFn: () => membersApi.list(workspaceId, params),
    placeholderData: keepPreviousData,
  });

export const memberQuery = (workspaceId: string, memberId: string) =>
  queryOptions({
    queryKey: queryKeys.memberDetail(workspaceId, memberId),
    queryFn: () => membersApi.get(workspaceId, memberId),
  });

export const invitationsQuery = (workspaceId: string, params: ListInvitationsParams) =>
  queryOptions({
    queryKey: queryKeys.invitationsList(workspaceId, params),
    queryFn: () => invitationsApi.list(workspaceId, params),
    placeholderData: keepPreviousData,
  });

export const rolesQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.roles(workspaceId),
    queryFn: () => rolesApi.list(workspaceId),
  });

export const roleQuery = (workspaceId: string, roleId: string) =>
  queryOptions({
    queryKey: queryKeys.roleDetail(workspaceId, roleId),
    queryFn: () => rolesApi.get(workspaceId, roleId),
  });

/** Members holding a role (active and suspended): one cheap request per role (§5.5). */
export const roleMemberCountQuery = (workspaceId: string, roleId: string) =>
  queryOptions({
    queryKey: queryKeys.roleMemberCount(workspaceId, roleId),
    queryFn: async () => (await membersApi.list(workspaceId, { roleId, limit: 1 })).pagination.totalItems,
  });

export const apiKeysQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.apiKeys(workspaceId),
    queryFn: () => apiKeysApi.list(workspaceId),
  });

export const apiKeyScopesQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.apiKeyScopes(workspaceId),
    queryFn: async () => (await apiKeysApi.scopes(workspaceId)).scopes,
    staleTime: Infinity,
  });

export const ipRulesQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.ipRules(workspaceId),
    queryFn: () => workspaceApi.ipRules(workspaceId),
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

// ── Phase 3 (spec §10) ──────────────────────────────────────────────────────

export const knowledgeBasesQuery = (workspaceId: string, params: ListKnowledgeBasesParams) =>
  queryOptions({
    queryKey: queryKeys.knowledgeBasesList(workspaceId, params),
    queryFn: () => knowledgeBasesApi.list(workspaceId, params),
    placeholderData: keepPreviousData,
  });

/** Pages through E60 at its maximum page size; almost always one request. */
async function fetchAllKnowledgeBases(workspaceId: string): Promise<KnowledgeBase[]> {
  const all: KnowledgeBase[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const result = await knowledgeBasesApi.list(workspaceId, { page, limit: 100, sortBy: 'name', sortDirection: 'ASC' });
    all.push(...result.items);
    if (!result.pagination.hasNextPage) break;
  }
  return all;
}

export const allKnowledgeBasesQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.knowledgeBasesAll(workspaceId),
    queryFn: () => fetchAllKnowledgeBases(workspaceId),
  });

export const knowledgeBaseQuery = (workspaceId: string, knowledgeBaseId: string) =>
  queryOptions({
    queryKey: queryKeys.knowledgeBaseDetail(workspaceId, knowledgeBaseId),
    queryFn: () => knowledgeBasesApi.get(workspaceId, knowledgeBaseId),
  });

export const knowledgeBaseGrantsQuery = (workspaceId: string, knowledgeBaseId: string) =>
  queryOptions({
    queryKey: queryKeys.knowledgeBaseGrants(workspaceId, knowledgeBaseId),
    queryFn: () => knowledgeBasesApi.grants(workspaceId, knowledgeBaseId),
  });

/** E69, polled while anything on the page is still processing (§10.3). */
export const documentsQuery = (workspaceId: string, params: ListDocumentsParams) =>
  queryOptions({
    queryKey: queryKeys.documentsList(workspaceId, params),
    queryFn: () => documentsApi.list(workspaceId, params),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => pollInterval(query.state.data?.items ?? []),
    refetchIntervalInBackground: false,
  });

/** E70, polled while the document is processing (§10.3). */
export const documentQuery = (workspaceId: string, documentId: string) =>
  queryOptions({
    queryKey: queryKeys.documentDetail(workspaceId, documentId),
    queryFn: () => documentsApi.get(workspaceId, documentId),
    refetchInterval: (query) => (query.state.data ? pollInterval([query.state.data]) : false),
    refetchIntervalInBackground: false,
  });

export const documentChunksQuery = (workspaceId: string, documentId: string, page: number) =>
  queryOptions({
    queryKey: queryKeys.documentChunksPage(workspaceId, documentId, page),
    queryFn: () => documentsApi.chunks(workspaceId, documentId, page, 20),
    placeholderData: keepPreviousData,
  });

/** E78 without reveal. Limited to 30 per minute, so it stays fresh for a minute. */
export const documentPiiReportQuery = (workspaceId: string, documentId: string, page: number, limit: number) =>
  queryOptions({
    queryKey: queryKeys.documentPiiReportPage(workspaceId, documentId, page, limit),
    queryFn: ({ signal }) => piiApi.documentReport(workspaceId, documentId, { page, limit }, signal),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

export const ragScopeQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.ragScope(workspaceId),
    queryFn: () => ragApi.accessScope(workspaceId),
    staleTime: 60_000,
  });

/** The PII report's legend: cached for the session. */
export const piiEntityTypesQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.piiEntityTypes(workspaceId),
    queryFn: () => piiApi.entityTypes(workspaceId),
    staleTime: Infinity,
    retry: false,
  });

export const piiPolicyQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.piiPolicy(workspaceId),
    queryFn: () => piiApi.policy(workspaceId),
    staleTime: 60_000,
    retry: false,
  });
