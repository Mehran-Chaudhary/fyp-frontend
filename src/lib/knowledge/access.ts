import type { AccessLevel, Classification, KnowledgeBase, KnowledgeBaseGrant } from '../api/types';

/**
 * The knowledge layer's access model (Phase 3 spec §3), mirrored so screens offer
 * only what can succeed. Every rule here was checked against the server's answers
 * for the five demo roles (§3.6); the server still decides.
 */

export const CLASSIFICATIONS: readonly Classification[] = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'];

const CLEARANCE_PERMISSION: Readonly<Record<Exclude<Classification, 'PUBLIC'>, string>> = {
  INTERNAL: 'clearance:internal',
  CONFIDENTIAL: 'clearance:confidential',
  RESTRICTED: 'clearance:restricted',
};

/** The highest tier whose clearance permission you hold (§3.3). Same answer as P3-API-23's `clearance`. */
export function clearanceOf(myPermissions: ReadonlySet<string>): Classification {
  for (const level of ['RESTRICTED', 'CONFIDENTIAL', 'INTERNAL'] as const) {
    if (myPermissions.has(CLEARANCE_PERMISSION[level])) return level;
  }
  return 'PUBLIC';
}

export const rankOf = (classification: Classification): number => CLASSIFICATIONS.indexOf(classification);

export const withinClearance = (classification: Classification, clearance: Classification): boolean =>
  rankOf(classification) <= rankOf(clearance);

/** Classifications you may assign: upload, reclassify, a base's default. */
export const assignableClassifications = (myPermissions: ReadonlySet<string>): Classification[] =>
  CLASSIFICATIONS.slice(0, rankOf(clearanceOf(myPermissions)) + 1);

/** The classifications a clearance can read (P3-API-23's `readableClassifications`). */
export const readableClassifications = (clearance: Classification): Classification[] =>
  CLASSIFICATIONS.slice(0, rankOf(clearance) + 1);

/**
 * What the upload form preselects (§5 "Upload"). Always send the result: an upload without a
 * classification uses the base's default, which is refused when above your clearance.
 */
export function defaultUploadClassification(
  knowledgeBase: Pick<KnowledgeBase, 'defaultClassification'>,
  myPermissions: ReadonlySet<string>,
): { value: Classification; aboveClearance: boolean } {
  const clearance = clearanceOf(myPermissions);
  return withinClearance(knowledgeBase.defaultClassification, clearance)
    ? { value: knowledgeBase.defaultClassification, aboveClearance: false }
    : { value: clearance, aboveClearance: true };
}

const LEVEL_RANK: Readonly<Record<AccessLevel, number>> = { READ: 1, WRITE: 2, MANAGE: 3 };

export const ACCESS_LEVELS: readonly AccessLevel[] = ['READ', 'WRITE', 'MANAGE'];

export const atLeast = (level: AccessLevel | null | undefined, required: AccessLevel): boolean =>
  !!level && LEVEL_RANK[level] >= LEVEL_RANK[required];

export type KnowledgeAction =
  | 'viewDocuments'
  | 'upload'
  | 'editDocument'
  | 'reindex'
  | 'deleteDocument'
  | 'download'
  | 'piiReport'
  | 'revealPii'
  | 'search'
  | 'viewGrants'
  | 'manageGrants'
  | 'editKnowledgeBase'
  | 'deleteKnowledgeBase';

/** §3.5: every permission is required, and at least this level on the knowledge base. */
export const KNOWLEDGE_RULES: Readonly<Record<KnowledgeAction, { permissions: readonly string[]; level: AccessLevel }>> = {
  viewDocuments: { permissions: ['document:read'], level: 'READ' },
  upload: { permissions: ['document:create'], level: 'WRITE' },
  editDocument: { permissions: ['document:update'], level: 'WRITE' },
  reindex: { permissions: ['document:reindex'], level: 'WRITE' },
  deleteDocument: { permissions: ['document:delete'], level: 'WRITE' },
  download: { permissions: ['document:download'], level: 'READ' },
  piiReport: { permissions: ['document:read', 'pii:policy:read'], level: 'READ' },
  revealPii: { permissions: ['document:read', 'pii:policy:read', 'pii:reveal'], level: 'READ' },
  search: { permissions: ['rag:query'], level: 'READ' },
  viewGrants: { permissions: ['knowledgebase:read'], level: 'MANAGE' },
  manageGrants: { permissions: ['knowledgebase:update'], level: 'MANAGE' },
  editKnowledgeBase: { permissions: ['knowledgebase:update'], level: 'MANAGE' },
  deleteKnowledgeBase: { permissions: ['knowledgebase:delete'], level: 'MANAGE' },
};

