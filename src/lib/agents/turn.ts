import { ApiError } from '../api/errors';
import type {
  Message,
  QueueLoad,
  StreamErrorEvent,
  ToolCallRecord,
  TurnMeta,
  TurnResult,
  TurnStage,
  TurnStreamEvent,
} from '../api/types';
import type { StreamFailure } from './stream';

// ── The turn as UI state (§4.4, §9) ─────────────────────────────────────────

export interface TurnView {
  phase: 'sending' | 'streaming' | 'done' | 'failed';
  stage: TurnStage | null;
  /** Stages in the order they arrived, for the progress line. */
  stages: TurnStage[];
  meta: TurnMeta | null;
  /** The visible answer so far: already unmasked. */
  text: string;
  activeTool: string | null;
  tools: ToolCallRecord[];
  result: TurnResult | null;
  error: StreamErrorEvent | null;
  queue: QueueLoad | null;
  /** The model started writing: from here on a failure leaves the question stored. */
  generating: boolean;
}

export const initialTurnView = (): TurnView => ({
  phase: 'sending',
  stage: null,
  stages: [],
  meta: null,
  text: '',
  activeTool: null,
  tools: [],
  result: null,
  error: null,
  queue: null,
  generating: false,
});

/** Folds one event into the view. Pure: use with useReducer. */
export function turnReducer(view: TurnView, event: TurnStreamEvent): TurnView {
  switch (event.event) {
    case 'meta':
      return { ...view, phase: 'streaming', meta: event.data };
    case 'status': {
      const status = event.data;
      return {
        ...view,
        stage: status.stage,
        stages: view.stages.includes(status.stage) ? view.stages : [...view.stages, status.stage],
        activeTool: status.stage === 'tool' ? status.tool : view.activeTool,
        queue:
          status.stage === 'queued' ? { inUse: status.inUse, waiting: status.waiting, capacity: status.capacity } : view.queue,
        generating: view.generating || status.stage === 'generating' || status.stage === 'thinking' || status.stage === 'tool',
      };
    }
    case 'delta':
      return { ...view, text: view.text + event.data.text, generating: true };
    case 'tool':
      return { ...view, activeTool: null, tools: [...view.tools, event.data] };
    case 'done':
      return {
        ...view,
        phase: 'done',
        stage: null,
        activeTool: null,
        result: event.data,
        // The stored answer is the truth; the deltas concatenate to it.
        text: event.data.assistantMessage.content ?? view.text,
      };
    case 'error':
      return { ...view, phase: 'failed', stage: null, activeTool: null, error: event.data };
  }
}

const STAGE_LABEL: Readonly<Record<TurnStage, string>> = {
  retrieving: 'Searching knowledge…',
  redacting: 'Protecting personal data…',
  queued: 'Waiting for the model…',
  generating: 'Writing…',
  thinking: 'Thinking…',
  tool: 'Using a tool…',
};

export const stageLabel = (stage: TurnStage | null, tool?: string | null): string | null =>
  stage === 'tool' && tool ? `Using ${tool}…` : stage ? STAGE_LABEL[stage] : null;

// ── After a stop, a dropped connection or a timeout (§9.4) ──────────────────

export type Reconciled =
  /** The answer was stored. Show the stored message. */
  | { state: 'answered'; message: Message }
  /** Stopped or failed part-way; the partial text is stored. */
  | { state: 'partial'; message: Message }
  /** The question was stored but no answer yet: the turn may still be running. */
  | { state: 'running' }
  /** Nothing was stored: safe to send again (keep the same clientMessageId). */
  | { state: 'not-started' };

/** Compares the newest page of messages with what `meta` announced. */
export function reconcileTurn(latest: readonly Message[], meta: TurnMeta | null): Reconciled {
  if (!meta) return { state: 'not-started' };
  const answer = latest.find((message) => message.id === meta.assistantMessageId);
  if (answer) return answer.status === 'COMPLETE' ? { state: 'answered', message: answer } : { state: 'partial', message: answer };
  if (latest.some((message) => message.id === meta.userMessageId)) return { state: 'running' };
  return { state: 'not-started' };
}

/**
 * Reconciling without `meta` (the non-streaming send, or a stream that never opened):
 * a USER message with exactly this text after the last sequence we knew of.
 */
export function findSentQuestion(latest: readonly Message[], content: string, afterSequence: number): Message | null {
  return (
    latest.find((message) => message.role === 'USER' && message.sequence > afterSequence && message.content === content) ?? null
  );
}

