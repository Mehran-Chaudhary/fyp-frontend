import type { DetectorFailureMode, PiiPolicy, UpdatePiiPolicyRequest } from '../api/types';

/**
 * Editing the workspace redaction policy (Phase 3 spec §4.8, §5 "Privacy settings",
 * P3-API-18, Appendix A). The policy is versioned: a save carries the version it was
 * edited from, and only the fields that really changed, because every successful
 * save bumps the version and writes an audit record even when nothing changed
 * (P3-G05). Changes that mask less are confirmed explicitly; the server flags the
 * same changes as "weakened" in its audit log.
 */

/** Added by the server exactly when the deny list is non-empty; never sent by the client. */
export const CUSTOM_ENTITY_TYPE = 'CUSTOM';
export const ENTITY_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{1,40}$/;
export const LANGUAGE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;
export const MAX_ENTITY_TYPES = 60;
export const MAX_TERMS = 200;
export const MAX_TERM_LENGTH = 100;

export interface PolicyDraft {
  enabled: boolean;
  /** Upper-case, without CUSTOM. */
  entityTypes: string[];
  scoreThreshold: number;
  onDetectorFailure: DetectorFailureMode;
  language: string;
  allowList: string[];
  /** Null for readers without pii:policy:update: they never see or send it. */
  denyList: string[] | null;
}

export type PolicyField = keyof PolicyDraft;

/** Entity types as the server stores them: trimmed, upper-cased, unique, sorted; CUSTOM left to the server. */
export function normalizeEntityTypes(types: readonly string[]): string[] {
  return [...new Set(types.map((type) => type.trim().toUpperCase()).filter((type) => type && type !== CUSTOM_ENTITY_TYPE))].sort();
}

/** Allow- and deny-list terms: trimmed (as the server does), empty ones dropped, exact repeats removed. */
export function normalizeTerms(terms: readonly string[]): string[] {
  return [...new Set(terms.map((term) => term.trim()).filter(Boolean))];
}

export function draftFromPolicy(policy: PiiPolicy): PolicyDraft {
  return {
    enabled: policy.enabled,
    entityTypes: normalizeEntityTypes(policy.entityTypes),
    scoreThreshold: policy.scoreThreshold,
    onDetectorFailure: policy.onDetectorFailure,
    language: policy.language,
    allowList: [...policy.allowList],
    denyList: policy.denyList === null ? null : [...policy.denyList],
  };
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((value) => set.has(value));
};

/**
 * Only the fields that changed, plus `expectedVersion`. Null when nothing changed:
 * a no-op save would still bump the version (P3-G05), so none is ever sent.
 */
export function policyPatch(loaded: PiiPolicy, draft: PolicyDraft): UpdatePiiPolicyRequest | null {
  const patch: UpdatePiiPolicyRequest = { expectedVersion: loaded.version };
  const types = normalizeEntityTypes(draft.entityTypes);
  const allow = normalizeTerms(draft.allowList);
  if (draft.enabled !== loaded.enabled) patch.enabled = draft.enabled;
  if (!sameSet(types, normalizeEntityTypes(loaded.entityTypes))) patch.entityTypes = types;
  if (draft.scoreThreshold !== loaded.scoreThreshold) patch.scoreThreshold = draft.scoreThreshold;
  if (draft.onDetectorFailure !== loaded.onDetectorFailure) patch.onDetectorFailure = draft.onDetectorFailure;
  if (draft.language.trim() !== loaded.language) patch.language = draft.language.trim();
  if (!sameSet(allow, loaded.allowList)) patch.allowList = allow;
  // Readers see `denyList: null` and can't edit it; editors always get the array.
  if (loaded.denyList !== null && draft.denyList !== null) {
    const deny = normalizeTerms(draft.denyList);
    if (!sameSet(deny, loaded.denyList)) patch.denyList = deny;
  }
  return Object.keys(patch).length > 1 ? patch : null;
}

export type WeakeningKind = 'disabled' | 'removedTypes' | 'threshold' | 'degrade' | 'allowList' | 'denyList';

export interface Weakening {
  kind: WeakeningKind;
  text: string;
}

/**
 * Every way a patch makes the policy mask less: turning redaction off, dropping
 * entity types, raising the threshold, falling back to patterns when NER is down,
 * never-mask terms added, always-mask terms removed. The first five are what the
 * server audits as "weakened"; removed deny terms mask less too, so they are
 * confirmed as well.
 */
