import { describe, expect, it } from 'vitest';
import type { PiiPolicy } from '../api/types';
import {
  changedFields,
  describePolicyChanges,
  draftFromPolicy,
  normalizeEntityTypes,
  policyPatch,
  rebaseDraft,
  validatePolicyDraft,
  weakeningsOf,
  weakensPolicy,
} from './pii-policy';

/** The verified platform defaults (spec §8 P3-API-17), as an editor sees them. */
const defaults: PiiPolicy = {
  source: 'default',
  version: 0,
  enabled: true,
  entityTypes: ['CREDENTIAL', 'CREDIT_CARD', 'EMAIL_ADDRESS', 'IBAN_CODE', 'IP_ADDRESS', 'PERSON', 'PHONE_NUMBER', 'PK_CNIC', 'SALARY', 'US_SSN'],
  nerEntityTypes: ['PERSON'],
  scoreThreshold: 0.5,
  onDetectorFailure: 'REFUSE',
  language: 'en',
  allowList: [],
  denyList: [],
  denyListCount: 0,
  nerDetector: { kind: 'ai-service', configured: true, missingConfiguration: [] },
  warnings: [],
  updatedAt: null,
};

describe('policyPatch (P3-API-18)', () => {
  it('sends nothing when nothing changed: every save bumps the version (P3-G05)', () => {
    expect(policyPatch(defaults, draftFromPolicy(defaults))).toBeNull();
  });

  it('sends only the changed fields with expectedVersion', () => {
    const draft = { ...draftFromPolicy(defaults), denyList: ['Project Falcon'], allowList: ['Acme Corporation'] };
    expect(policyPatch(defaults, draft)).toEqual({ expectedVersion: 0, denyList: ['Project Falcon'], allowList: ['Acme Corporation'] });
  });

  it('compares entity types as a set, upper-cased, and leaves CUSTOM to the server', () => {
    const loaded = { ...defaults, entityTypes: [...defaults.entityTypes, 'CUSTOM'], denyList: ['x'], denyListCount: 1 };
    const reordered = { ...draftFromPolicy(loaded), entityTypes: [...defaults.entityTypes].reverse().map((type) => type.toLowerCase()) };
    expect(policyPatch(loaded, reordered)).toBeNull();
    const withLocation = { ...draftFromPolicy(loaded), entityTypes: [...defaults.entityTypes, 'location'] };
    expect(policyPatch(loaded, withLocation)?.entityTypes).toContain('LOCATION');
    expect(policyPatch(loaded, withLocation)?.entityTypes).not.toContain('CUSTOM');
  });

  it('never sends a deny list a reader cannot see', () => {
    const reader = { ...defaults, denyList: null, denyListCount: 1 };
    expect(draftFromPolicy(reader).denyList).toBeNull();
    expect(policyPatch(reader, { ...draftFromPolicy(reader), scoreThreshold: 0.6 })).toEqual({ expectedVersion: 0, scoreThreshold: 0.6 });
  });

  it('trims terms and drops empty or repeated ones', () => {
    const draft = { ...draftFromPolicy(defaults), allowList: [' Acme ', 'Acme', ''] };
    expect(policyPatch(defaults, draft)?.allowList).toEqual(['Acme']);
  });
});

