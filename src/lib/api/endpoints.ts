import { withAuthLock } from './auth-lock';
import { call, callPaginated, download, openEventStream, request, workspacePath } from './client';
import type { SseMessage } from './sse';
import type {
  AcceptInvitationResponse,
  Agent,
  AgentSummary,
  AgentVersion,
  ChatCompletion,
  Conversation,
  CreateAgentInput,
  CreateConversationInput,
  DirectChatInput,
  ListAgentsParams,
  ListConversationsParams,
  ListMessagesParams,
  LlmModels,
  LlmPolicy,
  MessagePage,
  PromptPreview,
  PromptPreviewInput,
  RestoreAgentVersionInput,
  SendMessageInput,
  TurnResult,
  UpdateAgentInput,
  UpdateConversationInput,
  UpdateLlmPolicyInput,
  UsageSummary,
  AccessScope,
  AnalyzeResult,
  AnalyzeTextRequest,
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
  UpdatePiiPolicyRequest,
  UpdateProfileRequest,
  UpdateProfileResponse,
  UpdateRoleRequest,
  UpsertGrantRequest,
  VaultDocument,
} from './types';

/**
 * One function per backend endpoint. Components never call `fetch` directly.
 * Phase 1 operations carry their register id (spec §9, P1-API-nn).
 */
