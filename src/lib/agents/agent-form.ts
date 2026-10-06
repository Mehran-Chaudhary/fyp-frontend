import type {
  Agent,
  AgentAccessMode,
  AgentConfigView,
  AgentTone,
  Classification,
  CreateAgentInput,
  GenerationParameters,
  GroundingMode,
  RetrievalMode,
  UpdateAgentInput,
} from '../api/types';

/** Limits from the DTOs (spec §6). The server has the final word. */
export const AGENT_LIMITS = {
  name: 80,
  description: 2000,
  role: 160,
  language: 40,
  greeting: 500,
  instructions: 12_000,
  model: 200,
  changeNote: 500,
  knowledgeBases: 20,
  roles: 50,
  stopSequences: 4,
  stopLength: 32,
  temperature: [0, 2],
  topP: [0.01, 1],
  topK: [1, 500],
  maxOutputTokens: [1, 65_536],
  repeatPenalty: [0.5, 2],
  contextWindow: [512, 1_048_576],
  retrievalTopK: [1, 20],
  maxContextTokens: [0, 65_536],
  minScore: [0, 1],
  maxMessages: [0, 500],
  maxHistoryTokens: [0, 262_144],
} as const;

/** The platform caps remembered messages at this, whatever the agent asks for (§4.1). */
export const PLATFORM_MAX_MESSAGES = 100;

export const TONES: readonly AgentTone[] = ['neutral', 'formal', 'friendly', 'concise'];

/** What `POST /agents` with only a name produced live (§4.1). */
export const AGENT_DEFAULTS: AgentConfigView & { instructions: string; accessMode: AgentAccessMode; allowedRoleIds: string[] } = {
  persona: { role: null, tone: 'neutral', language: null, greeting: null },
  model: null,
  parameters: {},
  contextWindow: null,
  retrieval: {
    enabled: true,
    knowledgeBaseIds: [],
    hiddenKnowledgeBases: 0,
    topK: 8,
    mode: 'hybrid',
    rerank: false,
    maxContextTokens: 3000,
    minScore: null,
    maxClassification: null,
  },
  memory: { maxMessages: 20, maxHistoryTokens: 3000 },
  grounding: 'STRICT',
  citations: true,
  tools: { toolIds: [], maxIterations: 4 },
  instructions: '',
  accessMode: 'WORKSPACE',
  allowedRoleIds: [],
};

// ── The editable form ───────────────────────────────────────────────────────

/** The editor's state. Numbers are kept as typed text until they are parsed. */
export interface AgentForm {
  name: string;
  description: string;
  role: string;
  tone: AgentTone;
  language: string;
  greeting: string;
  instructions: string;
  /** null: the workspace default at the time of each turn. */
  model: string | null;
  temperature: string;
  maxOutputTokens: string;
  topP: string;
  topK: string;
  repeatPenalty: string;
  seed: string;
  stop: string[];
  contextWindow: string;
  retrievalEnabled: boolean;
  knowledgeBaseIds: string[];
  retrievalTopK: string;
  retrievalMode: RetrievalMode;
  rerank: boolean;
  maxContextTokens: string;
  minScore: string;
  maxClassification: Classification | null;
  maxMessages: string;
  maxHistoryTokens: string;
  grounding: GroundingMode;
  citations: boolean;
  accessMode: AgentAccessMode;
  allowedRoleIds: string[];
  /** Read-only in Phase 4 (§4.10): kept so a save never touches them. */
  toolIds: string[];
  maxIterations: number;
}

export type AgentFormField = keyof AgentForm;
export type AgentFormErrors = Partial<Record<AgentFormField, string>>;

const text = (value: number | null | undefined): string => (value === null || value === undefined ? '' : String(value));

