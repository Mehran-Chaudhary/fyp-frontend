import type { AgentConfigView, AgentVersion, Classification } from '../api/types';

const CLASSIFICATION_LABEL: Readonly<Record<Classification, string>> = {
  PUBLIC: 'Public',
  INTERNAL: 'Internal',
  CONFIDENTIAL: 'Confidential',
  RESTRICTED: 'Restricted',
};

export const TONE_LABEL = { neutral: 'Neutral', formal: 'Formal', friendly: 'Friendly', concise: 'Concise' } as const;
export const GROUNDING_LABEL = {
  STRICT: 'Strict: only from retrieved material',
  BALANCED: 'Balanced: may add general knowledge',
} as const;

export interface ConfigRow {
  key: string;
  section: 'Persona' | 'Model' | 'Knowledge' | 'Memory' | 'Answers' | 'Tools';
  label: string;
  value: string;
}

export interface ConfigLabels {
  /** Knowledge-base names by id; unknown ids show as "Unknown knowledge base". */
  knowledgeBaseName?: (id: string) => string | undefined;
}

const orDefault = (value: string | number | null | undefined, fallback: string): string =>
  value === null || value === undefined || value === '' ? fallback : String(value);

/**
 * A configuration as labelled, human-readable rows: the version detail and the
 * side-by-side compare (§5.3) both read from this.
 */
export function configRows(config: AgentConfigView, labels: ConfigLabels = {}): ConfigRow[] {
  const p = config.parameters;
  const r = config.retrieval;
  const bases = r.knowledgeBaseIds.map((id) => labels.knowledgeBaseName?.(id) ?? 'Unknown knowledge base').sort((a, b) => a.localeCompare(b));
  const hidden = r.hiddenKnowledgeBases > 0 ? ` (+${r.hiddenKnowledgeBases} you can't see)` : '';
  return [
    { key: 'persona.role', section: 'Persona', label: 'Role', value: orDefault(config.persona.role, '“an assistant for this organisation”') },
    { key: 'persona.tone', section: 'Persona', label: 'Tone', value: TONE_LABEL[config.persona.tone] ?? config.persona.tone },
    { key: 'persona.language', section: 'Persona', label: 'Language', value: orDefault(config.persona.language, 'The language the user writes in') },
    { key: 'persona.greeting', section: 'Persona', label: 'Greeting', value: orDefault(config.persona.greeting, 'None') },
    { key: 'model', section: 'Model', label: 'Model', value: orDefault(config.model, 'Workspace default') },
    { key: 'parameters.temperature', section: 'Model', label: 'Temperature', value: orDefault(p.temperature, 'Default') },
    { key: 'parameters.maxOutputTokens', section: 'Model', label: 'Max answer length', value: p.maxOutputTokens ? `${p.maxOutputTokens.toLocaleString()} tokens` : 'Default' },
    { key: 'parameters.topP', section: 'Model', label: 'Top P', value: orDefault(p.topP, 'Default') },
    { key: 'parameters.topK', section: 'Model', label: 'Top K', value: orDefault(p.topK, 'Default') },
    { key: 'parameters.repeatPenalty', section: 'Model', label: 'Repeat penalty', value: orDefault(p.repeatPenalty, 'Default') },
    { key: 'parameters.seed', section: 'Model', label: 'Seed', value: orDefault(p.seed, 'Random') },
    { key: 'parameters.stop', section: 'Model', label: 'Stop sequences', value: p.stop?.length ? p.stop.map((s) => JSON.stringify(s)).join(', ') : 'None' },
    { key: 'contextWindow', section: 'Model', label: 'Context window cap', value: config.contextWindow ? `${config.contextWindow.toLocaleString()} tokens` : "The model's own" },
    { key: 'retrieval.enabled', section: 'Knowledge', label: 'Retrieval', value: r.enabled ? 'On' : 'Off' },
    { key: 'retrieval.knowledgeBaseIds', section: 'Knowledge', label: 'Knowledge bases', value: (bases.length ? bases.join(', ') : 'None') + hidden },
    { key: 'retrieval.topK', section: 'Knowledge', label: 'Passages requested', value: String(r.topK) },
    { key: 'retrieval.mode', section: 'Knowledge', label: 'Search mode', value: r.mode === 'dense' ? 'Meaning only' : 'Keyword + meaning' },
    { key: 'retrieval.rerank', section: 'Knowledge', label: 'Reranking', value: r.rerank ? 'On' : 'Off' },
    { key: 'retrieval.maxContextTokens', section: 'Knowledge', label: 'Passage budget', value: `${r.maxContextTokens.toLocaleString()} tokens` },
    { key: 'retrieval.minScore', section: 'Knowledge', label: 'Minimum similarity', value: r.mode === 'dense' ? orDefault(r.minScore, 'None') : 'Not used (hybrid)' },
    { key: 'retrieval.maxClassification', section: 'Knowledge', label: 'Classification cap', value: r.maxClassification ? CLASSIFICATION_LABEL[r.maxClassification] : 'None' },
    { key: 'memory.maxMessages', section: 'Memory', label: 'Messages remembered', value: config.memory.maxMessages === 0 ? 'None (memory off)' : String(config.memory.maxMessages) },
    { key: 'memory.maxHistoryTokens', section: 'Memory', label: 'History budget', value: `${config.memory.maxHistoryTokens.toLocaleString()} tokens` },
    { key: 'grounding', section: 'Answers', label: 'Grounding', value: GROUNDING_LABEL[config.grounding] ?? config.grounding },
    { key: 'citations', section: 'Answers', label: 'Citations', value: config.citations ? 'Cite sources as [S1]' : 'Off' },
    { key: 'tools.toolIds', section: 'Tools', label: 'Tools', value: config.tools.toolIds.length ? `${config.tools.toolIds.length} granted` : 'None' },
    { key: 'tools.maxIterations', section: 'Tools', label: 'Tool rounds per answer', value: String(config.tools.maxIterations) },
  ];
}