export const authApi = {
  /**
   * P1-API-01. Sets the refresh cookie, so it runs under the auth lock: no other tab
   * may present the old cookie while it changes. Never retried automatically.
   */
  register: (body: RegisterRequest) =>
    withAuthLock(() => request<AuthResponse>('/auth/register', { method: 'POST', body, auth: false })),

  /** P1-API-02. Two success shapes: signed in, or a second factor is needed. */
  login: (body: LoginRequest) =>
    withAuthLock(() => request<LoginResponse>('/auth/login', { method: 'POST', body, auth: false })),

  /** P1-API-03 */
  verifyMfa: (body: MfaVerifyRequest) =>
    withAuthLock(() => call<AuthResponse>('/auth/mfa/verify', { method: 'POST', body, auth: false })),

  /**
   * P1-API-10. Takes the token explicitly: the caller holds the auth lock, and a
   * refresh here would wait for that same lock.
   */
  logout: (accessToken: string) =>
    call<{ revokedSessions: number }>('/auth/logout', {
      method: 'POST',
      body: {},
      bearer: accessToken,
      globalErrors: false,
    }),

  /** P1-API-11. Same lock rule as logout. */
  logoutAll: (accessToken: string) =>
    call<{ revokedSessions: number }>('/auth/logout-all', { method: 'POST', body: {}, bearer: accessToken }),

  /**
   * P1-API-12. Without a workspace: your identity and first 100 memberships. With
   * one (UUID or slug): the same, plus that workspace's canonical id and your
   * concrete permissions in it, after its access checks (membership, suspension,
   * IP allowlist, MFA and email policy). The caller handles those refusals.
   */
  me: (workspaceId?: string, signal?: AbortSignal) =>
    call<CurrentUser>('/auth/me', { workspaceId, signal, globalErrors: !workspaceId }),

  /** P1-API-13. Send only the changed fields. Returns `{ id, displayName }` only. */
  updateMe: (body: UpdateProfileRequest) => call<UpdateProfileResponse>('/auth/me', { method: 'PATCH', body }),

  /** P1-API-14. Public: works while the email gate blocks everything else. */
  verifyEmail: (token: string) =>
    call<{ verified: boolean }>('/auth/verify-email', { method: 'POST', body: { token }, auth: false }),

  /** P1-API-15. Always `{ sent: true }`: it never says whether the address exists. */
  resendVerification: (email: string) =>
    call<{ sent: true }>('/auth/resend-verification', { method: 'POST', body: { email }, auth: false }),

  /** P1-API-16. Always `{ sent: true }`. */
  forgotPassword: (email: string) =>
    call<{ sent: true }>('/auth/forgot-password', { method: 'POST', body: { email }, auth: false }),

  /** P1-API-17. Revokes every session and clears the cookie. */
  resetPassword: (body: { token: string; password: string }) =>
    call<{ reset: true }>('/auth/reset-password', { method: 'POST', body, auth: false }),

  /** P1-API-18. The cookie tells the server which device to keep signed in. */
  changePassword: (body: ChangePasswordRequest) =>
    call<ChangePasswordResponse>('/auth/change-password', { method: 'POST', body }),

  /** P1-API-19. One row per device, not paginated. */
  sessions: (signal?: AbortSignal) => call<Session[]>('/auth/sessions', { signal }),

  /** P1-API-20. The session id, never a user or family id. */
  revokeSession: (sessionId: string) =>
    call<{ revoked: number }>(`/auth/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),

  /** P1-API-04 */
  mfaStatus: (signal?: AbortSignal) => call<MfaStatus>('/auth/mfa', { signal }),

  /** P1-API-05. Creates or replaces the pending secret; never retried automatically. */
  mfaSetup: (password: string) => call<MfaSetup>('/auth/mfa/setup', { method: 'POST', body: { password } }),

  /** P1-API-06 */
  mfaEnable: (code: string) => call<MfaEnableResponse>('/auth/mfa/enable', { method: 'POST', body: { code } }),

  /** P1-API-07. Exactly one factor. */
  mfaDisable: (body: { password: string } & SecondFactor) =>
    call<{ disabled: true }>('/auth/mfa/disable', { method: 'POST', body }),

  /** P1-API-08. Authenticator code only. */
  regenerateRecoveryCodes: (body: { password: string; code: string }) =>
    call<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { method: 'POST', body }),

  /** Phase 5 (account lifecycle controller). A raw file, not an envelope. */
  exportPersonalData: () => download('/auth/me/export'),

  /** Phase 5 (account lifecycle controller). A JSON body on a DELETE. */
  eraseAccount: (body: EraseAccountRequest) => call<ErasureOutcome>('/auth/me', { method: 'DELETE', body }),
};

export const organizationsApi = {
  /** P1-API-22. Newest membership first; page/limit only (limit ≤ 100). */
  list: (page: number, limit = 20, signal?: AbortSignal) =>
    callPaginated<OrganizationWithMembership>('/organizations', { query: { page, limit }, signal }),

  /** P1-API-21. The slug may come back with a random suffix: always use the returned one. */
  create: (body: CreateOrganizationRequest) => call<Organization>('/organizations', { method: 'POST', body }),

  /** P1-API-23. Needs `workspace:read`. */
  get: (workspaceId: string, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId);
    return call<Organization>(path, { ...scope, signal });
  },

  /**
   * P1-API-24. No permission needed. A platform admin entering without a
   * membership has none to read (the server answers 500), so this is never a
   * gate: the workspace works without it.
   */
  myMembership: (workspaceId: string, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, '/members/me');
    return call<Member>(path, { ...scope, signal, globalErrors: false });
  },
};

export const permissionsApi = {
  /** P2-API-20. Bearer only, no workspace header. `key` is canonical; `action` is truncated for multi-colon keys. */
  catalogue: (signal?: AbortSignal) => call<PermissionCatalogue>('/permissions', { signal }),
};

/** Path ids are interpolated into URLs; keep them inert. */
const id = (value: string) => encodeURIComponent(value);

// ── Phase 2 (docs/PHASE_2_WORKSPACE_ADMINISTRATION.md §6, P2-API-nn) ──────────
// Mutations are never retried automatically: after a timeout or 5xx the change
// may already have happened, so screens re-read state instead (spec §8, §9).

export const workspaceApi = {
  /**
   * P2-API-01. Send only what changed; `settings` is a merge patch: an omitted
   * key is kept and a `null` key removes that override. The two access codes
   * refuse THIS change (your own session or email isn't verified); they say
   * nothing about your access to the workspace.
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

  /** P2-API-02. Owner only. Soft-deletes the workspace and its memberships; no restore endpoint. */
  remove: (workspaceId: string) => {
    const [path, scope] = workspacePath(workspaceId);
    return call<{ deleted: true }>(path, { ...scope, method: 'DELETE' });
  },

  /** P2-API-03. Takes the member's USER id. Replaces both parties' role sets. */
  transferOwnership: (workspaceId: string, newOwnerUserId: string) => {
    const [path, scope] = workspacePath(workspaceId, '/transfer-ownership');
    return call<Organization>(path, { ...scope, method: 'POST', body: { newOwnerUserId } });
  },

  /** P2-API-04. Newest first, complete, not paginated. */
  ipRules: (workspaceId: string, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, '/ip-rules');
    return call<IpRule[]>(path, { ...scope, signal });
  },

  /** P2-API-05. A new rule is active; adding one does not turn enforcement on. */
  addIpRule: (workspaceId: string, body: CreateIpRuleRequest) => {
    const [path, scope] = workspacePath(workspaceId, '/ip-rules');
    return call<IpRule>(path, { ...scope, method: 'POST', body });
  },

  /** P2-API-06. Hard delete. Refused for the last active rule or one that keeps you in, while enforcing. */
  removeIpRule: (workspaceId: string, ruleId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/ip-rules/${id(ruleId)}`);
    return call<{ removed: true }>(path, { ...scope, method: 'DELETE' });
  },

  /** P2-API-07. Takes effect on the very next request. */
  setIpEnforcement: (workspaceId: string, enabled: boolean) => {
    const [path, scope] = workspacePath(workspaceId, '/ip-enforcement');
    return call<Organization>(path, { ...scope, method: 'PUT', body: { enabled } });
  },
};