/** The answer that follows a stored question, if there is one yet. */
export function answerAfter(latest: readonly Message[], question: Message): Message | null {
  return latest.find((message) => message.role === 'ASSISTANT' && message.sequence > question.sequence) ?? null;
}

/** A fresh idempotency key per new question; reuse it to retry that same question. */
export function newClientMessageId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Not a secure context: build a v4 UUID by hand; the server only checks the shape.
    const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
    hex[12] = '4';
    hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
    const s = hex.join('');
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
  }
}

// ── Errors (§4.9, §10) ──────────────────────────────────────────────────────

export interface TurnAdvice {
  /** wait: retry after `waitSeconds` (a countdown, never a loop); manual: offer a retry button. */
  retry: 'wait' | 'manual' | 'none';
  waitSeconds?: number;
  /** The question can be resent: nothing was stored. */
  safeToResend: boolean;
}

/** Governance and capacity refusals: flow control, not failures. Nothing was stored. */
export const WAIT_CODES: ReadonlySet<string> = new Set([
  'TOKEN_RATE_LIMITED',
  'LLM_BUSY',
  'RATE_LIMIT_EXCEEDED',
  'QUOTA_EXCEEDED',
  'AGENT_CIRCUIT_OPEN',
]);

const MANUAL_CODES: ReadonlySet<string> = new Set([
  // Another turn holds the conversation (another tab, an API client): keep the draft, retry later.
  'CONVERSATION_BUSY',
  'LLM_UNAVAILABLE',
  'LLM_TIMEOUT',
  'LLM_REJECTED',
  'LLM_RESPONSE_INVALID',
  'AI_SERVICE_UNAVAILABLE',
  'VECTOR_STORE_UNAVAILABLE',
  'PII_DETECTION_UNAVAILABLE',
  'REQUEST_TIMEOUT',
  'INTERNAL_SERVER_ERROR',
  'SERVICE_UNAVAILABLE',
  'UNEXPECTED_RESPONSE',
  'SESSION_CHANGED',
]);

/** Waits short enough to retry once by itself (§4.9 "retry once automatically"). Never a loop. */
const AUTO_RETRY_CODES: ReadonlySet<string> = new Set(['TOKEN_RATE_LIMITED', 'LLM_BUSY', 'RATE_LIMIT_EXCEEDED']);
export const AUTO_RETRY_MAX_SECONDS = 30;

/**
 * How to recover from a failed turn. `questionStored`: the question is known to be
 * in the conversation (a failure after `generating`), so resending would ask twice.
 */
export function turnAdvice(failure: Pick<StreamFailure, 'code' | 'retryAfterSeconds'>, questionStored: boolean): TurnAdvice {
  const safeToResend = !questionStored;
  if (WAIT_CODES.has(failure.code)) return { retry: 'wait', waitSeconds: failure.retryAfterSeconds ?? 5, safeToResend };
  if (MANUAL_CODES.has(failure.code)) return { retry: 'manual', safeToResend };
  return { retry: 'none', safeToResend };
}

/** Whether a wait may be followed by one automatic retry with the same clientMessageId. */
export const autoRetryable = (failure: Pick<StreamFailure, 'code' | 'retryAfterSeconds'>): boolean =>
  AUTO_RETRY_CODES.has(failure.code) && (failure.retryAfterSeconds ?? 5) <= AUTO_RETRY_MAX_SECONDS;

/** A stream failure as an ApiError, so `messageFor` and `titleFor` describe both forms alike. */
export function failureAsError(failure: StreamFailure): ApiError {
  return new ApiError({
    status: failure.status,
    code: failure.code,
    message: failure.message,
    details: failure.details,
    requestId: failure.requestId,
    retryAfterSeconds: failure.retryAfterSeconds,
    source: failure.status === 0 ? 'client' : 'server',
  });
}

/** What the composer area should offer after a refusal (§10 "Required experience"). */
export type TurnRemedy = 'unarchive' | 'new-conversation' | 'shorten' | 'reload' | null;

export function remedyFor(code: string): TurnRemedy {
  switch (code) {
    case 'CONVERSATION_ARCHIVED':
      return 'unarchive';
    case 'CONVERSATION_TOKEN_BUDGET_EXCEEDED':
    case 'AGENT_UNAVAILABLE':
      return 'new-conversation';
    case 'LLM_CONTEXT_OVERFLOW':
      return 'shorten';
    case 'AGENT_NOT_FOUND':
    case 'CONVERSATION_NOT_FOUND':
      return 'reload';
    default:
      return null;
  }
}