export interface RowChange {
  key: string;
  section: ConfigRow['section'];
  label: string;
  before: string;
  after: string;
}

/** The rows whose value differs between two configurations. */
export function diffConfigs(before: AgentConfigView, after: AgentConfigView, labels?: ConfigLabels): RowChange[] {
  const a = configRows(before, labels);
  const b = new Map(configRows(after, labels).map((row) => [row.key, row]));
  return a
    .filter((row) => b.get(row.key)?.value !== row.value)
    .map((row) => ({ key: row.key, section: row.section, label: row.label, before: row.value, after: b.get(row.key)?.value ?? '' }));
}

// ── Instructions: a line diff ───────────────────────────────────────────────

export interface DiffLine {
  type: 'same' | 'add' | 'del';
  text: string;
}

/** Above this many cells the LCS table is skipped and the text shown as replaced. */
const MAX_CELLS = 4_000_000;

/** A line-level diff (longest common subsequence) of two texts. */
export function lineDiff(before: string, after: string): DiffLine[] {
  if (before === after) return before ? before.split('\n').map((text) => ({ type: 'same', text })) : [];
  const a = before ? before.split('\n') : [];
  const b = after ? after.split('\n') : [];

  // Common head and tail are cheap and make the table smaller.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);

  const out: DiffLine[] = a.slice(0, head).map((text) => ({ type: 'same', text }));
  if ((midA.length + 1) * (midB.length + 1) > MAX_CELLS) {
    out.push(...midA.map((text): DiffLine => ({ type: 'del', text })), ...midB.map((text): DiffLine => ({ type: 'add', text })));
  } else {
    const n = midA.length;
    const m = midB.length;
    const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        out.push({ type: 'same', text: midA[i] });
        i += 1;
        j += 1;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        out.push({ type: 'del', text: midA[i] });
        i += 1;
      } else {
        out.push({ type: 'add', text: midB[j] });
        j += 1;
      }
    }
    while (i < n) out.push({ type: 'del', text: midA[i++] });
    while (j < m) out.push({ type: 'add', text: midB[j++] });
  }
  out.push(...a.slice(a.length - tail).map((text): DiffLine => ({ type: 'same', text })));
  return out;
}

// ── History labels (§5.3) ───────────────────────────────────────────────────

/**
 * "Identical to v2": the newest *other* version with the same digest, among the
 * versions loaded. Two versions with one digest behave identically.
 */
export function identicalTo(version: Pick<AgentVersion, 'version' | 'configDigest'>, all: readonly Pick<AgentVersion, 'version' | 'configDigest'>[]): number | null {
  const match = all
    .filter((other) => other.version < version.version && other.configDigest === version.configDigest)
    .sort((x, y) => y.version - x.version)[0];
  return match ? match.version : null;
}
