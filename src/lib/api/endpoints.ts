import { call, callPaginated, download, request, workspacePath } from './client';
import type {
  AcceptInvitationResponse,
  AccessScope,
  ApiKey,
  AuthResponse,
  ChangePasswordRequest,
  ChangePasswordResponse,
  CreateApiKeyRequest,
  CreatedApiKey,
  CreateInvitationRequest,
  CreateIpRuleRequest,
  CreateKnowledgeBaseRequest,
  CreateOrganizationRequest,
  CreateRoleRequest,
  CurrentUser,
  DocumentChunk,
  DocumentPiiReport,
  EraseAccountRequest,
  ErasureOutcome,
  Invitation,
  InvitationPreview,
  IpRule,
  KnowledgeBase,
  KnowledgeBaseGrant,
  ListDocumentsParams,
  ListInvitationsParams,
  ListKnowledgeBasesParams,
  ListMembersParams,
  LoginRequest,
  LoginResponse,
  Member,
  MfaEnableResponse,
  MfaSetup,
  MfaStatus,
  MfaVerifyRequest,
  Organization,
  OrganizationWithMembership,
  PermissionCatalogue,
  PiiEntityType,
  PiiPolicy,
  RegisterRequest,
  RemoveMemberResponse,
  RetrievalQuery,
  RetrievalResponse,
  Role,
  SecondFactor,
  Session,
  UpdateDocumentRequest,
  UpdateKnowledgeBaseRequest,
  UpdateMemberProfileRequest,
  UpdateOrganizationRequest,
  UpdateProfileRequest,
  UpdateProfileResponse,
  UpdateRoleRequest,
  UpsertGrantRequest,
  VaultDocument,
} from './types';

/**
 * One function per backend endpoint (Phase 1 spec §8, E1–E29; Phase 2 spec §6,
 * E30–E59). Components never call `fetch` directly.
 */