export const membersApi = {
  /** P2-API-08. Omitting `status` lists active and suspended members; REMOVED includes soft-deleted rows. */
  list: (workspaceId: string, params: ListMembersParams = {}, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, '/members');
    return callPaginated<Member>(path, { ...scope, query: { ...params }, signal });
  },

  /** P2-API-09. By MEMBERSHIP id. Also returns removed members (read-only). */
  get: (workspaceId: string, memberId: string, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, `/members/${id(memberId)}`);
    return call<Member>(path, { ...scope, signal });
  },

  /** P2-API-11. Your own profile needs no permission; someone else's needs member:update + rank. */
  updateProfile: (workspaceId: string, memberId: string, body: UpdateMemberProfileRequest) => {
    const [path, scope] = workspacePath(workspaceId, `/members/${id(memberId)}`);
    return call<Member>(path, { ...scope, method: 'PATCH', body });
  },

  /** P2-API-10. Replaces the member's whole role set (1–20 ids). */
  setRoles: (workspaceId: string, memberId: string, roleIds: string[]) => {
    const [path, scope] = workspacePath(workspaceId, `/members/${id(memberId)}/roles`);
    return call<Member>(path, { ...scope, method: 'PUT', body: { roleIds } });
  },

  /** P2-API-12. Keeps their roles; does NOT revoke API keys they created. */
  suspend: (workspaceId: string, memberId: string, reason?: string) => {
    const [path, scope] = workspacePath(workspaceId, `/members/${id(memberId)}/suspend`);
    return call<Member>(path, { ...scope, method: 'POST', body: reason ? { reason } : {} });
  },

  /** P2-API-13. Suspended → active. Not an undelete for removed members. */
  reactivate: (workspaceId: string, memberId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/members/${id(memberId)}/reactivate`);
    return call<Member>(path, { ...scope, method: 'POST', body: {} });
  },

  /** P2-API-14. Soft-deletes the membership and revokes every API key the member created here. */
  remove: (workspaceId: string, memberId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/members/${id(memberId)}`);
    return call<RemoveMemberResponse>(path, { ...scope, method: 'DELETE' });
  },

  /** P2-API-15. The owner is refused (CANNOT_REMOVE_LAST_OWNER). */
  leave: (workspaceId: string) => {
    const [path, scope] = workspacePath(workspaceId, '/members/leave');
    return call<{ left: true }>(path, { ...scope, method: 'POST', body: {} });
  },
};