function formFromConfig(
  config: AgentConfigView,
  rest: { name: string; description: string | null; instructions: string; accessMode: AgentAccessMode; allowedRoleIds: string[] },
): AgentForm {
  const p = config.parameters;
  return {
    name: rest.name,
    description: rest.description ?? '',
    role: config.persona.role ?? '',
    tone: config.persona.tone,
    language: config.persona.language ?? '',
    greeting: config.persona.greeting ?? '',
    instructions: rest.instructions,
    model: config.model,
    temperature: text(p.temperature),
    maxOutputTokens: text(p.maxOutputTokens),
    topP: text(p.topP),
    topK: text(p.topK),
    repeatPenalty: text(p.repeatPenalty),
    seed: text(p.seed),
    stop: [...(p.stop ?? [])],
    contextWindow: text(config.contextWindow),
    retrievalEnabled: config.retrieval.enabled,
    knowledgeBaseIds: [...config.retrieval.knowledgeBaseIds],
    retrievalTopK: text(config.retrieval.topK),
    retrievalMode: config.retrieval.mode,
    rerank: config.retrieval.rerank,
    maxContextTokens: text(config.retrieval.maxContextTokens),
    minScore: text(config.retrieval.minScore),
    maxClassification: config.retrieval.maxClassification,
    maxMessages: text(config.memory.maxMessages),
    maxHistoryTokens: text(config.memory.maxHistoryTokens),
    grounding: config.grounding,
    citations: config.citations,
    accessMode: rest.accessMode,
    allowedRoleIds: [...rest.allowedRoleIds],
    toolIds: [...config.tools.toolIds],
    maxIterations: config.tools.maxIterations,
  };
}

/** A new agent's form: the platform defaults, nothing filled in. */
export const emptyAgentForm = (): AgentForm =>
  formFromConfig(AGENT_DEFAULTS, { ...AGENT_DEFAULTS, name: '', description: null });

/** The form for editing a loaded agent. */
export const formFromAgent = (agent: Agent): AgentForm => formFromConfig(agent.config, agent);

// ── Parsing and validation (§6) ─────────────────────────────────────────────

/** The editable shape of an agent (Appendix A `AgentDraft`). */
export interface AgentDraft {
  name: string;
  description: string | null;
  instructions: string;
  config: Omit<AgentConfigView, 'retrieval'> & { retrieval: Omit<AgentConfigView['retrieval'], 'hiddenKnowledgeBases'> };
  accessMode: AgentAccessMode;
  allowedRoleIds: string[];
}

type Range = readonly [number, number];

function parseNumber(
  raw: string,
  range: Range,
  options: { integer?: boolean; label?: string } = {},
): { value: number | null; error?: string } {
  const trimmed = raw.trim();
  if (trimmed === '') return { value: null };
  const value = Number(trimmed);
  const [min, max] = range;
  const span = `${min.toLocaleString()} to ${max.toLocaleString()}`;
  if (!Number.isFinite(value)) return { value: null, error: `Enter a number from ${span}.` };
  if (options.integer && !Number.isInteger(value)) return { value: null, error: `Enter a whole number from ${span}.` };
  if (value < min || value > max) return { value: null, error: `Use ${span}.` };
  return { value };
}

const blankToNull = (value: string): string | null => (value.trim() ? value.trim() : null);

/**
 * Checks the form against the DTO rules and builds the draft. Required numbers
 * (retrieval and memory settings) can't be blank; optional ones (sampling,
 * context window, minScore) are omitted when blank. Returns the errors, keyed by
 * form field, and the draft when there are none.
 */