export const authApi = {
  /** E1 */
  register: (body: RegisterRequest) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body, auth: false }),

  /** E2. Two success shapes: signed in, or a second factor is needed. */
  login: (body: LoginRequest) => request<LoginResponse>('/auth/login', { method: 'POST', body, auth: false }),

  /** E3 */
  verifyMfa: (body: MfaVerifyRequest) =>
    call<AuthResponse>('/auth/mfa/verify', { method: 'POST', body, auth: false }),

  /** E5. No refresh-and-retry: sign-out cleans up locally whatever happens. */
  logout: () =>
    call<{ revokedSessions: number }>('/auth/logout', {
      method: 'POST',
      body: {},
      authRetry: false,
      globalErrors: false,
    }),

  /** E6 */
  logoutAll: () => call<{ revokedSessions: number }>('/auth/logout-all', { method: 'POST' }),

  /** E7. `workspaceId` asks for effective permissions (ignored until BF-1 is fixed). */
  me: (workspaceId?: string) => call<CurrentUser>('/auth/me', { workspaceId, globalErrors: !workspaceId }),

  /** E8. Send only the changed fields. */
  updateMe: (body: UpdateProfileRequest) => call<UpdateProfileResponse>('/auth/me', { method: 'PATCH', body }),

  /** E9 */
  verifyEmail: (token: string) =>
    call<{ verified: true }>('/auth/verify-email', { method: 'POST', body: { token }, auth: false }),

  /** E10. Always `{ sent: true }` (anti-enumeration). */
  resendVerification: (email: string) =>
    call<{ sent: true }>('/auth/resend-verification', { method: 'POST', body: { email }, auth: false }),

  /** E11. Always `{ sent: true }`. */
  forgotPassword: (email: string) =>
    call<{ sent: true }>('/auth/forgot-password', { method: 'POST', body: { email }, auth: false }),

  /** E12 */
  resetPassword: (body: { token: string; password: string }) =>
    call<{ reset: true }>('/auth/reset-password', { method: 'POST', body, auth: false }),

  /** E13. The cookie tells the server which device to keep signed in. */
  changePassword: (body: ChangePasswordRequest) =>
    call<ChangePasswordResponse>('/auth/change-password', { method: 'POST', body }),

  /** E14 */
  sessions: () => call<Session[]>('/auth/sessions'),

  /** E15 */
  revokeSession: (sessionId: string) =>
    call<{ revoked: number }>(`/auth/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),

  /** E16 */
  mfaStatus: () => call<MfaStatus>('/auth/mfa'),

  /** E17 */
  mfaSetup: (password: string) => call<MfaSetup>('/auth/mfa/setup', { method: 'POST', body: { password } }),

  /** E18 */
  mfaEnable: (code: string) => call<MfaEnableResponse>('/auth/mfa/enable', { method: 'POST', body: { code } }),

  /** E19 */
  mfaDisable: (body: { password: string } & SecondFactor) =>
    call<{ disabled: true }>('/auth/mfa/disable', { method: 'POST', body }),

  /** E20. Authenticator code only. */
  regenerateRecoveryCodes: (body: { password: string; code: string }) =>
    call<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { method: 'POST', body }),

  /** E21. A raw file, not an envelope. */
  exportPersonalData: () => download('/auth/me/export'),

  /** E22. A JSON body on a DELETE. */
  eraseAccount: (body: EraseAccountRequest) => call<ErasureOutcome>('/auth/me', { method: 'DELETE', body }),
};

export const organizationsApi = {
  /** E23. Newest membership first. */
  list: (page: number, limit = 20) =>
    callPaginated<OrganizationWithMembership>('/organizations', { query: { page, limit } }),

  /** E24. The slug may come back with a random suffix: always use the returned one. */
  create: (body: CreateOrganizationRequest) => call<Organization>('/organizations', { method: 'POST', body }),

  /** E25. Needs `workspace:read`. */
  get: (workspaceId: string) => {
    const [path, scope] = workspacePath(workspaceId);
    return call<Organization>(path, scope);
  },

  /** E26. Needs no permission: the workspace gate's access probe. */
  myMembership: (workspaceId: string) => {
    const [path, scope] = workspacePath(workspaceId, '/members/me');
    return call<Member>(path, scope);
  },

  /**
   * E27. Needs `role:read`. Used only by the permission fallback (§5.2), which
   * treats a 403 as "unknown", so global error handling is off.
   */
  roles: (workspaceId: string) => {
    const [path, scope] = workspacePath(workspaceId, '/roles');
    return call<Role[]>(path, { ...scope, globalErrors: false });
  },
};

export const permissionsApi = {
  /** E28. 64 permissions; cached for the whole session. */
  catalogue: () => call<PermissionCatalogue>('/permissions'),
};

/** Path ids are interpolated into URLs; keep them inert. */
const id = (value: string) => encodeURIComponent(value);

// ── Phase 2 ─────────────────────────────────────────────────────────────────

export const workspaceApi = {
  /**
   * E30. Send only what changed; `settings` is a partial update (BF-6). The two
   * access codes below refuse THIS change (your own session or email isn't
   * verified); they say nothing about your access to the workspace.
   */
  update: (workspaceId: string, body: UpdateOrganizationRequest) => {
    const [path, scope] = workspacePath(workspaceId);
    return call<Organization>(path, {
      ...scope,
      method: 'PATCH',
      body,
      localCodes: ['MFA_REQUIRED', 'ACCOUNT_EMAIL_NOT_VERIFIED'],
    });
  },

  /** E31. Owner only. */
  remove: (workspaceId: string) => {
    const [path, scope] = workspacePath(workspaceId);
    return call<{ deleted: true }>(path, { ...scope, method: 'DELETE' });
  },

  /** E32. Takes the member's USER id. */
  transferOwnership: (workspaceId: string, newOwnerUserId: string) => {
    const [path, scope] = workspacePath(workspaceId, '/transfer-ownership');
    return call<Organization>(path, { ...scope, method: 'POST', body: { newOwnerUserId } });
  },

  /** E33. Newest first, not paginated. */
  ipRules: (workspaceId: string) => {
    const [path, scope] = workspacePath(workspaceId, '/ip-rules');
    return call<IpRule[]>(path, scope);
  },

  /** E34 */
  addIpRule: (workspaceId: string, body: CreateIpRuleRequest) => {
    const [path, scope] = workspacePath(workspaceId, '/ip-rules');
    return call<IpRule>(path, { ...scope, method: 'POST', body });
  },

  /** E35 */
  removeIpRule: (workspaceId: string, ruleId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/ip-rules/${id(ruleId)}`);
    return call<{ removed: true }>(path, { ...scope, method: 'DELETE' });
  },

  /** E36. Takes effect on the very next request. */
  setIpEnforcement: (workspaceId: string, enabled: boolean) => {
    const [path, scope] = workspacePath(workspaceId, '/ip-enforcement');
    return call<Organization>(path, { ...scope, method: 'PUT', body: { enabled } });
  },
};

