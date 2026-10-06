import type { LlmModel, LlmPolicy, UpdateLlmPolicyInput } from '../api/types';

/** The policy editor's state (§5.8). Numbers as typed; '' means "inherit the platform's". */
export interface LlmPolicyDraft {
  /** Empty: every model the platform allows. */
  allowedModels: string[];
  /** null: the platform default. */
  defaultModel: string | null;
  maxOutputTokens: string;
  maxContextTokens: string;
}

export const LLM_POLICY_LIMITS = { maxOutputTokens: [16, 65_536], maxContextTokens: [512, 1_048_576], allowedModels: 100 } as const;

export function draftFromLlmPolicy(policy: LlmPolicy): LlmPolicyDraft {
  return {
    allowedModels: [...policy.allowedModels].sort(),
    defaultModel: policy.defaultModel,
    maxOutputTokens: policy.maxOutputTokens === null ? '' : String(policy.maxOutputTokens),
    maxContextTokens: policy.maxContextTokens === null ? '' : String(policy.maxContextTokens),
  };
}

export type LlmPolicyErrors = Partial<Record<keyof LlmPolicyDraft, string>>;

function ceiling(raw: string, [min, max]: readonly [number, number]): { value: number | null; error?: string } {
  if (!raw.trim()) return { value: null };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return { value: null, error: `A whole number from ${min.toLocaleString()} to ${max.toLocaleString()}, or empty to inherit.` };
  return { value };
}

export function validateLlmPolicyDraft(draft: LlmPolicyDraft): LlmPolicyErrors {
  const errors: LlmPolicyErrors = {};
  const output = ceiling(draft.maxOutputTokens, LLM_POLICY_LIMITS.maxOutputTokens);
  if (output.error) errors.maxOutputTokens = output.error;
  const context = ceiling(draft.maxContextTokens, LLM_POLICY_LIMITS.maxContextTokens);
  if (context.error) errors.maxContextTokens = context.error;
  if (draft.allowedModels.length > LLM_POLICY_LIMITS.allowedModels) errors.allowedModels = `Choose at most ${LLM_POLICY_LIMITS.allowedModels}.`;
  if (draft.defaultModel && draft.allowedModels.length > 0 && !draft.allowedModels.includes(draft.defaultModel)) {
    errors.defaultModel = 'The default has to be one of the allowed models.';
  }
  return errors;
}

const sameList = (a: readonly string[], b: readonly string[]) => [...a].sort().join('\n') === [...b].sort().join('\n');

/**
 * The PUT body (P4-API-24): only what changed, plus `expectedVersion`. `null`
 * returns a ceiling or the default to the platform's. Null when nothing changed.
 */
export function llmPolicyPatch(loaded: LlmPolicy, draft: LlmPolicyDraft): UpdateLlmPolicyInput | null {
  const before = draftFromLlmPolicy(loaded);
  const patch: UpdateLlmPolicyInput = { expectedVersion: loaded.version };
  if (!sameList(before.allowedModels, draft.allowedModels)) patch.allowedModels = [...draft.allowedModels].sort();
  if (before.defaultModel !== draft.defaultModel) patch.defaultModel = draft.defaultModel;
  if (before.maxOutputTokens.trim() !== draft.maxOutputTokens.trim()) {
    patch.maxOutputTokens = draft.maxOutputTokens.trim() ? Number(draft.maxOutputTokens) : null;
  }
  if (before.maxContextTokens.trim() !== draft.maxContextTokens.trim()) {
    patch.maxContextTokens = draft.maxContextTokens.trim() ? Number(draft.maxContextTokens) : null;
  }
  return Object.keys(patch).length === 1 ? null : patch;
}

/** After a 409: fields you changed keep your value; the rest take the server's. */
export function rebaseLlmPolicyDraft(base: LlmPolicy, current: LlmPolicy, draft: LlmPolicyDraft): LlmPolicyDraft {
  const original = draftFromLlmPolicy(base);
  const next = draftFromLlmPolicy(current);
  return {
    allowedModels: sameList(original.allowedModels, draft.allowedModels) ? next.allowedModels : draft.allowedModels,
    defaultModel: original.defaultModel === draft.defaultModel ? next.defaultModel : draft.defaultModel,
    maxOutputTokens: original.maxOutputTokens === draft.maxOutputTokens ? next.maxOutputTokens : draft.maxOutputTokens,
    maxContextTokens: original.maxContextTokens === draft.maxContextTokens ? next.maxContextTokens : draft.maxContextTokens,
  };
}

/**
 * The models a workspace may choose from: the platform allowlist when it has one,
 * otherwise everything the endpoint serves.
 */
export function choosableModels(models: readonly LlmModel[], policy: LlmPolicy): string[] {
  const platform = policy.effective.platformAllowlist;
  const names = platform.length ? platform : models.map((model) => model.name);
  return Array.from(new Set(names)).sort();
}

/** Models removed from the allowed list by a patch (agents pinned to them will fail until edited). */
export function removedModels(loaded: LlmPolicy, draft: LlmPolicyDraft, all: readonly string[]): string[] {
  const before = loaded.allowedModels.length ? loaded.allowedModels : all;
  const after = draft.allowedModels.length ? draft.allowedModels : all;
  return before.filter((name) => !after.includes(name));
}
