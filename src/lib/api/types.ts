/**
 * Wire types for the AgentVault backend (spec Appendix A). Every shape here was
 * checked against a running backend. Fields the backend documents but does not yet
 * return are optional (see the BF-* notes).
 */

// ── Envelope ────────────────────────────────────────────────────────────────
export interface PaginationMeta {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
}

export interface ResponseMeta {
  requestId: string;
  timestamp: string;
  durationMs?: number;
  path?: string; // failures only
  pagination?: PaginationMeta;
}

export interface ApiErrorBody {
  code: ErrorCode | (string & {});
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: ResponseMeta;
}

export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
  meta: ResponseMeta;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export interface ApiResult<T> {
  data: T;
  meta: ResponseMeta;
}

export interface Paginated<T> {
  items: T[];
  pagination: PaginationMeta;
}

// ── Auth ────────────────────────────────────────────────────────────────────
export type UserStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  emailVerified: boolean;
  isPlatformAdmin: boolean;
  status: UserStatus;
  /** Present on login / register / mfa-verify, absent on GET /auth/me (BF-5). */
  mfaEnabled?: boolean;
}

export interface TokenPair {
  accessToken: string;
  tokenType: 'Bearer';
  /** Seconds (900). Prefer computing expiry from this, not from expiresAt. */
  expiresIn: number;
  expiresAt: string;
  refreshExpiresIn: number;
  /** Absent when the refresh cookie is enabled (the default). */
  refreshToken?: string;
}

export interface AuthResponse {
  user: AuthUser;
  tokens: TokenPair;
}

export interface MfaChallenge {
  token: string;
  expiresAt: string;
  methods: Array<'totp' | 'recovery_code'>;
}

export interface MfaRequiredResponse {
  mfaRequired: true;
  challenge: MfaChallenge;
}

export type LoginResponse = AuthResponse | MfaRequiredResponse;

export const isMfaRequired = (response: LoginResponse): response is MfaRequiredResponse =>
  'mfaRequired' in response && response.mfaRequired === true;

export interface RefreshResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  expiresAt: string;
  refreshExpiresIn: number;
}

export interface MembershipSummary {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  roleSlugs: string[];
  isOwner: boolean;
}

export interface CurrentUser extends Omit<AuthUser, 'mfaEnabled'> {
  memberships: MembershipSummary[];
  /** BF-1: documented, not returned today. Used automatically once it is. */
  permissions?: string[];
  /** BF-1: documented, not returned today. */
  activeOrganizationId?: string;
  /** BF-5: documented, not returned today. */
  avatarUrl?: string | null;
}

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export type MfaVerifyRequest =
  | { challengeToken: string; code: string }
  | { challengeToken: string; recoveryCode: string };

export interface UpdateProfileRequest {
  firstName?: string;
  lastName?: string;
  displayName?: string;
}