export const invitationsApi = {
  /** P2-API-16. Newest first. Only page, limit and status do anything (no server search or sort). */
  list: (workspaceId: string, params: ListInvitationsParams = {}, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, '/invitations');
    return callPaginated<Invitation>(path, { ...scope, query: { ...params }, signal });
  },

  /**
   * P2-API-17. Email rate policy. Success means stored and sending attempted, not
   * delivered. MEMBERSHIP_SUSPENDED here is about the invitee, not about you.
   */
  create: (workspaceId: string, body: CreateInvitationRequest) => {
    const [path, scope] = workspacePath(workspaceId, '/invitations');
    return call<Invitation>(path, { ...scope, method: 'POST', body, localCodes: ['MEMBERSHIP_SUSPENDED'] });
  },

  /** P2-API-18. Email rate policy. Rotates the link and expiry; the old link stops working. */
  resend: (workspaceId: string, invitationId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/invitations/${id(invitationId)}/resend`);
    return call<Invitation>(path, { ...scope, method: 'POST', body: {} });
  },

  /** P2-API-19. Sets REVOKED. Accepted invitations can't be revoked. */
  revoke: (workspaceId: string, invitationId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/invitations/${id(invitationId)}`);
    return call<Invitation>(path, { ...scope, method: 'DELETE' });
  },

  /** P1-API-25. Public; shares the `auth` throttle, so call it once per page load. The email is masked. */
  preview: (token: string) =>
    call<InvitationPreview>('/invitations/preview', { query: { token }, auth: false, globalErrors: false }),

  /**
   * P1-API-26. Bearer but no workspace header: you aren't a member yet.
   * INVITATION_EMAIL_MISMATCH is a 401 about the invitation, not the session, so it
   * never triggers a refresh. Never retried automatically.
   */
  accept: (token: string) =>
    call<AcceptInvitationResponse>('/invitations/accept', { method: 'POST', body: { token }, globalErrors: false }),
};