export const membersApi = {
  /** E37. Omitting `status` lists active and suspended members. */
  list: (workspaceId: string, params: ListMembersParams = {}) => {
    const [path, scope] = workspacePath(workspaceId, '/members');
    return callPaginated<Member>(path, { ...scope, query: { ...params } });
  },

  /** E38. Also returns removed members (read-only). */
  get: (workspaceId: string, memberId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/members/${id(memberId)}`);
    return call<Member>(path, scope);
  },

  /** E39. Your own profile needs no permission; someone else's needs member:update + rank. */
  updateProfile: (workspaceId: string, memberId: string, body: UpdateMemberProfileRequest) => {
    const [path, scope] = workspacePath(workspaceId, `/members/${id(memberId)}`);
    return call<Member>(path, { ...scope, method: 'PATCH', body });
  },

  /** E40. Replaces the member's roles. */
  setRoles: (workspaceId: string, memberId: string, roleIds: string[]) => {
    const [path, scope] = workspacePath(workspaceId, `/members/${id(memberId)}/roles`);
    return call<Member>(path, { ...scope, method: 'PUT', body: { roleIds } });
  },

  /** E41. The reason is shown to the member. */
  suspend: (workspaceId: string, memberId: string, reason?: string) => {
    const [path, scope] = workspacePath(workspaceId, `/members/${id(memberId)}/suspend`);
    return call<Member>(path, { ...scope, method: 'POST', body: reason ? { reason } : {} });
  },

  /** E42 */
  reactivate: (workspaceId: string, memberId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/members/${id(memberId)}/reactivate`);
    return call<Member>(path, { ...scope, method: 'POST', body: {} });
  },

  /** E43. Also revokes every API key the member created here. */
  remove: (workspaceId: string, memberId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/members/${id(memberId)}`);
    return call<RemoveMemberResponse>(path, { ...scope, method: 'DELETE' });
  },

  /** E44 */
  leave: (workspaceId: string) => {
    const [path, scope] = workspacePath(workspaceId, '/members/leave');
    return call<{ left: true }>(path, { ...scope, method: 'POST' });
  },
};

export const invitationsApi = {
  /** E45. Newest first. */
  list: (workspaceId: string, params: ListInvitationsParams = {}) => {
    const [path, scope] = workspacePath(workspaceId, '/invitations');
    return callPaginated<Invitation>(path, { ...scope, query: { ...params } });
  },

  /** E46. MEMBERSHIP_SUSPENDED here is about the invitee, not about you. */
  create: (workspaceId: string, body: CreateInvitationRequest) => {
    const [path, scope] = workspacePath(workspaceId, '/invitations');
    return call<Invitation>(path, { ...scope, method: 'POST', body, localCodes: ['MEMBERSHIP_SUSPENDED'] });
  },

  /** E47. Issues a new link and voids the old one. */
  resend: (workspaceId: string, invitationId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/invitations/${id(invitationId)}/resend`);
    return call<Invitation>(path, { ...scope, method: 'POST', body: {} });
  },

  /** E48 */
  revoke: (workspaceId: string, invitationId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/invitations/${id(invitationId)}`);
    return call<Invitation>(path, { ...scope, method: 'DELETE' });
  },

  /** E49. Public; shares the per-IP `auth` throttle, so call it once per page load. */
  preview: (token: string) =>
    call<InvitationPreview>('/invitations/preview', { query: { token }, auth: false, globalErrors: false }),

  /**
   * E50. Bearer but no workspace header. INVITATION_EMAIL_MISMATCH is a 401 that
   * is not about the session: the client only refreshes on the four token codes.
   */
  accept: (token: string) =>
    call<AcceptInvitationResponse>('/invitations/accept', { method: 'POST', body: { token }, globalErrors: false }),
};

export const rolesApi = {
  /** E27, for the administration screens (global error handling on). Sorted by priority, highest first. */
  list: (workspaceId: string) => {
    const [path, scope] = workspacePath(workspaceId, '/roles');
    return call<Role[]>(path, scope);
  },

  /** E51 */
  get: (workspaceId: string, roleId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/roles/${id(roleId)}`);
    return call<Role>(path, scope);
  },

  /** E52 */
  create: (workspaceId: string, body: CreateRoleRequest) => {
    const [path, scope] = workspacePath(workspaceId, '/roles');
    return call<Role>(path, { ...scope, method: 'POST', body });
  },

  /** E53. Send only the changed fields: `permissionKeys` only when the selection changed. */
  update: (workspaceId: string, roleId: string, body: UpdateRoleRequest) => {
    const [path, scope] = workspacePath(workspaceId, `/roles/${id(roleId)}`);
    return call<Role>(path, { ...scope, method: 'PATCH', body });
  },

  /** E54 */
  remove: (workspaceId: string, roleId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/roles/${id(roleId)}`);
    return call<{ deleted: true }>(path, { ...scope, method: 'DELETE' });
  },

  /** E55. A repair tool: rebuilds every member's effective permissions. */
  recompute: (workspaceId: string) => {
    const [path, scope] = workspacePath(workspaceId, '/roles/recompute');
    return call<{ membersRecomputed: number }>(path, { ...scope, method: 'POST', body: {} });
  },
};

export const apiKeysApi = {
  /** E56. The scopes an API key may carry. */
  scopes: (workspaceId: string) => {
    const [path, scope] = workspacePath(workspaceId, '/api-keys/scopes');
    return call<{ scopes: string[] }>(path, scope);
  },

  /** E57. Newest first, includes revoked keys, not paginated. */
  list: (workspaceId: string) => {
    const [path, scope] = workspacePath(workspaceId, '/api-keys');
    return call<ApiKey[]>(path, scope);
  },

  /** E58. The plaintext key is in the response once and never again. */
  create: (workspaceId: string, body: CreateApiKeyRequest) => {
    const [path, scope] = workspacePath(workspaceId, '/api-keys');
    return call<CreatedApiKey>(path, { ...scope, method: 'POST', body });
  },

  /** E59. A JSON body on a DELETE. Idempotent. */
  revoke: (workspaceId: string, apiKeyId: string, reason?: string) => {
    const [path, scope] = workspacePath(workspaceId, `/api-keys/${id(apiKeyId)}`);
    return call<ApiKey>(path, { ...scope, method: 'DELETE', body: reason ? { reason } : {} });
  },
};

// ── Phase 3 ─────────────────────────────────────────────────────────────────

/** E76: the server allows 60 s; wait slightly longer so its answer arrives (spec §2.2). */
const RETRIEVAL_TIMEOUT_MS = 65_000;
/** E72: the server allows 120 s for large files. */
const DOCUMENT_DOWNLOAD_TIMEOUT_MS = 130_000;

export const knowledgeBasesApi = {
  /** E60. Only bases you can read; `stats` count what your clearance covers. */
  list: (workspaceId: string, params: ListKnowledgeBasesParams = {}) => {
    const [path, scope] = workspacePath(workspaceId, '/knowledge-bases');
    return callPaginated<KnowledgeBase>(path, { ...scope, query: { ...params } });
  },

  /** E61. A RESTRICTED base comes with a MANAGE grant for you (unless you're the owner). */
  create: (workspaceId: string, body: CreateKnowledgeBaseRequest) => {
    const [path, scope] = workspacePath(workspaceId, '/knowledge-bases');
    return call<KnowledgeBase>(path, { ...scope, method: 'POST', body });
  },

  /** E62. Unknown, deleted and hidden bases all answer 404. */
  get: (workspaceId: string, knowledgeBaseId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/knowledge-bases/${id(knowledgeBaseId)}`);
    return call<KnowledgeBase>(path, scope);
  },

  /** E63. Send only what changed; `null` chunk settings return to inheriting. */
  update: (workspaceId: string, knowledgeBaseId: string, body: UpdateKnowledgeBaseRequest) => {
    const [path, scope] = workspacePath(workspaceId, `/knowledge-bases/${id(knowledgeBaseId)}`);
    return call<KnowledgeBase>(path, { ...scope, method: 'PATCH', body });
  },

  /** E64. Destroys every document's key in the same transaction. */
  remove: (workspaceId: string, knowledgeBaseId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/knowledge-bases/${id(knowledgeBaseId)}`);
    return call<{ deleted: true }>(path, { ...scope, method: 'DELETE' });
  },

  /** E65. Oldest first, not paginated. Needs MANAGE on the base. */
  grants: (workspaceId: string, knowledgeBaseId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/knowledge-bases/${id(knowledgeBaseId)}/grants`);
    return call<KnowledgeBaseGrant[]>(path, scope);
  },

  /** E66. An upsert: granting the same subject again changes its level (same grant id). */
  upsertGrant: (workspaceId: string, knowledgeBaseId: string, body: UpsertGrantRequest) => {
    const [path, scope] = workspacePath(workspaceId, `/knowledge-bases/${id(knowledgeBaseId)}/grants`);
    return call<KnowledgeBaseGrant>(path, { ...scope, method: 'PUT', body });
  },

  /** E67. Effective on the next request, including for yourself. */
  revokeGrant: (workspaceId: string, knowledgeBaseId: string, grantId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/knowledge-bases/${id(knowledgeBaseId)}/grants/${id(grantId)}`);
    return call<{ revoked: true }>(path, { ...scope, method: 'DELETE' });
  },
};

export const documentsApi = {
  /** E69. Documents above your clearance or in hidden bases are simply not listed. */
  list: (workspaceId: string, params: ListDocumentsParams = {}) => {
    const [path, scope] = workspacePath(workspaceId, '/documents');
    const { status, ...rest } = params;
    // BF-18: several statuses in one comma-separated parameter.
    return callPaginated<VaultDocument>(path, {
      ...scope,
      query: { ...rest, status: status?.length ? status.join(',') : undefined },
    });
  },

  /** E70 */
  get: (workspaceId: string, documentId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/documents/${id(documentId)}`);
    return call<VaultDocument>(path, scope);
  },

  /** E71. The version retrieval serves, in order. Chunk ids change on every reindex. */
  chunks: (workspaceId: string, documentId: string, page: number, limit = 20) => {
    const [path, scope] = workspacePath(workspaceId, `/documents/${id(documentId)}/chunks`);
    return callPaginated<DocumentChunk>(path, { ...scope, query: { page, limit } });
  },

  /** E72. The original bytes, not enveloped. Every download is audited. */
  download: (workspaceId: string, documentId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/documents/${id(documentId)}/download`);
    return download(path, { ...scope, timeoutMs: DOCUMENT_DOWNLOAD_TIMEOUT_MS });
  },

  /** E73. Send only what changed. Reclassification applies to search immediately. */
  update: (workspaceId: string, documentId: string, body: UpdateDocumentRequest) => {
    const [path, scope] = workspacePath(workspaceId, `/documents/${id(documentId)}`);
    return call<VaultDocument>(path, { ...scope, method: 'PATCH', body });
  },

  /** E74. Allowed when READY (reindex) or FAILED (retry); answers 202. */
  reindex: (workspaceId: string, documentId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/documents/${id(documentId)}/reindex`);
    return call<VaultDocument>(path, { ...scope, method: 'POST' });
  },

  /** E75. The content is unrecoverable at once. */
  remove: (workspaceId: string, documentId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/documents/${id(documentId)}`);
    return call<{ deleted: true }>(path, { ...scope, method: 'DELETE' });
  },
};

export const ragApi = {
  /** E76. A mutation: never cached. Has its own 60-per-minute budget. */
  query: (workspaceId: string, body: RetrievalQuery, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, '/rag/query');
    return call<RetrievalResponse>(path, { ...scope, method: 'POST', body, timeoutMs: RETRIEVAL_TIMEOUT_MS, signal });
  },

  /** E77. Works even when the knowledge layer isn't configured. */
  accessScope: (workspaceId: string) => {
    const [path, scope] = workspacePath(workspaceId, '/rag/access-scope');
    return call<AccessScope>(path, scope);
  },
};

export const piiApi = {
  /** E78. Its own 30-per-minute budget. `reveal` needs pii:reveal and is audited as CRITICAL. */
  documentReport: (
    workspaceId: string,
    documentId: string,
    params: { page: number; limit: number; reveal?: boolean },
    signal?: AbortSignal,
  ) => {
    const [path, scope] = workspacePath(workspaceId, `/pii/documents/${id(documentId)}/report`);
    return call<DocumentPiiReport>(path, {
      ...scope,
      query: { page: params.page, limit: params.limit, reveal: params.reveal ? true : undefined },
      signal,
    });
  },

  /** Phase 4 endpoint, read for the report's legend. Best effort: failures only lose labels. */
  entityTypes: (workspaceId: string) => {
    const [path, scope] = workspacePath(workspaceId, '/pii/entity-types');
    return call<PiiEntityType[]>(path, { ...scope, globalErrors: false });
  },

  /** Phase 4 endpoint, read for the "redaction is off" banner. Best effort. */
  policy: (workspaceId: string) => {
    const [path, scope] = workspacePath(workspaceId, '/pii/policy');
    return call<PiiPolicy>(path, { ...scope, globalErrors: false });
  },
};