export function weakeningsOf(
  loaded: PiiPolicy,
  patch: UpdatePiiPolicyRequest,
  labelOf: (type: string) => string = (type) => type,
): Weakening[] {
  const out: Weakening[] = [];
  if (loaded.enabled && patch.enabled === false) {
    out.push({ kind: 'disabled', text: 'Redaction is turned off: text reaches models without any masking.' });
  }
  if (patch.entityTypes !== undefined) {
    const kept = new Set(patch.entityTypes);
    const removed = normalizeEntityTypes(loaded.entityTypes).filter((type) => !kept.has(type));
    if (removed.length) out.push({ kind: 'removedTypes', text: `No longer masked: ${removed.map(labelOf).join(', ')}.` });
  }
  if (patch.scoreThreshold !== undefined && patch.scoreThreshold > loaded.scoreThreshold) {
    out.push({
      kind: 'threshold',
      text: `Detections scoring below ${formatThreshold(patch.scoreThreshold)} pass through unmasked (until now: below ${formatThreshold(loaded.scoreThreshold)}).`,
    });
  }
  if (loaded.onDetectorFailure === 'REFUSE' && patch.onDetectorFailure === 'DEGRADE_TO_PATTERNS') {
    out.push({
      kind: 'degrade',
      text: 'When name detection is down, text is sent with only pattern detections masked, instead of being refused.',
    });
  }
  if (patch.allowList !== undefined) {
    const before = new Set(loaded.allowList);
    const added = patch.allowList.filter((term) => !before.has(term));
    if (added.length) {
      out.push({ kind: 'allowList', text: `${added.length === 1 ? '1 more value is' : `${added.length} more values are`} never masked.` });
    }
  }
  if (patch.denyList !== undefined && loaded.denyList !== null) {
    const after = new Set(patch.denyList);
    const removed = loaded.denyList.filter((term) => !after.has(term));
    if (removed.length) {
      out.push({
        kind: 'denyList',
        text:
          patch.denyList.length === 0
            ? 'The deny list is cleared: no private term is masked as Custom any more.'
            : `${removed.length === 1 ? '1 private term is' : `${removed.length} private terms are`} no longer always masked.`,
      });
    }
  }
  return out;
}

export const weakensPolicy = (loaded: PiiPolicy, patch: UpdatePiiPolicyRequest): boolean => weakeningsOf(loaded, patch).length > 0;

export const formatThreshold = (value: number): string => (Math.round(value * 100) / 100).toFixed(2);

export const FAILURE_MODE_LABEL: Readonly<Record<DetectorFailureMode, string>> = {
  REFUSE: 'Refuse the request',
  DEGRADE_TO_PATTERNS: 'Mask patterns only',
};

export interface PolicyChange {
  field: PolicyField;
  label: string;
  from: string;
  to: string;
}

const listSummary = (items: readonly string[], noun: string): string =>
  items.length === 0 ? 'none' : items.length === 1 ? `1 ${noun}` : `${items.length} ${noun}s`;

/** The changes of a patch in words, for the review before saving. Deny-list terms are counted, not shown. */
export function describePolicyChanges(
  loaded: PiiPolicy,
  patch: UpdatePiiPolicyRequest,
  labelOf: (type: string) => string = (type) => type,
): PolicyChange[] {
  const changes: PolicyChange[] = [];
  if (patch.enabled !== undefined) {
    changes.push({ field: 'enabled', label: 'Redaction', from: loaded.enabled ? 'On' : 'Off', to: patch.enabled ? 'On' : 'Off' });
  }
  if (patch.entityTypes !== undefined) {
    const before = normalizeEntityTypes(loaded.entityTypes);
    const after = new Set(patch.entityTypes);
    const added = patch.entityTypes.filter((type) => !before.includes(type));
    const removed = before.filter((type) => !after.has(type));
    const delta = [added.length ? `+ ${added.map(labelOf).join(', ')}` : null, removed.length ? `− ${removed.map(labelOf).join(', ')}` : null]
      .filter(Boolean)
      .join('; ');
    changes.push({
      field: 'entityTypes',
      label: 'Entity types',
      from: listSummary(before, 'type'),
      to: `${listSummary(patch.entityTypes, 'type')} (${delta})`,
    });
  }
  if (patch.scoreThreshold !== undefined) {
    changes.push({ field: 'scoreThreshold', label: 'Score threshold', from: formatThreshold(loaded.scoreThreshold), to: formatThreshold(patch.scoreThreshold) });
  }
  if (patch.onDetectorFailure !== undefined) {
    changes.push({
      field: 'onDetectorFailure',
      label: 'If name detection is down',
      from: FAILURE_MODE_LABEL[loaded.onDetectorFailure],
      to: FAILURE_MODE_LABEL[patch.onDetectorFailure],
    });
  }
  if (patch.language !== undefined) changes.push({ field: 'language', label: 'Language', from: loaded.language, to: patch.language });
  if (patch.allowList !== undefined) {
    changes.push({ field: 'allowList', label: 'Never masked', from: listSummary(loaded.allowList, 'term'), to: listSummary(patch.allowList, 'term') });
  }
  if (patch.denyList !== undefined) {
    changes.push({
      field: 'denyList',
      label: 'Always masked',
      from: listSummary(loaded.denyList ?? [], 'private term'),
      to: listSummary(patch.denyList, 'private term'),
    });
  }
  return changes;
}