export function parseAgentForm(form: AgentForm): { errors: AgentFormErrors; draft: AgentDraft | null } {
  const errors: AgentFormErrors = {};
  const L = AGENT_LIMITS;

  const name = form.name.trim();
  if (!name) errors.name = 'Give the agent a name.';
  else if (name.length > L.name) errors.name = `Use no more than ${L.name} characters.`;
  if (form.description.trim().length > L.description) errors.description = `Use no more than ${L.description.toLocaleString()} characters.`;
  if (form.role.trim().length > L.role) errors.role = `Use no more than ${L.role} characters.`;
  if (form.language.trim().length > L.language) errors.language = `Use no more than ${L.language} characters.`;
  if (form.greeting.trim().length > L.greeting) errors.greeting = `Use no more than ${L.greeting} characters.`;
  if (form.instructions.length > L.instructions) errors.instructions = `Use no more than ${L.instructions.toLocaleString()} characters.`;

  const optional = (field: AgentFormField, raw: string, range: Range, integer = false): number | undefined => {
    const parsed = parseNumber(raw, range, { integer });
    if (parsed.error) errors[field] = parsed.error;
    return parsed.value ?? undefined;
  };
  const required = (field: AgentFormField, raw: string, range: Range, integer = true): number => {
    const parsed = parseNumber(raw, range, { integer });
    if (parsed.error) errors[field] = parsed.error;
    else if (parsed.value === null) errors[field] = 'Required.';
    return parsed.value ?? 0;
  };

  const parameters: GenerationParameters = {};
  const temperature = optional('temperature', form.temperature, L.temperature);
  if (temperature !== undefined) parameters.temperature = temperature;
  const topP = optional('topP', form.topP, L.topP);
  if (topP !== undefined) parameters.topP = topP;
  const topK = optional('topK', form.topK, L.topK, true);
  if (topK !== undefined) parameters.topK = topK;
  const maxOutputTokens = optional('maxOutputTokens', form.maxOutputTokens, L.maxOutputTokens, true);
  if (maxOutputTokens !== undefined) parameters.maxOutputTokens = maxOutputTokens;
  const repeatPenalty = optional('repeatPenalty', form.repeatPenalty, L.repeatPenalty);
  if (repeatPenalty !== undefined) parameters.repeatPenalty = repeatPenalty;
  const seed = optional('seed', form.seed, [-2_147_483_648, 2_147_483_647], true);
  if (seed !== undefined) parameters.seed = seed;
  const stop = form.stop.filter((item) => item.length > 0);
  if (stop.length > L.stopSequences) errors.stop = `Use at most ${L.stopSequences} stop sequences.`;
  else if (stop.some((item) => item.length > L.stopLength)) errors.stop = `Each stop sequence can be at most ${L.stopLength} characters.`;
  if (stop.length) parameters.stop = stop;

  const contextWindow = optional('contextWindow', form.contextWindow, L.contextWindow, true);
  const retrievalTopK = required('retrievalTopK', form.retrievalTopK, L.retrievalTopK);
  const maxContextTokens = required('maxContextTokens', form.maxContextTokens, L.maxContextTokens);
  const minScore = optional('minScore', form.minScore, L.minScore);
  const maxMessages = required('maxMessages', form.maxMessages, L.maxMessages);
  const maxHistoryTokens = required('maxHistoryTokens', form.maxHistoryTokens, L.maxHistoryTokens);

  if (form.knowledgeBaseIds.length > L.knowledgeBases) errors.knowledgeBaseIds = `Attach at most ${L.knowledgeBases} knowledge bases.`;
  if (form.allowedRoleIds.length > L.roles) errors.allowedRoleIds = `Choose at most ${L.roles} roles.`;
  if (form.accessMode === 'RESTRICTED' && form.allowedRoleIds.length === 0) {
    errors.allowedRoleIds = 'Choose at least one role, or nobody will be able to use this agent once it is published.';
  }
  if (form.model !== null && form.model.length > L.model) errors.model = `Use no more than ${L.model} characters.`;

  if (Object.keys(errors).length > 0) return { errors, draft: null };

  return {
    errors,
    draft: {
      name,
      description: blankToNull(form.description),
      instructions: form.instructions,
      config: {
        persona: {
          role: blankToNull(form.role),
          tone: form.tone,
          language: blankToNull(form.language),
          greeting: blankToNull(form.greeting),
        },
        model: form.model,
        parameters,
        contextWindow: contextWindow ?? null,
        retrieval: {
          enabled: form.retrievalEnabled,
          knowledgeBaseIds: [...form.knowledgeBaseIds],
          topK: retrievalTopK,
          mode: form.retrievalMode,
          rerank: form.rerank,
          maxContextTokens,
          // Applies in dense mode only; kept as set so switching modes back and forth loses nothing.
          minScore: minScore ?? null,
          maxClassification: form.maxClassification,
        },
        memory: { maxMessages, maxHistoryTokens },
        grounding: form.grounding,
        citations: form.citations,
        tools: { toolIds: [...form.toolIds], maxIterations: form.maxIterations },
      },
      accessMode: form.accessMode,
      allowedRoleIds: [...form.allowedRoleIds],
    },
  };
}

// ── Comparing and patching (P4-API-04, Appendix A) ──────────────────────────

/** JSON with object keys sorted, so `{a, b}` and `{b, a}` compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}

const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
const sorted = (values: readonly string[]): string[] => [...values].sort();
const sameSet = (a: readonly string[], b: readonly string[]): boolean => same(sorted(a), sorted(b));

function changedKeys<T extends object>(before: T, after: T): Partial<T> | undefined {
  const out: Partial<T> = {};
  for (const key of Object.keys(after) as Array<keyof T>) {
    if (!same(before[key], after[key])) out[key] = after[key];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** A deep copy: editing a draft must never mutate the loaded agent it is compared with. */
