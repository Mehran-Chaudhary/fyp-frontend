import { describe, expect, it } from 'vitest';
import type { LlmPolicy } from '../api/types';
import { draftFromLlmPolicy, llmPolicyPatch, rebaseLlmPolicyDraft, removedModels, validateLlmPolicyDraft } from './llm-policy';

/** Before any save (spec §8 P4-API-23, verified). */
const defaults: LlmPolicy = {
  source: 'default',
  version: 0,
  allowedModels: [],
  defaultModel: null,
  maxOutputTokens: null,
  maxContextTokens: null,
  effective: {
    defaultModel: 'qwen/qwen3.8-27b',
    maxOutputTokens: 1000,
    maxContextTokens: 32768,
    platformAllowlist: ['qwen/qwen3.8-27b'],
    maxClassification: 'INTERNAL',
  },
};

describe('llmPolicyPatch (P4-API-24)', () => {
  it('sends nothing when nothing changed', () => {
    expect(llmPolicyPatch(defaults, draftFromLlmPolicy(defaults))).toBeNull();
  });

  it('sends the verified first save', () => {
    const draft = { ...draftFromLlmPolicy(defaults), allowedModels: ['qwen/qwen3.8-27b'], defaultModel: 'qwen/qwen3.8-27b', maxOutputTokens: '600' };
    expect(llmPolicyPatch(defaults, draft)).toEqual({
      expectedVersion: 0,
      allowedModels: ['qwen/qwen3.8-27b'],
      defaultModel: 'qwen/qwen3.8-27b',
      maxOutputTokens: 600,
    });
  });

  it('returns a ceiling to the platform with null', () => {
    const saved: LlmPolicy = { ...defaults, source: 'workspace', version: 1, maxOutputTokens: 600 };
    expect(llmPolicyPatch(saved, { ...draftFromLlmPolicy(saved), maxOutputTokens: '' })).toEqual({ expectedVersion: 1, maxOutputTokens: null });
  });
});

describe('validateLlmPolicyDraft', () => {
  it('checks ceilings and the default', () => {
    const errors = validateLlmPolicyDraft({ allowedModels: ['a'], defaultModel: 'b', maxOutputTokens: '8', maxContextTokens: '100' });
    expect(Object.keys(errors).sort()).toEqual(['defaultModel', 'maxContextTokens', 'maxOutputTokens']);
  });
});

describe('rebaseLlmPolicyDraft (409 RESOURCE_CONFLICT)', () => {
  it('keeps my change and takes theirs elsewhere', () => {
    const theirs: LlmPolicy = { ...defaults, version: 1, maxContextTokens: 8192 };
    const mine = { ...draftFromLlmPolicy(defaults), maxOutputTokens: '600' };
    expect(rebaseLlmPolicyDraft(defaults, theirs, mine)).toEqual({ ...draftFromLlmPolicy(theirs), maxOutputTokens: '600' });
  });
});

describe('removedModels', () => {
  it('names models an agent could lose', () => {
    expect(removedModels(defaults, { ...draftFromLlmPolicy(defaults), allowedModels: ['a'] }, ['a', 'b'])).toEqual(['b']);
  });
});
