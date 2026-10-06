import { describe, expect, it } from 'vitest';
import type { Message, TurnMeta, TurnResult, TurnStreamEvent } from '../api/types';
import { messageNotice, partitionCitations, splitCitations, flattenPages, completedSentences, withMessages } from './messages';
import {
  autoRetryable,
  findSentQuestion,
  initialTurnView,
  newClientMessageId,
  reconcileTurn,
  remedyFor,
  stageLabel,
  turnAdvice,
  turnReducer,
} from './turn';

const meta: TurnMeta = {
  conversationId: 'c1',
  agentId: 'a1',
  agentVersion: 5,
  model: 'qwen/qwen3.8-27b',
  userMessageId: 'u1',
  assistantMessageId: 'm1',
};

function message(overrides: Partial<Message>): Message {
  return {
    id: 'x',
    sequence: 1,
    role: 'ASSISTANT',
    status: 'COMPLETE',
    content: 'text',
    contentState: 'VISIBLE',
    classification: 'PUBLIC',
    citations: [],
    agentVersion: 5,
    model: 'qwen/qwen3.8-27b',
    redaction: null,
    errorCode: null,
    toolCalls: [],
    createdAt: '2026-10-06T08:00:00.000Z',
    ...overrides,
  };
}

describe('turnReducer (spec §4.4, Appendix A)', () => {
  it('folds a grounded turn into the stored answer', () => {
    const answer = 'Every full-time employee receives 24 days [S2].';
    const events: TurnStreamEvent[] = [
      { event: 'meta', data: meta },
      { event: 'status', data: { stage: 'retrieving' } },
      { event: 'status', data: { stage: 'redacting' } },
      { event: 'status', data: { stage: 'queued', inUse: 0, waiting: 0, capacity: 1 } },
      { event: 'status', data: { stage: 'generating' } },
      { event: 'delta', data: { text: 'Every full-time employee ' } },
      { event: 'delta', data: { text: 'receives 24 days [S2].' } },
      {
        event: 'done',
        data: { assistantMessage: message({ id: 'm1', content: answer }), userMessage: message({ id: 'u1', role: 'USER' }) } as TurnResult,
      },
    ];
    const views = events.reduce<ReturnType<typeof initialTurnView>[]>((all, event) => [...all, turnReducer(all.at(-1) ?? initialTurnView(), event)], []);
    expect(views[0].phase).toBe('streaming');
    expect(views[3].queue).toEqual({ inUse: 0, waiting: 0, capacity: 1 });
    expect(views[3].generating).toBe(false);
    expect(views[4].generating).toBe(true);
    expect(views[6].text).toBe(answer);
    expect(views[7]).toMatchObject({ phase: 'done', stage: null, text: answer });
    expect(views[7].stages).toEqual(['retrieving', 'redacting', 'queued', 'generating']);
  });

  it('tracks a tool call', () => {
    let view = turnReducer(initialTurnView(), { event: 'status', data: { stage: 'tool', tool: 'calculator', iteration: 1 } });
    expect(view.activeTool).toBe('calculator');
    expect(stageLabel(view.stage, view.activeTool)).toBe('Using calculator…');
    view = turnReducer(view, {
      event: 'tool',
      data: { executionId: 'e1', tool: 'calculator', status: 'ok', durationMs: 3 },
    });
    expect(view.activeTool).toBeNull();
    expect(view.tools).toHaveLength(1);
  });

  it('ends on an error event', () => {
    const view = turnReducer(turnReducer(initialTurnView(), { event: 'meta', data: meta }), {
      event: 'error',
      data: { code: 'AI_SERVICE_UNAVAILABLE', message: 'down', status: 503 },
    });
    expect(view).toMatchObject({ phase: 'failed', generating: false });
  });
});

describe('reconcileTurn (spec §9.4)', () => {
  it('finds a stored answer, a partial one, a running turn, or nothing', () => {
    expect(reconcileTurn([message({ id: 'm1' })], meta).state).toBe('answered');
    expect(reconcileTurn([message({ id: 'm1', status: 'CANCELLED', errorCode: 'REQUEST_TIMEOUT' })], meta).state).toBe('partial');
    expect(reconcileTurn([message({ id: 'u1', role: 'USER' })], meta).state).toBe('running');
    expect(reconcileTurn([], meta).state).toBe('not-started');
    expect(reconcileTurn([message({ id: 'm1' })], null).state).toBe('not-started');
  });

  it('finds the question by text after the last known sequence', () => {
    const latest = [message({ id: 'q0', role: 'USER', sequence: 1, content: 'Hi' }), message({ id: 'q1', role: 'USER', sequence: 3, content: 'Hi' })];
    expect(findSentQuestion(latest, 'Hi', 2)?.id).toBe('q1');
    expect(findSentQuestion(latest, 'Hi', 3)).toBeNull();
  });
});

