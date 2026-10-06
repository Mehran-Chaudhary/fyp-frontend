import { describe, expect, it } from 'vitest';
import type { KnowledgeBaseGrant } from '../api/types';
import {
  affectsOwnAccess,
  assignableClassifications,
  deniedBecause,
  atLeast,
  canOnKnowledgeBase,
  clearanceOf,
  defaultUploadClassification,
  lacksPermissionFor,
  myLevelAfter,
  readableClassifications,
  withinClearance,
  type KnowledgeAction,
} from './access';

// The demo workspace's roles, as the server grants them (Phase 3 spec §3.6).
const owner = new Set([
  'document:read', 'document:create', 'document:update', 'document:reindex', 'document:delete', 'document:download',
  'knowledgebase:read', 'knowledgebase:create', 'knowledgebase:update', 'knowledgebase:delete',
  'rag:query', 'pii:policy:read', 'pii:policy:update', 'pii:reveal',
  'clearance:internal', 'clearance:confidential', 'clearance:restricted',
]);
const admin = new Set([...owner].filter((key) => key !== 'pii:reveal' && key !== 'clearance:restricted'));
const hr = new Set([
  'knowledgebase:read', 'knowledgebase:create', 'knowledgebase:update',
  'document:read', 'document:create', 'document:update', 'document:download',
  'rag:query', 'clearance:restricted',
]);
const employee = new Set([
  'knowledgebase:read', 'document:read', 'document:create', 'document:reindex',
  'rag:query', 'pii:policy:read', 'clearance:internal',
]);
const auditor = new Set(['document:read', 'knowledgebase:read', 'clearance:confidential', 'pii:policy:read']);

const handbook = { access: 'MANAGE' as const }; // WORKSPACE mode: MANAGE for everyone who sees it
const readGrant = { access: 'READ' as const };

const can = (actions: KnowledgeAction[], kb: { access: 'READ' | 'WRITE' | 'MANAGE' }, permissions: Set<string>) =>
  Object.fromEntries(actions.map((action) => [action, canOnKnowledgeBase(action, kb, permissions)]));

describe('clearanceOf', () => {
  it('matches the demo accounts', () => {
    expect(clearanceOf(owner)).toBe('RESTRICTED');
    expect(clearanceOf(hr)).toBe('RESTRICTED');
    expect(clearanceOf(admin)).toBe('CONFIDENTIAL');
    expect(clearanceOf(auditor)).toBe('CONFIDENTIAL');
    expect(clearanceOf(employee)).toBe('INTERNAL');
  });

  it('is hierarchical: the highest permission held wins', () => {
    expect(clearanceOf(new Set(['clearance:restricted']))).toBe('RESTRICTED');
  });

  it('is PUBLIC without any clearance permission', () => {
    expect(clearanceOf(new Set())).toBe('PUBLIC');
  });
});

