import { describe, expect, it } from 'vitest';
import type { AgentConfigView } from '../api/types';
import { AGENT_DEFAULTS } from './agent-form';
import { customWindow, formatMs, formatShare, outcomeShares, presetWindow } from './usage';
import { diffConfigs, identicalTo, lineDiff } from './versions';

const { instructions: _i, accessMode: _a, allowedRoleIds: _r, ...defaults } = AGENT_DEFAULTS;
void _i;
void _a;
void _r;
const base: AgentConfigView = defaults;

describe('diffConfigs (spec §5.3 compare)', () => {
  it('lists only changed rows, with readable values', () => {
    const after: AgentConfigView = { ...base, persona: { ...base.persona, tone: 'formal' }, parameters: { temperature: 0.1 } };
    expect(diffConfigs(base, after)).toEqual([
      { key: 'persona.tone', section: 'Persona', label: 'Tone', before: 'Neutral', after: 'Formal' },
      { key: 'parameters.temperature', section: 'Model', label: 'Temperature', before: 'Default', after: '0.1' },
    ]);
  });

  it('names knowledge bases and counts hidden ones', () => {
    const after: AgentConfigView = { ...base, retrieval: { ...base.retrieval, knowledgeBaseIds: ['k1'], hiddenKnowledgeBases: 1 } };
    const [row] = diffConfigs(base, after, { knowledgeBaseName: (id) => (id === 'k1' ? 'Company Handbook' : undefined) });
    expect(row.after).toBe("Company Handbook (+1 you can't see)");
  });
});

describe('lineDiff', () => {
  it('marks added and removed lines around common ones', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc\nd')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'B' },
      { type: 'same', text: 'c' },
      { type: 'add', text: 'd' },
    ]);
  });
  it('handles empty sides', () => {
    expect(lineDiff('', 'x')).toEqual([{ type: 'add', text: 'x' }]);
    expect(lineDiff('x', '')).toEqual([{ type: 'del', text: 'x' }]);
    expect(lineDiff('', '')).toEqual([]);
  });
});

describe('identicalTo (digest)', () => {
  it('finds the newest older version with the same digest', () => {
    const all = [
      { version: 5, configDigest: 'aa' },
      { version: 4, configDigest: 'bb' },
      { version: 2, configDigest: 'aa' },
      { version: 1, configDigest: 'cc' },
    ];
    expect(identicalTo(all[0], all)).toBe(2);
    expect(identicalTo(all[1], all)).toBeNull();
  });
});

describe('usage helpers (spec §5.10)', () => {
  it('renders empty percentiles as a dash, never 0 ms', () => {
    expect(formatMs(null)).toBe('—');
    expect(formatMs(479.5)).toBe('480 ms');
    expect(formatMs(3413.5)).toBe('3.41 s');
    expect(formatShare(0.1658)).toBe('17%');
    expect(formatShare(null)).toBe('—');
  });

  it('rejects a start after the end (P4-G14)', () => {
    expect(customWindow('2026-10-06', '2026-10-01').error).toBeTruthy();
    expect(customWindow('2026-10-01', '2026-10-01').window).not.toBeNull();
    expect(customWindow('', '2026-10-01').error).toBeTruthy();
  });

  it('rounds preset windows to the minute', () => {
    const { from, to } = presetWindow('7d', Date.UTC(2026, 9, 6, 8, 25, 12, 880));
    expect(to).toBe('2026-10-06T08:25:00.000Z');
    expect(from).toBe('2026-09-29T08:25:00.000Z');
  });

  it('shares outcomes safely on an empty window', () => {
    const totals = { invocations: 0, completed: 0, failed: 0, cancelled: 0, refused: 0, blocked: 0, throttled: 0, promptTokens: 0, completionTokens: 0, entitiesMasked: 0, degradedRedactions: 0, estimatedTokenCounts: 0 };
    expect(outcomeShares(totals).every((row) => row.share === 0)).toBe(true);
  });
});