export const rolesApi = {
  /** P2-API-21. Complete, priority DESC then name ASC. `permissionKeys` keeps raw wildcards. */
  list: (workspaceId: string, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, '/roles');
    return call<Role[]>(path, { ...scope, signal });
  },

  /** P2-API-22 */
  get: (workspaceId: string, roleId: string, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, `/roles/${id(roleId)}`);
    return call<Role>(path, { ...scope, signal });
  },

  /** P2-API-23 */
  create: (workspaceId: string, body: CreateRoleRequest) => {
    const [path, scope] = workspacePath(workspaceId, '/roles');
    return call<Role>(path, { ...scope, method: 'POST', body });
  },

  /** P2-API-24. Send only the changed fields: `permissionKeys` only when the grant set is deliberately replaced. */
  update: (workspaceId: string, roleId: string, body: UpdateRoleRequest) => {
    const [path, scope] = workspacePath(workspaceId, `/roles/${id(roleId)}`);
    return call<Role>(path, { ...scope, method: 'PATCH', body });
  },

  /** P2-API-25. Refused with ROLE_IN_USE while active or suspended members hold it. Ignores pending invitations. */
  remove: (workspaceId: string, roleId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/roles/${id(roleId)}`);
    return call<{ deleted: true }>(path, { ...scope, method: 'DELETE' });
  },

  /** P2-API-26. A repair tool: rebuilds every non-removed member's effective permissions. */
  recompute: (workspaceId: string) => {
    const [path, scope] = workspacePath(workspaceId, '/roles/recompute');
    return call<{ membersRecomputed: number }>(path, { ...scope, method: 'POST', body: {} });
  },
};

export const apiKeysApi = {
  /** P2-API-27. The scopes any API key may carry (not filtered to yours). */
  scopes: (workspaceId: string, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, '/api-keys/scopes');
    return call<{ scopes: string[] }>(path, { ...scope, signal });
  },

  /** P2-API-28. Newest first, includes revoked and expired keys, not paginated. */
  list: (workspaceId: string, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, '/api-keys');
    return call<ApiKey[]>(path, { ...scope, signal });
  },

  /**
   * P2-API-29. The plaintext key is in this response once and never again: the
   * caller keeps it in component state only, never in a cache, store or log.
   */
  create: (workspaceId: string, body: CreateApiKeyRequest) => {
    const [path, scope] = workspacePath(workspaceId, '/api-keys');
    return call<CreatedApiKey>(path, { ...scope, method: 'POST', body });
  },

  /** P2-API-30. A JSON body on a DELETE. Revoking twice returns the unchanged key. */
  revoke: (workspaceId: string, apiKeyId: string, reason?: string) => {
    const [path, scope] = workspacePath(workspaceId, `/api-keys/${id(apiKeyId)}`);
    return call<ApiKey>(path, { ...scope, method: 'DELETE', body: reason ? { reason } : {} });
  },
};

// ── Phase 3: knowledge, document vault & privacy (spec §7: 23 operations) ──────

/** P3-API-22: the server allows 60 s; wait slightly longer so its answer arrives (spec §2). */
const RETRIEVAL_TIMEOUT_MS = 65_000;
/** P3-API-09 and P3-API-13: the server allows 120 s for the transfer. */
const TRANSFER_TIMEOUT_MS = 130_000;

export const knowledgeBasesApi = {
  /** P3-API-01. Only bases you can read; `stats` count what your clearance covers. No sortBy → name ASC. */
  list: (workspaceId: string, params: ListKnowledgeBasesParams = {}, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, '/knowledge-bases');
    return callPaginated<KnowledgeBase>(path, { ...scope, query: { ...params }, signal });
  },

  /** P3-API-02. A RESTRICTED base comes with a MANAGE grant for you (unless you're the owner). */
  create: (workspaceId: string, body: CreateKnowledgeBaseRequest) => {
    const [path, scope] = workspacePath(workspaceId, '/knowledge-bases');
    return call<KnowledgeBase>(path, { ...scope, method: 'POST', body });
  },

  /** P3-API-03. Unknown, deleted and hidden bases all answer 404 KNOWLEDGE_BASE_NOT_FOUND. */
  get: (workspaceId: string, knowledgeBaseId: string, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, `/knowledge-bases/${id(knowledgeBaseId)}`);
    return call<KnowledgeBase>(path, { ...scope, signal });
  },

  /** P3-API-04. Send only what changed; `null` chunk settings return to inheriting. */
  update: (workspaceId: string, knowledgeBaseId: string, body: UpdateKnowledgeBaseRequest) => {
    const [path, scope] = workspacePath(workspaceId, `/knowledge-bases/${id(knowledgeBaseId)}`);
    return call<KnowledgeBase>(path, { ...scope, method: 'PATCH', body });
  },

  /** P3-API-05. Destroys every document's key in the same transaction: no undo. */
  remove: (workspaceId: string, knowledgeBaseId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/knowledge-bases/${id(knowledgeBaseId)}`);
    return call<{ deleted: true }>(path, { ...scope, method: 'DELETE' });
  },

  /** P3-API-06. Oldest first, a complete array. Needs MANAGE on the base. */
  grants: (workspaceId: string, knowledgeBaseId: string, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, `/knowledge-bases/${id(knowledgeBaseId)}/grants`);
    return call<KnowledgeBaseGrant[]>(path, { ...scope, signal });
  },

  /** P3-API-07. An upsert: granting the same subject again changes its level (same grant id). */
  upsertGrant: (workspaceId: string, knowledgeBaseId: string, body: UpsertGrantRequest) => {
    const [path, scope] = workspacePath(workspaceId, `/knowledge-bases/${id(knowledgeBaseId)}/grants`);
    return call<KnowledgeBaseGrant>(path, { ...scope, method: 'PUT', body });
  },

  /** P3-API-08. Effective on the next request, including for yourself. */
  revokeGrant: (workspaceId: string, knowledgeBaseId: string, grantId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/knowledge-bases/${id(knowledgeBaseId)}/grants/${id(grantId)}`);
    return call<{ revoked: true }>(path, { ...scope, method: 'DELETE' });
  },
};

export const documentsApi = {
  /**
   * P3-API-09. multipart/form-data with one part named `file`; answers 202 with the
   * stored, queued document. Never replayed after a timeout: the file may be stored.
   * The rate-limit headers come back in `rateLimit` (the upload budget is hourly).
   */
  upload: (
    workspaceId: string,
    knowledgeBaseId: string,
    form: FormData,
    options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
  ) => {
    const [path, scope] = workspacePath(workspaceId, `/knowledge-bases/${id(knowledgeBaseId)}/documents`);
    return request<VaultDocument>(path, {
      ...scope,
      method: 'POST',
      body: form,
      timeoutMs: TRANSFER_TIMEOUT_MS,
      onUploadProgress: options.onProgress ?? (() => undefined),
      signal: options.signal,
      // The upload queue explains a refused upload per file and re-reads permissions itself.
      localCodes: ['PERMISSION_DENIED'],
    });
  },

  /** P3-API-10. Documents above your clearance or in hidden bases are simply not listed. */
  list: (workspaceId: string, params: ListDocumentsParams = {}, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, '/documents');
    const { status, ...rest } = params;
    // Several statuses in one comma-separated parameter.
    return callPaginated<VaultDocument>(path, {
      ...scope,
      query: { ...rest, status: status?.length ? status.join(',') : undefined },
      signal,
    });
  },

  /** P3-API-11. Hidden (compartment or clearance), deleted or unknown: 404 DOCUMENT_NOT_FOUND. */
  get: (workspaceId: string, documentId: string, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, `/documents/${id(documentId)}`);
    return call<VaultDocument>(path, { ...scope, signal });
  },

  /** P3-API-12. The active version retrieval serves, in order. Chunk ids change on every reindex. */
  chunks: (workspaceId: string, documentId: string, page: number, limit = 20, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, `/documents/${id(documentId)}/chunks`);
    return callPaginated<DocumentChunk>(path, { ...scope, query: { page, limit }, signal });
  },

  /** P3-API-13. The original bytes, not enveloped; errors are still JSON. Every download is audited. */
  download: (workspaceId: string, documentId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/documents/${id(documentId)}/download`);
    return download(path, { ...scope, timeoutMs: TRANSFER_TIMEOUT_MS });
  },

  /** P3-API-14. Send only what changed. Reclassification applies to search immediately. */
  update: (workspaceId: string, documentId: string, body: UpdateDocumentRequest) => {
    const [path, scope] = workspacePath(workspaceId, `/documents/${id(documentId)}`);
    return call<VaultDocument>(path, { ...scope, method: 'PATCH', body });
  },

  /** P3-API-15. Only from READY (reindex) or FAILED (retry); answers 202. Otherwise 409 DOCUMENT_PROCESSING. */
  reindex: (workspaceId: string, documentId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/documents/${id(documentId)}/reindex`);
    return call<VaultDocument>(path, { ...scope, method: 'POST', body: {} });
  },

  /** P3-API-16. The content is unrecoverable at once. A second delete answers 404. */
  remove: (workspaceId: string, documentId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/documents/${id(documentId)}`);
    return call<{ deleted: true }>(path, { ...scope, method: 'DELETE' });
  },
};