describe('turnAdvice (spec §4.9)', () => {
  it('waits on governance refusals with the server delay', () => {
    expect(turnAdvice({ code: 'TOKEN_RATE_LIMITED', retryAfterSeconds: 1 }, false)).toEqual({ retry: 'wait', waitSeconds: 1, safeToResend: true });
    expect(turnAdvice({ code: 'LLM_BUSY' }, false).waitSeconds).toBe(5);
  });
  it('offers a manual retry on outages, nothing on refusals', () => {
    expect(turnAdvice({ code: 'AI_SERVICE_UNAVAILABLE' }, false).retry).toBe('manual');
    expect(turnAdvice({ code: 'CONVERSATION_ARCHIVED' }, false).retry).toBe('none');
    expect(turnAdvice({ code: 'LLM_TIMEOUT' }, true).safeToResend).toBe(false);
  });
  it('retries by itself only short throttles', () => {
    expect(autoRetryable({ code: 'TOKEN_RATE_LIMITED', retryAfterSeconds: 1 })).toBe(true);
    expect(autoRetryable({ code: 'QUOTA_EXCEEDED', retryAfterSeconds: 1 })).toBe(false);
    expect(autoRetryable({ code: 'LLM_BUSY', retryAfterSeconds: 120 })).toBe(false);
  });
  it('names the remedy for refusals that end a conversation', () => {
    expect(remedyFor('CONVERSATION_ARCHIVED')).toBe('unarchive');
    expect(remedyFor('CONVERSATION_TOKEN_BUDGET_EXCEEDED')).toBe('new-conversation');
    expect(remedyFor('LLM_CONTEXT_OVERFLOW')).toBe('shorten');
  });
});

describe('newClientMessageId', () => {
  it('is a v4 UUID', () => {
    expect(newClientMessageId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('messageNotice (spec §4.7)', () => {
  it('explains withheld, stopped, failed and masked messages', () => {
    expect(messageNotice(message({ contentState: 'WITHHELD', withheldReason: 'COMPARTMENT', content: null }))?.text).toMatch(/knowledge base/);
    expect(messageNotice(message({ contentState: 'WITHHELD', withheldReason: 'REDACTION_UNAVAILABLE', content: null }))?.tone).toBe('warning');
    expect(messageNotice(message({ status: 'CANCELLED' }))?.text).toBe('Stopped: partial answer.');
    expect(messageNotice(message({ status: 'CANCELLED', content: '' }))?.text).toBe('Stopped before any text was written.');
    expect(messageNotice(message({ status: 'FAILED', content: null }))?.tone).toBe('danger');
    expect(messageNotice(message({ contentState: 'MASKED' }))?.tone).toBe('info');
    expect(messageNotice(message({}))).toBeNull();
  });
});

describe('citations', () => {
  const citations = [
    { tag: 'S1', documentId: 'd1', documentTitle: 'hr-contacts', knowledgeBaseId: 'k', chunkId: 'c', rank: 1, score: 0.45, cited: true },
    { tag: 'S3', documentId: 'd3', documentTitle: null, knowledgeBaseId: 'k', chunkId: 'c', rank: 3, score: 0.2, cited: false },
    { tag: 'S2', documentId: 'd2', documentTitle: 'leave-policy', knowledgeBaseId: 'k', chunkId: 'c', rank: 2, score: 0.38, cited: true },
  ];
  it('splits markers and keeps unknown tags', () => {
    const segments = splitCitations('24 days [S2] or [S9].', citations);
    expect(segments.map((segment) => segment.type)).toEqual(['text', 'citation', 'text', 'citation', 'text']);
    expect(segments[3]).toMatchObject({ tag: 'S9', citation: null });
  });
  it('lists cited sources first, by rank', () => {
    const { cited, consulted } = partitionCitations(citations);
    expect(cited.map((c) => c.tag)).toEqual(['S1', 'S2']);
    expect(consulted.map((c) => c.tag)).toEqual(['S3']);
  });
});

describe('history pages', () => {
  it('flattens newest-first pages chronologically without duplicates', () => {
    const pages = [
      { messages: [message({ id: 'c', sequence: 3 }), message({ id: 'd', sequence: 4 })], nextBefore: 3, masked: false, revealed: false },
      { messages: [message({ id: 'a', sequence: 1 }), message({ id: 'b', sequence: 2 }), message({ id: 'c', sequence: 3 })], nextBefore: null, masked: false, revealed: false },
    ];
    expect(flattenPages(pages).map((m) => m.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('merges stored messages into the newest page by id', () => {
    const page = { messages: [message({ id: 'a', sequence: 1 })], nextBefore: null, masked: false, revealed: false };
    const merged = withMessages(page, [message({ id: 'b', sequence: 2 }), message({ id: 'a', sequence: 1, content: 'new' })]);
    expect(merged.messages.map((m) => [m.id, m.content])).toEqual([['a', 'new'], ['b', 'text']]);
  });
});

describe('completedSentences', () => {
  it('speaks only finished sentences', () => {
    expect(completedSentences('Hello there. How are', 0)).toEqual({ spoken: 'Hello there.', next: 12 });
    expect(completedSentences('Hello there. How are you? Fine', 12)).toEqual({ spoken: 'How are you?', next: 25 });
    expect(completedSentences('No end yet', 0)).toEqual({ spoken: '', next: 0 });
  });
});