describe('weakening (changes that mask less)', () => {
  it('flags what the server audits as weakened', () => {
    const check = (change: Partial<ReturnType<typeof draftFromPolicy>>) =>
      weakensPolicy(defaults, policyPatch(defaults, { ...draftFromPolicy(defaults), ...change }) ?? { expectedVersion: 0 });
    expect(check({ enabled: false })).toBe(true);
    expect(check({ entityTypes: defaults.entityTypes.filter((type) => type !== 'PERSON') })).toBe(true);
    expect(check({ scoreThreshold: 0.7 })).toBe(true);
    expect(check({ onDetectorFailure: 'DEGRADE_TO_PATTERNS' })).toBe(true);
    expect(check({ allowList: ['Acme'] })).toBe(true);
  });

  it('does not flag changes that mask more', () => {
    const patch = policyPatch(defaults, { ...draftFromPolicy(defaults), scoreThreshold: 0.3, entityTypes: [...defaults.entityTypes, 'LOCATION'], denyList: ['Falcon'] });
    expect(patch).not.toBeNull();
    expect(weakeningsOf(defaults, patch!)).toEqual([]);
  });

  it('flags removed deny-list terms, and names removed types', () => {
    const loaded = { ...defaults, denyList: ['Falcon', 'Osprey'], denyListCount: 2 };
    const patch = policyPatch(loaded, { ...draftFromPolicy(loaded), denyList: [], entityTypes: defaults.entityTypes.filter((type) => type !== 'PERSON') });
    const kinds = weakeningsOf(loaded, patch!, (type) => (type === 'PERSON' ? 'Person name' : type)).map((weakening) => weakening.kind);
    expect(kinds).toEqual(['removedTypes', 'denyList']);
    expect(weakeningsOf(loaded, patch!, () => 'Person name')[0].text).toContain('Person name');
  });
});

describe('describePolicyChanges', () => {
  it('summarises term lists by count, never by content', () => {
    const loaded = { ...defaults, denyList: ['Falcon'], denyListCount: 1 };
    const patch = policyPatch(loaded, { ...draftFromPolicy(loaded), denyList: ['Falcon', 'Osprey'] })!;
    expect(describePolicyChanges(loaded, patch)).toEqual([{ field: 'denyList', label: 'Always masked', from: '1 private term', to: '2 private terms' }]);
  });

  it('describes entity-type changes as the new count and the difference', () => {
    const patch = policyPatch(defaults, { ...draftFromPolicy(defaults), entityTypes: [...defaults.entityTypes.filter((type) => type !== 'PERSON'), 'LOCATION'] })!;
    expect(describePolicyChanges(defaults, patch, (type) => (type === 'PERSON' ? 'Person name' : 'Location'))).toEqual([
      { field: 'entityTypes', label: 'Entity types', from: '10 types', to: '10 types (+ Location; − Person name)' },
    ]);
  });
});

describe('rebaseDraft (after a 409)', () => {
  it('keeps your fields and takes the rest from the newer version', () => {
    const current: PiiPolicy = { ...defaults, source: 'workspace', version: 1, scoreThreshold: 0.65, denyList: ['Osprey'], denyListCount: 1 };
    const draft = { ...draftFromPolicy(defaults), allowList: ['Acme'] };
    expect(changedFields(defaults, draft)).toEqual(['allowList']);
    const rebased = rebaseDraft(defaults, current, draft);
    expect(rebased).toMatchObject({ allowList: ['Acme'], scoreThreshold: 0.65, denyList: ['Osprey'] });
    expect(policyPatch(current, rebased)).toEqual({ expectedVersion: 1, allowList: ['Acme'] });
  });
});

describe('validatePolicyDraft (spec §6)', () => {
  it('checks entity names, threshold, language and term lengths', () => {
    const draft = draftFromPolicy(defaults);
    expect(validatePolicyDraft(draft)).toEqual({});
    expect(validatePolicyDraft({ ...draft, entityTypes: ['A'] }).entityTypes).toBeDefined();
    expect(validatePolicyDraft({ ...draft, scoreThreshold: 1.2 }).scoreThreshold).toBeDefined();
    expect(validatePolicyDraft({ ...draft, language: 'english' }).language).toBeDefined();
    expect(validatePolicyDraft({ ...draft, language: 'en-GB' }).language).toBeUndefined();
    expect(validatePolicyDraft({ ...draft, allowList: ['x'.repeat(101)] }).allowList).toBeDefined();
  });

  it('normalises entity type names like the server', () => {
    expect(normalizeEntityTypes([' person ', 'PERSON', 'custom', 'Email_Address'])).toEqual(['EMAIL_ADDRESS', 'PERSON']);
  });
});