export interface UpdateProfileResponse {
  id: string;
  displayName: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ChangePasswordResponse {
  changed: true;
  revokedSessions: number;
}

export interface Session {
  id: string;
  deviceLabel: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  isCurrent: boolean;
}

export interface MfaStatus {
  enabled: boolean;
  enrolledAt: string | null;
  recoveryCodesRemaining: number;
  sessionVerified: boolean;
}

export interface MfaSetup {
  secret: string;
  otpauthUri: string;
  issuer: string;
  account: string;
}

export interface MfaEnableResponse {
  recoveryCodes: string[];
  accessToken?: string;
  expiresIn?: number;
}

export type SecondFactor = { code: string } | { recoveryCode: string };

export interface EraseAccountRequest {
  password: string;
  confirmation: 'ERASE MY ACCOUNT';
  code?: string;
  recoveryCode?: string;
}

export interface ErasureOutcome {
  erased: true;
  workspacesDeleted: string[];
  conversationsShredded: number;
  workflowRunsShredded: number;
  apiKeysRevoked: number;
  membershipsEnded: number;
}

export interface ErasureBlockedWorkspace {
  id: string;
  name: string;
  otherMembers: number;
}

// ── Workspaces ──────────────────────────────────────────────────────────────
export interface OrganizationSettings {
  defaultChunkSize?: number;
  defaultChunkOverlap?: number;
  auditRetentionDays?: number;
  requireMfa?: boolean;
  requireVerifiedEmail?: boolean;
  allowedEmailDomains?: string[];
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  plan: 'FREE' | 'PRO' | 'ENTERPRISE';
  ownerId: string;
  settings: OrganizationSettings;
  ipAllowlistEnabled: boolean;
  memberCount: number;
  createdAt: string;
}

export interface OrganizationWithMembership extends Organization {
  roleSlugs: string[];
  isOwner: boolean;
  joinedAt: string | null;
}

export interface CreateOrganizationRequest {
  name: string;
  slug?: string;
  description?: string;
}

export interface MemberRole {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  priority: number;
}

export type MembershipStatus = 'ACTIVE' | 'SUSPENDED' | 'REMOVED';

export interface Member {
  id: string; // membership id, not the user id
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  avatarUrl: string | null;
  title: string | null;
  status: MembershipStatus;
  roles: MemberRole[];
  highestRolePriority: number;
  isOwner: boolean;
  joinedAt: string | null;
  lastActiveAt: string | null;
  createdAt: string;
}

export interface Role {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isSystem: boolean;
  isDefault: boolean;
  priority: number;
  color: string | null;
  permissionKeys: string[];
  createdAt: string;
}

export interface PermissionDefinition {
  key: string;
  resource: string;
  action: string;
  category: string;
  description: string;
  isDangerous: boolean;
  phase: number;
}

export interface PermissionCatalogue {
  permissions: PermissionDefinition[];
  byCategory: Record<string, string[]>;
}

export interface HealthStatus {
  status: string;
  uptime: number;
  environment: string;
  timestamp: string;
}

// ── Phase 2: workspace administration (spec Appendix A) ─────────────────────

/** `null` clears a setting back to its default; omitted settings are left alone (BF-6). */
export type OrganizationSettingsPatch = { [K in keyof OrganizationSettings]?: OrganizationSettings[K] | null };

export interface UpdateOrganizationRequest {
  name?: string;
  description?: string;
  /** '' removes the logo. */
  logoUrl?: string;
  settings?: OrganizationSettingsPatch;
}

/** A user id, not a membership id (a membership id answers 404). */
export interface TransferOwnershipRequest {
  newOwnerUserId: string;
}

export interface IpRule {
  id: string;
  cidr: string;
  label: string | null;
  /** Always true. */
  isActive: boolean;
  /** Recorded at most once a minute while enforcement is on. */
  lastMatchedAt: string | null;
  createdAt: string;
}

export interface CreateIpRuleRequest {
  cidr: string;
  label?: string;
}

export type MemberSortField = 'createdAt' | 'joinedAt' | 'name' | 'email' | 'status' | 'lastActiveAt';
export type SortDirection = 'ASC' | 'DESC';

export interface ListMembersParams {
  page?: number;
  /** ≤100 */
  limit?: number;
  search?: string;
  /** Omitted: active and suspended. */
  status?: MembershipStatus;
  roleId?: string;
  sortBy?: MemberSortField;
  sortDirection?: SortDirection;
}

/** '' clears a field. */
export interface UpdateMemberProfileRequest {
  displayName?: string;
  title?: string;
}

/** 1–20 role ids; replaces the member's roles. */
export interface SetMemberRolesRequest {
  roleIds: string[];
}

export interface SuspendMemberRequest {
  reason?: string;
}

export interface RemoveMemberResponse {
  removed: true;
  revokedApiKeys: number;
}

export type InvitationStatusValue = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

export interface Invitation {
  id: string;
  /** Keeps the case it was typed in. */
  email: string;
  status: InvitationStatusValue;
  role: { id: string; name: string; slug: string } | null;
  invitedBy: { id: string; name: string } | null;
  expiresAt: string;
  createdAt: string;
  lastSentAt: string | null;
  sendCount: number;
}

export interface ListInvitationsParams {
  page?: number;
  limit?: number;
  status?: InvitationStatusValue;
}

export interface CreateInvitationRequest {
  email: string;
  roleId?: string;
  message?: string;
}

export interface InvitationPreview {
  organizationName: string;
  organizationSlug: string;
  roleName: string;
  inviterName: string;
  /** Masked, e.g. "in****@example.com". */
  email: string;
  expiresAt: string;
  requiresRegistration: boolean;
}

export interface AcceptInvitationResponse {
  organizationId: string;
  organizationSlug: string;
  memberId: string;
}

export interface CreateRoleRequest {
  name: string;
  description?: string;
  permissionKeys: string[];
  /** 0–99, below yours; default 40. */
  priority?: number;
  color?: string;
}

/** Send only the changed fields. */
export type UpdateRoleRequest = Partial<CreateRoleRequest>;

export interface ApiKey {
  id: string;
  name: string;
  description: string | null;
  prefix: string;
  scopes: string[];
  /** A user id. */
  createdById: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  /** A string: it is a 64-bit counter. */
  usageCount: string;
  allowedIps: string[];
  createdAt: string;
}

export interface CreateApiKeyRequest {
  name: string;
  description?: string;
  scopes: string[];
  /** ISO, in the future; omit for 365 days. */
  expiresAt?: string;
  allowedIps?: string[];
}

export interface CreatedApiKey {
  apiKey: ApiKey;
  plaintextKey: string;
  warning: string;
}

// ── Phase 3: knowledge bases, documents, retrieval (spec Appendix A) ─────────

export type Classification = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';
export type KnowledgeBaseAccessMode = 'WORKSPACE' | 'RESTRICTED';
export type AccessLevel = 'READ' | 'WRITE' | 'MANAGE';

export interface KnowledgeBaseStats {
  /** Within your clearance. */
  documents: number;
  ready: number;
  /** UPLOADED + PARSING + CHUNKING + EMBEDDING */
  processing: number;
  failed: number;
  /** A 64-bit count, sent as a string. */
  totalBytes: string;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  accessMode: KnowledgeBaseAccessMode;
  defaultClassification: Classification;
  embeddingModel: string;
  embeddingDimensions: number;
  /** null: inherited (knowledge base → workspace → platform). */
  chunkSize: number | null;
  chunkOverlap: number | null;
  /** Your effective level: MANAGE on every workspace-mode base. */
  access: AccessLevel;
  stats: KnowledgeBaseStats;
  /** A user id. */
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListKnowledgeBasesParams {
  page?: number;
  /** ≤100 */
  limit?: number;
  search?: string;
  sortBy?: 'name' | 'createdAt' | 'updatedAt';
  sortDirection?: SortDirection;
}

export interface CreateKnowledgeBaseRequest {
  name: string;
  description?: string;
  accessMode?: KnowledgeBaseAccessMode;
  defaultClassification?: Classification;
  chunkSize?: number;
  chunkOverlap?: number;
}

/** Send only what changed. */
export interface UpdateKnowledgeBaseRequest {
  name?: string;
  /** null or '' removes it. */
  description?: string | null;
  accessMode?: KnowledgeBaseAccessMode;
  defaultClassification?: Classification;
  /** null: back to inheriting. */
  chunkSize?: number | null;
  chunkOverlap?: number | null;
}

export type GrantSubjectType = 'ROLE' | 'MEMBER' | 'API_KEY';

export interface KnowledgeBaseGrant {
  id: string;
  subjectType: GrantSubjectType;
  /** A role id, a MEMBERSHIP id, or an API key id. */
  subjectId: string;
  subjectLabel: string | null;
  accessLevel: AccessLevel;
  /** A user id. */
  grantedById: string | null;
  createdAt: string;
}

export interface UpsertGrantRequest {
  subjectType: GrantSubjectType;
  subjectId: string;
  accessLevel: AccessLevel;
}

export type DocumentStatus = 'UPLOADED' | 'PARSING' | 'CHUNKING' | 'EMBEDDING' | 'READY' | 'FAILED';
export type DocumentFileType = 'PDF' | 'DOCX' | 'TXT' | 'MARKDOWN';

/** Keys may be missing; show only those present. */
export interface DocumentProcessingMetrics {
  queueWaitMs?: number;
  downloadMs?: number;
  parseMs?: number;
  persistMs?: number;
  embedMs?: number;
  indexMs?: number;
  totalMs?: number;
  attempts?: number;
  embeddingTokens?: number;
}

/** A vault document. Named so it doesn't clash with the DOM's `Document`. */
export interface VaultDocument {
  id: string;
  knowledgeBaseId: string;
  title: string;
  description: string | null;
  tags: string[];
  originalFilename: string;
  fileType: DocumentFileType;
  /** Detected from the content. */
  mimeType: string;
  /** A 64-bit count, sent as a string. */
  sizeBytes: string;
  classification: Classification;
  status: DocumentStatus;
  /** A failure explanation, or a retry notice while in progress. */
  statusMessage: string | null;
  /** An open set (spec §4.1.2): never switch on it exhaustively. */
  failureCode: string | null;
  isSearchable: boolean;
  /** The run in progress, or the last one. */
  indexVersion: number;
  /** The version retrieval serves; null until the first run succeeds. */
  activeIndexVersion: number | null;
  chunkCount: number;
  tokenCount: number;
  pageCount: number | null;
  language: string | null;
  embeddingModel: string | null;
  processingMetrics: DocumentProcessingMetrics;
  /** A user id; null when an API key uploaded it or the account was erased. */
  uploadedById: string | null;
  /** Changes on every transition, and as a heartbeat while embedding. */
  lastStatusAt: string;
  processingCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DocumentSortField = 'createdAt' | 'updatedAt' | 'title' | 'sizeBytes' | 'status';

export interface ListDocumentsParams {
  page?: number;
  /** ≤100 */
  limit?: number;
  knowledgeBaseId?: string;
  /** Sent comma-separated (BF-18). */
  status?: DocumentStatus[];
  classification?: Classification;
  search?: string;
  sortBy?: DocumentSortField;
  sortDirection?: SortDirection;
}

export interface UploadDocumentFields {
  title?: string;
  description?: string;
  classification?: Classification;
  /** Sent as one comma-separated string. */
  tags?: string[];
}

/** Send only what changed. */
export interface UpdateDocumentRequest {
  title?: string;
  /** null or '' removes it. */
  description?: string | null;
  classification?: Classification;
  /** Replaces the tags; [] removes them. */
  tags?: string[];
}

export interface DocumentChunk {
  id: string;
  chunkIndex: number;
  text: string;
  tokenCount: number;
  pageStart: number | null;
  pageEnd: number | null;
}

export type RetrievalMode = 'hybrid' | 'dense';

export interface RetrievalQuery {
  query: string;
  knowledgeBaseIds?: string[];
  documentIds?: string[];
  /** Capped at 50 by the server. */
  topK?: number;
  mode?: RetrievalMode;
  /** Dense mode only. */
  minScore?: number;
  rerank?: boolean;
}

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  classification: Classification;
  chunkIndex: number;
  pageStart: number | null;
  pageEnd: number | null;
  /** From 1. */
  rank: number;
  /** Comparable within one response only: never a percentage. */
  score: number;
  text: string;
}

export interface RetrievalTimings {
  accessMs: number;
  embedMs: number;
  searchMs: number;
  hydrateMs: number;
  rerankMs: number;
  totalMs: number;
}

export interface RetrievalResponse {
  retrievalId: string;
  mode: RetrievalMode;
  topK: number;
  reranked: boolean;
  embeddingModel: string;
  knowledgeBasesSearched: number;
  clearance: Classification;
  effectiveClearance: Classification;
  results: RetrievedChunk[];
  timings: RetrievalTimings;
}

export interface AccessScopeKnowledgeBase {
  id: string;
  name: string;
  accessMode: KnowledgeBaseAccessMode;
  access: AccessLevel;
}

export interface AccessScope {
  clearance: Classification;
  readableClassifications: Classification[];
  bypassesCompartments: boolean;
  knowledgeBases: AccessScopeKnowledgeBase[];
}

export interface DetectedEntity {
  entityType: string;
  /** In the normalised text (NFKC, unified line endings): for ordering only. */
  start: number;
  end: number;
  score: number;
  source: 'pattern' | 'ner' | 'custom' | 'propagation';
  /** Informational; never branch on it. */
  recognizer: string;
  /** e.g. "[PERSON_1]" */
  placeholder: string;
  /** Only when revealed. */
  value?: string;
}

export interface ChunkPiiReport {
  chunkId: string;
  chunkIndex: number;
  pageStart: number | null;
  maskedText: string;
  entities: DetectedEntity[];
}

export interface DocumentPiiReport {
  documentId: string;
  chunks: ChunkPiiReport[];
  /** This page only. */
  byType: Record<string, number>;
  /** This page only. */
  entityCount: number;
  page: number;
  totalChunks: number;
  degraded: boolean;
  revealed: boolean;
  timings: { patternMs: number; nerMs: number; maskingMs: number; totalMs: number };
}

/** GET …/pii/entity-types (a Phase 4 endpoint, `pii:policy:read`). */
export interface PiiEntityType {
  type: string;
  label: string;
  description: string;
  detector: 'pattern' | 'ner' | 'custom';
  /** Whether this deployment can detect it right now. */
  available: boolean;
  enabled: boolean;
  example: string;
}

/** GET …/pii/policy (a Phase 4 endpoint, `pii:policy:read`). Phase 3 reads `enabled` only. */
export interface PiiPolicy {
  source: 'default' | 'workspace';
  version: number;
  enabled: boolean;
  entityTypes: string[];
  nerEntityTypes: string[];
  scoreThreshold: number;
  onDetectorFailure: 'REFUSE' | 'DEGRADE_TO_PATTERNS';
  language: string;
  allowList: string[];
  denyList: string[] | null;
  denyListCount: number;
  nerDetector: { kind: string; configured: boolean; missingConfiguration: string[] };
  warnings: string[];
  updatedAt: string | null;
}

// ── Error codes (full list: backend src/common/enums/error-code.enum.ts) ────
export type ErrorCode =
  | 'INTERNAL_SERVER_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'RESOURCE_NOT_FOUND'
  | 'RESOURCE_CONFLICT'
  | 'REQUEST_TIMEOUT'
  | 'AUTH_INVALID_CREDENTIALS'
  | 'AUTH_TOKEN_MISSING'
  | 'AUTH_TOKEN_INVALID'
  | 'AUTH_TOKEN_EXPIRED'
  | 'AUTH_TOKEN_REVOKED'
  | 'AUTH_REFRESH_TOKEN_INVALID'
  | 'AUTH_REFRESH_TOKEN_REUSED'
  | 'AUTH_SESSION_NOT_FOUND'
  | 'AUTH_PASSWORD_MISMATCH'
  | 'AUTH_PASSWORD_REUSED'
  | 'AUTH_PASSWORD_BREACHED'
  | 'MFA_CODE_INVALID'
  | 'MFA_CHALLENGE_INVALID'
  | 'MFA_ALREADY_ENABLED'
  | 'MFA_NOT_ENABLED'
  | 'MFA_NOT_ENROLLING'
  | 'MFA_REQUIRED'
  | 'ACCOUNT_ALREADY_EXISTS'
  | 'ACCOUNT_EMAIL_NOT_VERIFIED'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_DEACTIVATED'
  | 'ACCOUNT_LOCKED'
  | 'TOKEN_NOT_FOUND'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_ALREADY_USED'
  | 'FORBIDDEN'
  | 'PERMISSION_DENIED'
  | 'ORGANIZATION_CONTEXT_REQUIRED'
  | 'ORGANIZATION_NOT_FOUND'
  | 'ORGANIZATION_SLUG_TAKEN'
  | 'ORGANIZATION_SLUG_RESERVED'
  | 'ORGANIZATION_SUSPENDED'
  | 'ORGANIZATION_LIMIT_REACHED'
  | 'IP_NOT_ALLOWED'
  | 'MEMBERSHIP_SUSPENDED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'ACCOUNT_ERASURE_BLOCKED'
  | 'ACCOUNT_ERASURE_DISABLED'
  // Phase 2
  | 'CANNOT_MODIFY_SELF'
  | 'CANNOT_ESCALATE_PRIVILEGES'
  | 'CANNOT_REMOVE_LAST_OWNER'
  | 'ROLE_NOT_FOUND'
  | 'ROLE_ALREADY_EXISTS'
  | 'ROLE_IMMUTABLE'
  | 'ROLE_IN_USE'
  | 'PERMISSION_NOT_FOUND'
  | 'MEMBERSHIP_NOT_FOUND'
  | 'MEMBERSHIP_ALREADY_EXISTS'
  | 'SEAT_LIMIT_REACHED'
  | 'IP_ALLOWLIST_SELF_LOCKOUT'
  | 'INVITATION_NOT_FOUND'
  | 'INVITATION_EXPIRED'
  | 'INVITATION_ALREADY_ACCEPTED'
  | 'INVITATION_REVOKED'
  | 'INVITATION_EMAIL_MISMATCH'
  | 'INVITATION_ALREADY_PENDING'
  | 'API_KEY_NOT_FOUND'
  | 'API_KEY_INVALID'
  | 'API_KEY_EXPIRED'
  | 'API_KEY_REVOKED'
  // Phase 3
  | 'KNOWLEDGE_BASE_NOT_FOUND'
  | 'KNOWLEDGE_BASE_NAME_TAKEN'
  | 'KNOWLEDGE_BASE_ACCESS_DENIED'
  | 'KNOWLEDGE_BASE_GRANT_NOT_FOUND'
  | 'CLASSIFICATION_EXCEEDS_CLEARANCE'
  | 'DOCUMENT_NOT_FOUND'
  | 'DOCUMENT_DUPLICATE'
  | 'DOCUMENT_TYPE_NOT_ALLOWED'
  | 'DOCUMENT_CONTENT_MISMATCH'
  | 'DOCUMENT_EMPTY'
  | 'DOCUMENT_PROCESSING'
  | 'DOCUMENT_CONTENT_UNAVAILABLE'
  | 'STORAGE_QUOTA_EXCEEDED'
  | 'PAYLOAD_TOO_LARGE'
  | 'KNOWLEDGE_LAYER_NOT_CONFIGURED'
  | 'AI_SERVICE_UNAVAILABLE'
  | 'VECTOR_STORE_UNAVAILABLE'
  | 'OBJECT_STORAGE_UNAVAILABLE'
  | 'PII_DETECTION_UNAVAILABLE'
  | 'AUTH_SCHEME_NOT_ALLOWED'
  | 'NETWORK_ERROR'; // client-side only: the request never got an API answer