export const piiApi = {
  /** P3-API-17. The deny list only for holders of pii:policy:update; `warnings` are always shown. */
  policy: (workspaceId: string, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, '/pii/policy');
    return call<PiiPolicy>(path, { ...scope, signal });
  },

  /**
   * P3-API-18. A partial update despite PUT. Send `expectedVersion` and only real
   * changes: every successful save bumps the version and is audited (P3-G05).
   */
  updatePolicy: (workspaceId: string, body: UpdatePiiPolicyRequest) => {
    const [path, scope] = workspacePath(workspaceId, '/pii/policy');
    return call<PiiPolicy>(path, { ...scope, method: 'PUT', body, localCodes: ['RESOURCE_CONFLICT'] });
  },

  /** P3-API-19. Grouped by detector; `enabled` follows the current policy. */
  entityTypes: (workspaceId: string, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, '/pii/entity-types');
    return call<PiiEntityType[]>(path, { ...scope, signal });
  },

  /**
   * P3-API-20. Shares the 30-per-minute privacy budget with the report. The text and
   * any revealed values are never cached, logged or put in a URL (spec §9.2).
   */
  analyze: (workspaceId: string, body: AnalyzeTextRequest, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, '/pii/analyze');
    return call<AnalyzeResult>(path, { ...scope, method: 'POST', body, signal });
  },

  /** P3-API-21. Shares the 30-per-minute privacy budget with P3-API-20. `reveal` needs pii:reveal. */
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
};

export const ragApi = {
  /** P3-API-22. A read that is never cached (spec §9.2). Its own 60-per-minute budget. */
  query: (workspaceId: string, body: RetrievalQuery, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, '/rag/query');
    return call<RetrievalResponse>(path, { ...scope, method: 'POST', body, timeoutMs: RETRIEVAL_TIMEOUT_MS, signal });
  },

  /** P3-API-23. Needs rag:query, so it is not the clearance source for everyone (spec §3.7). */
  accessScope: (workspaceId: string, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, '/rag/access-scope');
    return call<AccessScope>(path, { ...scope, signal });
  },
};

// ── Phase 4: agents, models & conversational AI (spec §7: 25 operations) ────

/** P4-API-18 and P4-API-20: the server allows 300 s (a generation is capped at 240 s); wait a little longer. */
const INFERENCE_TIMEOUT_MS = 310_000;
/** P4-API-11: the retrieval budget is 60 s. */
const PREVIEW_TIMEOUT_MS = 65_000;