/** The fields a draft changed relative to the policy it was edited from. */
export function changedFields(base: PiiPolicy, draft: PolicyDraft): PolicyField[] {
  const patch = policyPatch(base, draft);
  if (!patch) return [];
  return (Object.keys(patch) as Array<keyof UpdatePiiPolicyRequest>).filter((key): key is PolicyField => key !== 'expectedVersion');
}

/**
 * After a 409 (someone saved in between): your changes re-applied on top of the
 * current version. Fields you changed keep your value; every other field takes the
 * current server value. The result is reviewed and saved with the new version.
 */
export function rebaseDraft(base: PiiPolicy, current: PiiPolicy, draft: PolicyDraft): PolicyDraft {
  const mine = new Set(changedFields(base, draft));
  const next = draftFromPolicy(current);
  return {
    enabled: mine.has('enabled') ? draft.enabled : next.enabled,
    entityTypes: mine.has('entityTypes') ? normalizeEntityTypes(draft.entityTypes) : next.entityTypes,
    scoreThreshold: mine.has('scoreThreshold') ? draft.scoreThreshold : next.scoreThreshold,
    onDetectorFailure: mine.has('onDetectorFailure') ? draft.onDetectorFailure : next.onDetectorFailure,
    language: mine.has('language') ? draft.language : next.language,
    allowList: mine.has('allowList') ? normalizeTerms(draft.allowList) : next.allowList,
    denyList: mine.has('denyList') && draft.denyList !== null ? normalizeTerms(draft.denyList) : next.denyList,
  };
}

export type PolicyErrors = Partial<Record<PolicyField, string>>;

/** The DTO's rules (spec §6), checked before sending. The server checks the same. */
export function validatePolicyDraft(draft: PolicyDraft): PolicyErrors {
  const errors: PolicyErrors = {};
  const types = normalizeEntityTypes(draft.entityTypes);
  const bad = types.filter((type) => !ENTITY_TYPE_PATTERN.test(type));
  if (bad.length) errors.entityTypes = `Not a valid entity type: ${bad.join(', ')}. Use letters, digits and _ (2–41 characters).`;
  else if (types.length > MAX_ENTITY_TYPES) errors.entityTypes = `Choose at most ${MAX_ENTITY_TYPES} entity types.`;
  if (!Number.isFinite(draft.scoreThreshold) || draft.scoreThreshold < 0 || draft.scoreThreshold > 1) {
    errors.scoreThreshold = 'Use a number from 0 to 1.';
  }
  if (!LANGUAGE_PATTERN.test(draft.language.trim())) errors.language = 'Use a language code such as en or en-GB.';
  const termError = (terms: readonly string[]): string | undefined => {
    const clean = normalizeTerms(terms);
    if (clean.length > MAX_TERMS) return `At most ${MAX_TERMS} terms.`;
    const long = clean.find((term) => term.length > MAX_TERM_LENGTH);
    return long ? `Terms are at most ${MAX_TERM_LENGTH} characters (“${long.slice(0, 24)}…”).` : undefined;
  };
  const allow = termError(draft.allowList);
  if (allow) errors.allowList = allow;
  const deny = draft.denyList ? termError(draft.denyList) : undefined;
  if (deny) errors.denyList = deny;
  return errors;
}

/** "PERSON" → "PERSON"; for free entry of a Presidio entity name. */
export const toEntityTypeName = (value: string): string => value.trim().toUpperCase().replace(/[\s-]+/g, '_');
