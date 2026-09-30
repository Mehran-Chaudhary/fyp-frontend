import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import {
  apiKeysApi,
  authApi,
  invitationsApi,
  membersApi,
  organizationsApi,
  permissionsApi,
  rolesApi,
  workspaceApi,
} from './api/endpoints';
import type { ListInvitationsParams, ListMembersParams } from './api/types';

/**
 * Query keys (Phase 1 spec §11, Phase 2 spec §9). Every workspace-scoped key
 * starts with ['ws', id] so data can never leak from one workspace into another,
 * and leaving a workspace can drop all of it at once.
 */
export const queryKeys = {
  me: ['me'] as const,
  mfa: ['mfa'] as const,
  sessions: ['sessions'] as const,
  workspaces: ['workspaces'] as const,
  workspacesPage: (page: number) => ['workspaces', page] as const,
  permissionCatalogue: ['permission-catalogue'] as const,
  invitationPreview: (token: string) => ['invitation-preview', token] as const,
  ws: (workspaceId: string) => ['ws', workspaceId] as const,
  membership: (workspaceId: string) => ['ws', workspaceId, 'membership'] as const,
  details: (workspaceId: string) => ['ws', workspaceId, 'details'] as const,
  permissions: (workspaceId: string) => ['ws', workspaceId, 'permissions'] as const,
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
};

export const meQuery = queryOptions({
  queryKey: queryKeys.me,
  queryFn: () => authApi.me(),
  staleTime: 60_000,
});

export const mfaQuery = queryOptions({
  queryKey: queryKeys.mfa,
  queryFn: () => authApi.mfaStatus(),
});

export const sessionsQuery = queryOptions({
  queryKey: queryKeys.sessions,
  queryFn: () => authApi.sessions(),
});

export const workspacesQuery = (page: number) =>
  queryOptions({
    queryKey: queryKeys.workspacesPage(page),
    queryFn: () => organizationsApi.list(page, 20),
    placeholderData: keepPreviousData,
  });

export const permissionCatalogueQuery = queryOptions({
  queryKey: queryKeys.permissionCatalogue,
  queryFn: () => permissionsApi.catalogue(),
  staleTime: Infinity,
  gcTime: Infinity,
});

export const membershipQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.membership(workspaceId),
    queryFn: () => organizationsApi.myMembership(workspaceId),
    staleTime: 60_000,
  });

export const workspaceDetailsQuery = (workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.details(workspaceId),
    queryFn: () => organizationsApi.get(workspaceId),
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