export const agentsApi = {
  /** P4-API-01. Only agents you can see (§3.2), always name A→Z: `sortBy` is ignored (P4-G08). */
  list: (workspaceId: string, params: ListAgentsParams = {}, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, '/agents');
    return callPaginated<AgentSummary>(path, { ...scope, query: { ...params }, signal });
  },

  /** P4-API-02. A private draft at version 1. Only `name` is required. */
  create: (workspaceId: string, body: CreateAgentInput) => {
    const [path, scope] = workspacePath(workspaceId, '/agents');
    return call<Agent>(path, { ...scope, method: 'POST', body });
  },

  /** P4-API-03. Hidden, unknown and deleted agents all answer 404 AGENT_NOT_FOUND. */
  get: (workspaceId: string, agentId: string, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, `/agents/${id(agentId)}`);
    return call<Agent>(path, { ...scope, signal });
  },

  /**
   * P4-API-04. Send only what changed, `parameters` whole, plus `expectedVersion`
   * (Appendix A `agentPatch`). Behaviour changes append a version; identity and
   * access don't.
   */
  update: (workspaceId: string, agentId: string, body: UpdateAgentInput) => {
    const [path, scope] = workspacePath(workspaceId, `/agents/${id(agentId)}`);
    return call<Agent>(path, { ...scope, method: 'PATCH', body });
  },

  /** P4-API-05. Soft and final: its conversations stay readable but refuse new turns (409). */
  remove: (workspaceId: string, agentId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/agents/${id(agentId)}`);
    return call<{ deleted: true }>(path, { ...scope, method: 'DELETE' });
  },

  /** P4-API-06. Idempotent: publishing again keeps the original `publishedAt`. */
  publish: (workspaceId: string, agentId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/agents/${id(agentId)}/publish`);
    return call<Agent>(path, { ...scope, method: 'POST' });
  },

  /** P4-API-07. Idempotent. Members lose the agent at once; their conversations stay readable. */
  unpublish: (workspaceId: string, agentId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/agents/${id(agentId)}/unpublish`);
    return call<Agent>(path, { ...scope, method: 'POST' });
  },

  /** P4-API-08. Newest first, each with its full configuration (a heavy call). `limit` is capped at 50. */
  versions: (workspaceId: string, agentId: string, page: number, limit = 20, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, `/agents/${id(agentId)}/versions`);
    return callPaginated<AgentVersion>(path, { ...scope, query: { page, limit: Math.min(limit, 50) }, signal });
  },

  /** P4-API-09. Versions are immutable. */
  version: (workspaceId: string, agentId: string, version: number, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, `/agents/${id(agentId)}/versions/${Math.trunc(version)}`);
    return call<AgentVersion>(path, { ...scope, signal });
  },

  /** P4-API-10. Appends a copy of the version; history is never rewritten. */
  restore: (workspaceId: string, agentId: string, version: number, body: RestoreAgentVersionInput) => {
    const [path, scope] = workspacePath(workspaceId, `/agents/${id(agentId)}/versions/${Math.trunc(version)}/restore`);
    return call<Agent>(path, { ...scope, method: 'POST', body });
  },

  /**
   * P4-API-11. Builds the turn as a send would (retrieval as you, budgeting, masking,
   * egress scan) without calling the model or storing anything. Shares the rag
   * throttle. The answer is sensitive: never cached.
   */
  promptPreview: (workspaceId: string, agentId: string, body: PromptPreviewInput, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, `/agents/${id(agentId)}/prompt-preview`);
    return call<PromptPreview>(path, { ...scope, method: 'POST', body, timeoutMs: PREVIEW_TIMEOUT_MS, signal });
  },
};

export const conversationsApi = {
  /** P4-API-12. `scope: 'all'` needs conversation:read_all; other people's titles arrive masked. */
  list: (workspaceId: string, params: ListConversationsParams = {}, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, '/conversations');
    return callPaginated<Conversation>(path, { ...scope, query: { ...params }, signal });
  },

  /** P4-API-13. No model call. The title stays empty until the first question unless one is given. */
  create: (workspaceId: string, body: CreateConversationInput) => {
    const [path, scope] = workspacePath(workspaceId, '/conversations');
    return call<Conversation>(path, { ...scope, method: 'POST', body });
  },

  /** P4-API-14. Someone else's (supervision) comes back with a masked title and `isOwner: false`. */
  get: (workspaceId: string, conversationId: string, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, `/conversations/${id(conversationId)}`);
    return call<Conversation>(path, { ...scope, signal });
  },

  /** P4-API-15. Owner only: rename, archive, unarchive. */
  update: (workspaceId: string, conversationId: string, body: UpdateConversationInput) => {
    const [path, scope] = workspacePath(workspaceId, `/conversations/${id(conversationId)}`);
    return call<Conversation>(path, { ...scope, method: 'PATCH', body });
  },

  /** P4-API-16. The conversation's key is destroyed: its messages are unrecoverable at once. */
  remove: (workspaceId: string, conversationId: string) => {
    const [path, scope] = workspacePath(workspaceId, `/conversations/${id(conversationId)}`);
    return call<{ deleted: true }>(path, { ...scope, method: 'DELETE' });
  },

  /**
   * P4-API-17. The newest `limit` messages before `before`, chronologically. Every
   * message is re-checked against your access today (withheld ones have no content).
   * `reveal` needs pii:reveal, is audited, and its pages are never cached.
   */
  messages: (workspaceId: string, conversationId: string, params: ListMessagesParams = {}, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, `/conversations/${id(conversationId)}/messages`);
    return call<MessagePage>(path, {
      ...scope,
      // The server reads only the literal 'true'.
      query: { limit: params.limit, before: params.before, reveal: params.reveal ? 'true' : undefined },
      signal,
    });
  },

  /**
   * P4-API-18. The whole turn in one answer. A timeout or dropped connection leaves
   * the outcome unknown: reconcile with a read, never resend blindly (§9.4).
   */
  send: (workspaceId: string, conversationId: string, body: SendMessageInput, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, `/conversations/${id(conversationId)}/messages`);
    return call<TurnResult>(path, { ...scope, method: 'POST', body, timeoutMs: INFERENCE_TIMEOUT_MS, signal });
  },

  /** P4-API-19. The same turn as events; read with `postEventStream` (lib/agents/stream). */
  stream: (
    workspaceId: string,
    conversationId: string,
    body: SendMessageInput,
    options: { onMessage: (message: SseMessage) => void; signal?: AbortSignal },
  ) => {
    const [path, scope] = workspacePath(workspaceId, `/conversations/${id(conversationId)}/messages/stream`);
    return openEventStream(path, { ...scope, body, ...options });
  },
};

export const llmApi = {
  /** P4-API-20. Masked before it leaves; nothing is stored except a content-free usage record. */
  chat: (workspaceId: string, body: DirectChatInput, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, '/llm/chat');
    return call<ChatCompletion>(path, { ...scope, method: 'POST', body, timeoutMs: INFERENCE_TIMEOUT_MS, signal });
  },

  /** P4-API-21. Direct chat as events. A context overflow arrives as an `error` event here. */
  chatStream: (
    workspaceId: string,
    body: DirectChatInput,
    options: { onMessage: (message: SseMessage) => void; signal?: AbortSignal },
  ) => {
    const [path, scope] = workspacePath(workspaceId, '/llm/chat/stream');
    return openEventStream(path, { ...scope, body, ...options });
  },

  /** P4-API-22. Fetched from the endpoint and cached there for 60 s; `verified: false` when it couldn't be asked. */
  models: (workspaceId: string, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, '/llm/models');
    return call<LlmModels>(path, { ...scope, signal });
  },

  /** P4-API-23. `effective` is what requests actually get. */
  policy: (workspaceId: string, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, '/llm/policy');
    return call<LlmPolicy>(path, { ...scope, signal });
  },

  /** P4-API-24. A partial update despite PUT; a stale `expectedVersion` answers 409 RESOURCE_CONFLICT. */
  updatePolicy: (workspaceId: string, body: UpdateLlmPolicyInput) => {
    const [path, scope] = workspacePath(workspaceId, '/llm/policy');
    return call<LlmPolicy>(path, { ...scope, method: 'PUT', body, localCodes: ['RESOURCE_CONFLICT'] });
  },

  /** P4-API-25. Every model call in the workspace, workflows included. Defaults to the last 30 days. */
  usage: (workspaceId: string, window: { from?: string; to?: string } = {}, signal?: AbortSignal) => {
    const [path, scope] = workspacePath(workspaceId, '/llm/usage');
    return call<UsageSummary>(path, { ...scope, query: { from: window.from, to: window.to }, signal });
  },
};