export function draftFrom(agent: Pick<Agent, 'name' | 'description' | 'instructions' | 'config' | 'accessMode' | 'allowedRoleIds'>): AgentDraft {
  const config = structuredClone(agent.config);
  const { hiddenKnowledgeBases: _hidden, ...retrieval } = config.retrieval;
  void _hidden;
  return {
    name: agent.name,
    description: agent.description,
    instructions: agent.instructions,
    config: { ...config, retrieval },
    accessMode: agent.accessMode,
    allowedRoleIds: [...agent.allowedRoleIds],
  };
}

/**
 * The PATCH body for a draft: only what changed, plus `expectedVersion`. Null when
 * nothing changed. `parameters` is sent whole (the server replaces it), every other
 * section as changed keys (the server merges one level deep). Hidden knowledge bases
 * are never sent: the server keeps them. Tools are never sent in Phase 4.
 */
export function agentPatch(loaded: Agent, draft: AgentDraft, changeNote?: string): UpdateAgentInput | null {
  const before = draftFrom(loaded);
  const patch: UpdateAgentInput = { expectedVersion: loaded.currentVersion };
  const name = draft.name.trim();
  if (name !== before.name) patch.name = name;
  const description = draft.description?.trim() ? draft.description.trim() : null;
  if (description !== (before.description?.trim() ? before.description : null)) patch.description = description;
  if (draft.instructions !== before.instructions) patch.instructions = draft.instructions;

  const b = before.config;
  const d = draft.config;
  const persona = changedKeys(b.persona, d.persona);
  if (persona) patch.persona = persona;
  if (d.model !== b.model) patch.model = d.model;
  if (!same(b.parameters, d.parameters)) patch.parameters = { ...d.parameters };
  if (d.contextWindow !== b.contextWindow) patch.contextWindow = d.contextWindow;
  const retrieval = changedKeys(
    { ...b.retrieval, knowledgeBaseIds: sorted(b.retrieval.knowledgeBaseIds) },
    { ...d.retrieval, knowledgeBaseIds: sorted(d.retrieval.knowledgeBaseIds) },
  );
  if (retrieval) patch.retrieval = retrieval;
  const memory = changedKeys(b.memory, d.memory);
  if (memory) patch.memory = memory;
  if (d.grounding !== b.grounding) patch.grounding = d.grounding;
  if (d.citations !== b.citations) patch.citations = d.citations;

  if (draft.accessMode !== before.accessMode) patch.accessMode = draft.accessMode;
  if (!sameSet(draft.allowedRoleIds, before.allowedRoleIds)) patch.allowedRoleIds = [...draft.allowedRoleIds];

  if (Object.keys(patch).length === 1) return null;
  if (changeNote?.trim()) patch.changeNote = changeNote.trim().slice(0, AGENT_LIMITS.changeNote);
  return patch;
}

const BEHAVIOUR: ReadonlyArray<keyof UpdateAgentInput> = [
  'persona',
  'model',
  'parameters',
  'contextWindow',
  'retrieval',
  'memory',
  'grounding',
  'citations',
  'tools',
  'instructions',
];

/** Whether saving this patch will create a new version (identity and access edits don't). */
export const createsVersion = (patch: UpdateAgentInput): boolean => BEHAVIOUR.some((key) => patch[key] !== undefined);

/** Section names a patch touches, for the save bar ("Persona, Model"). */
export function patchSections(patch: UpdateAgentInput): string[] {
  const out: string[] = [];
  if (patch.name !== undefined || patch.description !== undefined) out.push('Identity');
  if (patch.persona) out.push('Persona');
  if (patch.instructions !== undefined) out.push('Instructions');
  if (patch.retrieval) out.push('Knowledge');
  if (patch.model !== undefined || patch.parameters || patch.contextWindow !== undefined) out.push('Model');
  if (patch.memory) out.push('Memory');
  if (patch.grounding !== undefined || patch.citations !== undefined) out.push('Answers');
  if (patch.accessMode !== undefined || patch.allowedRoleIds) out.push('Access');
  return out;
}

/**
 * The create body: only what the user filled in (§5.2 "Create sends only what the
 * user filled in"), so everything else takes the server's defaults.
 */