/** Whether the action can succeed on a document of this base (or on the base itself). */
export function canOnKnowledgeBase(
  action: KnowledgeAction,
  knowledgeBase: Pick<KnowledgeBase, 'access'>,
  myPermissions: ReadonlySet<string>,
): boolean {
  const rule = KNOWLEDGE_RULES[action];
  return rule.permissions.every((permission) => myPermissions.has(permission)) && atLeast(knowledgeBase.access, rule.level);
}

/** Whether the role permission alone is missing (hide), as opposed to a low level (disable). */
export const lacksPermissionFor = (action: KnowledgeAction, myPermissions: ReadonlySet<string>): boolean =>
  !KNOWLEDGE_RULES[action].permissions.every((permission) => myPermissions.has(permission));

/**
 * Why an action is unavailable on a base (spec §3.7, Appendix A): `permission` → hide
 * the control in this workspace, `level` → show it disabled with a reason, `null` →
 * allowed. The server still decides; every 403/404 is handled anyway.
 */
export function deniedBecause(
  action: KnowledgeAction,
  knowledgeBase: Pick<KnowledgeBase, 'access'>,
  myPermissions: ReadonlySet<string>,
): 'permission' | 'level' | null {
  if (lacksPermissionFor(action, myPermissions)) return 'permission';
  if (!atLeast(knowledgeBase.access, KNOWLEDGE_RULES[action].level)) return 'level';
  return null;
}

/**
 * Whether revoking or lowering this grant can remove the actor's own access (§3.2,
 * P3-G07): their own MEMBER grant or a grant to one of their roles. Owners bypass
 * compartments and are never warned.
 */
export function affectsOwnAccess(
  grant: Pick<KnowledgeBaseGrant, 'subjectType' | 'subjectId'>,
  me: { membershipId: string; roleIds: readonly string[]; isOwner: boolean },
): boolean {
  if (me.isOwner) return false;
  if (grant.subjectType === 'MEMBER') return grant.subjectId === me.membershipId;
  if (grant.subjectType === 'ROLE') return me.roleIds.includes(grant.subjectId);
  return false;
}

/**
 * Your level on a RESTRICTED base after a grant change (§5 "Access tab"): the strongest of your member
 * grant and the grants to your roles. `null` means you would lose access. Owners bypass
 * compartments, so check `membership.isOwner` before warning.
 */
export function myLevelAfter(
  grants: readonly KnowledgeBaseGrant[],
  me: { membershipId: string; roleIds: readonly string[] },
  change: { removeGrantId: string } | { grantId: string; accessLevel: AccessLevel },
): AccessLevel | null {
  let best: AccessLevel | null = null;
  for (const grant of grants) {
    if ('removeGrantId' in change && grant.id === change.removeGrantId) continue;
    const level = 'grantId' in change && grant.id === change.grantId ? change.accessLevel : grant.accessLevel;
    const mine =
      (grant.subjectType === 'MEMBER' && grant.subjectId === me.membershipId) ||
      (grant.subjectType === 'ROLE' && me.roleIds.includes(grant.subjectId));
    if (mine && (!best || LEVEL_RANK[level] > LEVEL_RANK[best])) best = level;
  }
  return best;
}

/**
 * Every permission key the knowledge screens ask about. The permission snapshot can
 * hold wildcards (`document:*`), so the screens resolve these through `can()` into
 * the concrete set the rules above expect.
 */
export const KNOWLEDGE_PERMISSION_KEYS = [
  'document:read',
  'document:create',
  'document:update',
  'document:reindex',
  'document:delete',
  'document:download',
  'knowledgebase:read',
  'knowledgebase:create',
  'knowledgebase:update',
  'knowledgebase:delete',
  'rag:query',
  'pii:policy:read',
  'pii:policy:update',
  'pii:reveal',
  'clearance:internal',
  'clearance:confidential',
  'clearance:restricted',
] as const;