describe('classifications', () => {
  it('lists what a clearance may assign', () => {
    expect(assignableClassifications(employee)).toEqual(['PUBLIC', 'INTERNAL']);
    expect(assignableClassifications(admin)).toEqual(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL']);
    expect(assignableClassifications(owner)).toEqual(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']);
    expect(assignableClassifications(new Set())).toEqual(['PUBLIC']);
  });

  it('lists what a clearance may read', () => {
    expect(readableClassifications('INTERNAL')).toEqual(['PUBLIC', 'INTERNAL']);
  });

  it('compares against a clearance', () => {
    expect(withinClearance('CONFIDENTIAL', 'INTERNAL')).toBe(false);
    expect(withinClearance('INTERNAL', 'INTERNAL')).toBe(true);
    expect(withinClearance('PUBLIC', 'RESTRICTED')).toBe(true);
  });
});

describe('defaultUploadClassification', () => {
  it("keeps the base's default when it's assignable", () => {
    expect(defaultUploadClassification({ defaultClassification: 'INTERNAL' }, employee)).toEqual({
      value: 'INTERNAL',
      aboveClearance: false,
    });
  });

  it('falls back to the highest assignable level when the default is above clearance', () => {
    expect(defaultUploadClassification({ defaultClassification: 'CONFIDENTIAL' }, employee)).toEqual({
      value: 'INTERNAL',
      aboveClearance: true,
    });
  });
});

describe('canOnKnowledgeBase (the §3.6 matrix)', () => {
  it('employee on the Handbook (MANAGE)', () => {
    expect(
      can(
        ['upload', 'reindex', 'piiReport', 'search', 'viewGrants', 'editDocument', 'deleteDocument', 'download', 'manageGrants', 'editKnowledgeBase', 'deleteKnowledgeBase'],
        handbook,
        employee,
      ),
    ).toEqual({
      upload: true,
      reindex: true,
      piiReport: true,
      search: true,
      viewGrants: true,
      editDocument: false,
      deleteDocument: false,
      download: false,
      manageGrants: false,
      editKnowledgeBase: false,
      deleteKnowledgeBase: false,
    });
  });

  it('employee with a READ grant cannot upload', () => {
    expect(canOnKnowledgeBase('upload', readGrant, employee)).toBe(false);
    // The permission is held: the level is what's missing, so the UI disables rather than hides.
    expect(lacksPermissionFor('upload', employee)).toBe(false);
  });

  it('HR on HR Policies (MANAGE)', () => {
    expect(can(['deleteKnowledgeBase', 'reindex', 'piiReport', 'download', 'manageGrants'], handbook, hr)).toEqual({
      deleteKnowledgeBase: false,
      reindex: false,
      piiReport: false,
      download: true,
      manageGrants: true,
    });
  });

  it('auditor on HR Policies (READ)', () => {
    expect(can(['viewGrants', 'piiReport', 'upload', 'search'], readGrant, auditor)).toEqual({
      viewGrants: false,
      piiReport: true,
      upload: false,
      search: false,
    });
  });

  it('only the owner reveals PII', () => {
    expect(canOnKnowledgeBase('revealPii', handbook, owner)).toBe(true);
    expect(canOnKnowledgeBase('revealPii', handbook, admin)).toBe(false);
  });
});

describe('atLeast', () => {
  it('orders READ < WRITE < MANAGE', () => {
    expect(atLeast('WRITE', 'READ')).toBe(true);
    expect(atLeast('WRITE', 'MANAGE')).toBe(false);
    expect(atLeast(null, 'READ')).toBe(false);
  });
});

describe('myLevelAfter', () => {
  const me = { membershipId: 'membership-admin', roleIds: ['role-admin'] };
  const grant = (id: string, subjectType: KnowledgeBaseGrant['subjectType'], subjectId: string, accessLevel: KnowledgeBaseGrant['accessLevel']): KnowledgeBaseGrant => ({
    id,
    subjectType,
    subjectId,
    subjectLabel: null,
    accessLevel,
    grantedById: null,
    createdAt: '2026-09-30T04:35:34.889Z',
  });
  // A restricted base the admin created: their own MEMBER MANAGE grant, plus grants to others.
  const grants = [
    grant('g-own', 'MEMBER', 'membership-admin', 'MANAGE'),
    grant('g-member-role', 'ROLE', 'role-member', 'READ'),
    grant('g-key', 'API_KEY', 'key-1', 'WRITE'),
  ];

  it('removing your own grant loses access', () => {
    expect(myLevelAfter(grants, me, { removeGrantId: 'g-own' })).toBeNull();
  });

  it('lowering your own grant lowers your level', () => {
    expect(myLevelAfter(grants, me, { grantId: 'g-own', accessLevel: 'READ' })).toBe('READ');
  });

  it("keeps the strongest of your member and role grants", () => {
    const withRole = [...grants, grant('g-admin-role', 'ROLE', 'role-admin', 'WRITE')];
    expect(myLevelAfter(withRole, me, { removeGrantId: 'g-own' })).toBe('WRITE');
  });

  it("ignores changes to other people's grants", () => {
    expect(myLevelAfter(grants, me, { removeGrantId: 'g-key' })).toBe('MANAGE');
  });
});

describe('deniedBecause (spec §3.7: hide versus disable)', () => {
  const member = new Set(['document:read', 'document:create', 'document:reindex', 'rag:query', 'clearance:internal', 'knowledgebase:read']);

  it('hides what the role can never do and disables what the level blocks', () => {
    expect(deniedBecause('download', { access: 'MANAGE' }, member)).toBe('permission');
    expect(deniedBecause('upload', { access: 'READ' }, member)).toBe('level');
    expect(deniedBecause('upload', { access: 'WRITE' }, member)).toBeNull();
  });
});

describe('affectsOwnAccess (P3-G07)', () => {
  const me = { membershipId: 'm-1', roleIds: ['r-1'], isOwner: false };

  it('recognises your own member grant and your roles, never for the owner', () => {
    expect(affectsOwnAccess({ subjectType: 'MEMBER', subjectId: 'm-1' }, me)).toBe(true);
    expect(affectsOwnAccess({ subjectType: 'ROLE', subjectId: 'r-1' }, me)).toBe(true);
    expect(affectsOwnAccess({ subjectType: 'ROLE', subjectId: 'r-2' }, me)).toBe(false);
    expect(affectsOwnAccess({ subjectType: 'API_KEY', subjectId: 'm-1' }, me)).toBe(false);
    expect(affectsOwnAccess({ subjectType: 'MEMBER', subjectId: 'm-1' }, { ...me, isOwner: true })).toBe(false);
  });
});