export function createInput(draft: AgentDraft): CreateAgentInput {
  const { instructions, accessMode, allowedRoleIds, ...config } = AGENT_DEFAULTS;
  const base = draftFrom({ name: '', description: null, instructions, accessMode, allowedRoleIds, config });
  const body: CreateAgentInput = { name: draft.name.trim() };
  if (draft.description?.trim()) body.description = draft.description.trim();
  if (draft.instructions.trim()) body.instructions = draft.instructions;
  const d = draft.config;
  const b = base.config;
  const persona = changedKeys(b.persona, d.persona);
  if (persona) body.persona = persona;
  if (d.model !== null) body.model = d.model;
  if (Object.keys(d.parameters).length > 0) body.parameters = { ...d.parameters };
  if (d.contextWindow !== null) body.contextWindow = d.contextWindow;
  const retrieval = changedKeys(b.retrieval, d.retrieval);
  if (retrieval) body.retrieval = retrieval;
  const memory = changedKeys(b.memory, d.memory);
  if (memory) body.memory = memory;
  if (d.grounding !== b.grounding) body.grounding = d.grounding;
  if (d.citations !== b.citations) body.citations = d.citations;
  if (draft.accessMode !== 'WORKSPACE') body.accessMode = draft.accessMode;
  if (draft.allowedRoleIds.length) body.allowedRoleIds = [...draft.allowedRoleIds];
  return body;
}

/** Fields of the form that differ between two forms. */
export function changedFormFields(a: AgentForm, b: AgentForm): AgentFormField[] {
  return (Object.keys(a) as AgentFormField[]).filter((key) => !same(a[key], b[key]));
}

/**
 * After a 409 (§5.2): the fields you changed keep your value, every other field
 * takes the server's current one. You review the result before saving again.
 */
export function rebaseForm(original: AgentForm, current: AgentForm, mine: AgentForm): AgentForm {
  const next = { ...current };
  for (const key of changedFormFields(original, mine)) {
    (next as Record<AgentFormField, unknown>)[key] = mine[key];
  }
  return next;
}

/** Which form fields a server 422 names (`details.fields` keys look like `retrieval.topK`). */
export const SERVER_FIELD_TO_FORM: Readonly<Record<string, AgentFormField>> = {
  name: 'name',
  description: 'description',
  instructions: 'instructions',
  'persona.role': 'role',
  'persona.tone': 'tone',
  'persona.language': 'language',
  'persona.greeting': 'greeting',
  model: 'model',
  'parameters.temperature': 'temperature',
  'parameters.topP': 'topP',
  'parameters.topK': 'topK',
  'parameters.maxOutputTokens': 'maxOutputTokens',
  'parameters.repeatPenalty': 'repeatPenalty',
  'parameters.seed': 'seed',
  'parameters.stop': 'stop',
  contextWindow: 'contextWindow',
  'retrieval.enabled': 'retrievalEnabled',
  'retrieval.knowledgeBaseIds': 'knowledgeBaseIds',
  'retrieval.topK': 'retrievalTopK',
  'retrieval.mode': 'retrievalMode',
  'retrieval.rerank': 'rerank',
  'retrieval.maxContextTokens': 'maxContextTokens',
  'retrieval.minScore': 'minScore',
  'retrieval.maxClassification': 'maxClassification',
  'memory.maxMessages': 'maxMessages',
  'memory.maxHistoryTokens': 'maxHistoryTokens',
  grounding: 'grounding',
  citations: 'citations',
  accessMode: 'accessMode',
  allowedRoleIds: 'allowedRoleIds',
};

/** Maps `details.fields` of a 422 to form fields; the rest is returned under `_form`. */
export function mapServerFieldErrors(fields: Record<string, string>): { errors: AgentFormErrors; rest: string[] } {
  const errors: AgentFormErrors = {};
  const rest: string[] = [];
  for (const [key, message] of Object.entries(fields)) {
    // Array members come back as `stop.0` or `knowledgeBaseIds.3`.
    const normalized = key.replace(/\.\d+$/, '');
    const field = SERVER_FIELD_TO_FORM[normalized];
    if (field) errors[field] = errors[field] ? `${errors[field]} ${message}` : message;
    else rest.push(message);
  }
  return { errors, rest };
}
