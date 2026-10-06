import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { conversationsApi } from '@/lib/api/endpoints';
import { isApiError } from '@/lib/api/errors';
import type { Message, SendMessageInput, TurnResult, TurnStreamEvent } from '@/lib/api/types';
import { afterTurnSettled, refetchNewestPage } from '@/lib/agents/cache';
import { TURN_LOCK_MAX_MS } from '@/lib/agents/limits';
import { announceTurn, postEventStream, trackStream, type StreamFailure, type StreamOutcome } from '@/lib/agents/stream';
import {
  answerAfter,
  autoRetryable,
  findSentQuestion,
  initialTurnView,
  newClientMessageId,
  reconcileTurn,
  turnAdvice,
  turnReducer,
  type TurnAdvice,
  type TurnView,
} from '@/lib/agents/turn';
import { timestamp } from '@/lib/utils';

/** Per-turn choices from the composer (§6 "Send / stream"). */
export interface TurnOptions {
  /** Stream the answer (P4-API-19) or wait for it whole (P4-API-18). */
  stream: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  retrieval?: { enabled?: boolean; knowledgeBaseIds?: string[] };
}

/** One question as sent: its idempotency key is reused only to retry this same text. */
export interface Question {
  content: string;
  clientMessageId: string;
  options: TurnOptions;
  /** The newest sequence known before sending: how to find it again without `meta`. */
  afterSequence: number;
  /** An automatic retry already happened for it (never more than one, §4.9). */
  autoRetried: boolean;
}

export type TurnPhase =
  | { kind: 'idle' }
  /** Sending or streaming. */
  | { kind: 'running'; question: Question; view: TurnView; startedAt: number }
  /** Stopped, dropped or failed after the model started: reading the stored state back (§9.4). */
  | { kind: 'reconciling'; question: Question; view: TurnView; why: 'stopped' | 'interrupted' | 'failed' }
  /** The question is stored but no answer yet: polling the newest page until the server's budget runs out. */
  | { kind: 'waiting'; question: Question; view: TurnView; startedAt: number }
  /** Nothing was stored. The question can be sent again with the same key. */
  | { kind: 'failed'; question: Question; view: TurnView; failure: StreamFailure; advice: TurnAdvice; retryAt: number | null; auto: boolean }
  /** The connection was lost before anything was stored, as far as a read can tell. */
  | { kind: 'lost'; question: Question; view: TurnView };

const POLL_MS = 2_500;
/** The server's budget for one turn (§2 "Time budgets"). */
const TURN_BUDGET_MS = 300_000;

function bodyOf(question: Question): SendMessageInput {
  const { options } = question;
  const parameters = {
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
  };
  return {
    content: question.content,
    clientMessageId: question.clientMessageId,
    ...(Object.keys(parameters).length ? { parameters } : {}),
    ...(options.retrieval ? { retrieval: options.retrieval } : {}),
  };
}

/** A non-streaming send's failure, in the stream's terms. */
function failureOf(error: unknown): StreamFailure | null {
  if (!isApiError(error)) return null;
  return {
    status: error.status,
    code: error.code,
    message: error.message,
    details: error.details,
    retryAfterSeconds: error.retryAfterSeconds,
    requestId: error.requestId,
    afterOpen: false,
  };
}

/**
 * Runs the turns of one conversation (§4.4, §4.9, §9.3, §9.4): one at a time,
 * streamed or whole, stoppable, and reconciled with a read whenever the outcome
 * is uncertain. Never resends blindly: a retry reuses the question's
 * clientMessageId, so the server answers 409 MESSAGE_DUPLICATE instead of asking
 * twice. Unmounting (leaving the conversation, switching workspace) aborts.
 */
export function useTurn(
  workspaceId: string,
  conversationId: string,
  options: {
    /** A question stopped before the server stored it: give its text back to the composer. */
    onRestore?: (content: string) => void;
  } = {},
) {
  const [phase, setPhase] = useState<TurnPhase>({ kind: 'idle' });
  const [results, setResults] = useState<ReadonlyMap<string, TurnResult>>(() => new Map());
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const onRestore = useRef(options.onRestore);
  useEffect(() => {
    onRestore.current = options.onRestore;
  });

  useEffect(
    () => () => {
      generation.current += 1;
      if (controller.current) {
        controller.current.abort();
        announceTurn('ended', workspaceId, conversationId);
      }
    },
    [workspaceId, conversationId],
  );

  const settle = (stored: readonly Message[]) => {
    void afterTurnSettled(workspaceId, conversationId, stored);
  };

  /** Reads the newest page and decides what happened to `question` (§9.4). */
  const reconcile = async (question: Question, view: TurnView, why: 'stopped' | 'interrupted' | 'failed', run: number) => {
    setPhase({ kind: 'reconciling', question, view, why });
    let latest: Message[];
    try {
      latest = await refetchNewestPage(workspaceId, conversationId);
    } catch {
      if (run !== generation.current) return;
      // Can't tell: show it as lost, with a resend that is safe because of the key.
      setPhase({ kind: 'lost', question, view });
      return;
    }
    if (run !== generation.current) return;

    let state: 'answered' | 'partial' | 'running' | 'not-started';
    if (view.meta) {
      state = reconcileTurn(latest, view.meta).state;
    } else {
      const asked = findSentQuestion(latest, question.content, question.afterSequence);
      const answer = asked ? answerAfter(latest, asked) : null;
      state = !asked ? 'not-started' : answer ? (answer.status === 'COMPLETE' ? 'answered' : 'partial') : 'running';
    }

    if (state === 'answered' || state === 'partial') {
      settle([]);
      setPhase({ kind: 'idle' });
    } else if (state === 'running') {
      setPhase({ kind: 'waiting', question, view, startedAt: timestamp() });
    } else if (why === 'stopped') {
      // Stopped before the model accepted it: nothing was stored, so the text goes back to you.
      setPhase({ kind: 'idle' });
      onRestore.current?.(question.content);
    } else {
      setPhase({ kind: 'lost', question, view });
    }
  };

  const finish = async (question: Question, outcome: StreamOutcome<TurnResult>, viewAtEnd: TurnView, run: number) => {
    if (run !== generation.current) return;
    controller.current = null;
    announceTurn('ended', workspaceId, conversationId);

    switch (outcome.kind) {
      case 'done': {
        const result = outcome.result;
        settle([result.userMessage, result.assistantMessage]);
        setResults((current) => new Map(current).set(result.assistantMessage.id, result));
        setPhase({ kind: 'idle' });
        return;
      }
      case 'aborted':
        // The server keeps what was shown as a CANCELLED message once it had started.
        if (outcome.opened || viewAtEnd.meta) await reconcile(question, viewAtEnd, 'stopped', run);
        else {
          setPhase({ kind: 'idle' });
          onRestore.current?.(question.content);
        }
        return;
      case 'interrupted':
        await reconcile(question, viewAtEnd, 'interrupted', run);
        return;
      case 'failed': {
        const { failure } = outcome;
        if (failure.code === 'MESSAGE_DUPLICATE') {
          // It was stored after all (a retry of a question that got through): read it back.
          await reconcile(question, viewAtEnd, 'interrupted', run);
          return;
        }
        // After `generating`, the question and a FAILED answer are stored; a 5xx or a
        // timeout from the plain send leaves it unknown. Both are read back first.
        const maybeStored = failure.afterOpen
          ? viewAtEnd.generating
          : failure.status >= 500 || failure.status === 0 || failure.code === 'REQUEST_TIMEOUT';
        if (maybeStored) {
          setPhase({ kind: 'reconciling', question, view: viewAtEnd, why: 'failed' });
          let latest: Message[] = [];
          try {
            latest = await refetchNewestPage(workspaceId, conversationId);
          } catch {
            /* unknown: shown as failed, and a resend is safe because of the key */
          }
          if (run !== generation.current) return;
          const stored = viewAtEnd.meta
            ? latest.some((message) => message.id === viewAtEnd.meta?.userMessageId)
            : !!findSentQuestion(latest, question.content, question.afterSequence);
          if (stored) {
            settle([]);
            setPhase({ kind: 'idle' });
            return;
          }
        }
        const advice = turnAdvice(failure, false);
        const auto = advice.retry === 'wait' && !question.autoRetried && autoRetryable(failure);
        setPhase({
          kind: 'failed',
          question,
          view: viewAtEnd,
          failure,
          advice,
          retryAt: advice.retry === 'wait' ? timestamp() + (advice.waitSeconds ?? 5) * 1000 : null,
          auto,
        });
      }
    }
  };

  const run = async (question: Question) => {
    if (controller.current) return; // one turn at a time (§9.3)
    const abort = new AbortController();
    controller.current = abort;
    const untrack = trackStream(abort);
    const runId = ++generation.current;
    let view = initialTurnView();
    setPhase({ kind: 'running', question, view, startedAt: timestamp() });
    announceTurn('started', workspaceId, conversationId);

    let outcome: StreamOutcome<TurnResult>;
    try {
      if (question.options.stream) {
        outcome = await postEventStream<TurnStreamEvent>(
          (options) => conversationsApi.stream(workspaceId, conversationId, bodyOf(question), options),
          {
            signal: abort.signal,
            onEvent: (event) => {
              view = turnReducer(view, event);
              if (runId !== generation.current) return;
              const next = view;
              setPhase((current) => (current.kind === 'running' && current.question === question ? { ...current, view: next } : current));
            },
          },
        );
      } else {
        try {
          const result = await conversationsApi.send(workspaceId, conversationId, bodyOf(question), abort.signal);
          outcome = { kind: 'done', result };
        } catch (error) {
          if (abort.signal.aborted) outcome = { kind: 'aborted', opened: true };
          else if (isApiError(error) && (error.code === 'NETWORK_ERROR' || error.code === 'NETWORK_TIMEOUT')) outcome = { kind: 'interrupted', opened: true };
          else {
            const failure = failureOf(error);
            outcome = failure ? { kind: 'failed', failure } : { kind: 'interrupted', opened: true };
          }
        }
      }
    } finally {
      untrack();
    }
    await finish(question, outcome, view, runId);
  };

  /** Sends a new question (a fresh idempotency key). */
  const send = (content: string, options: TurnOptions, afterSequence: number) => {
    void run({ content, clientMessageId: newClientMessageId(), options, afterSequence, autoRetried: false });
  };

  /** Sends the same question again, with the same key: never a duplicate. */
  const retry = (auto = false) => {
    if (phase.kind !== 'failed' && phase.kind !== 'lost') return;
    void run({ ...phase.question, autoRetried: phase.question.autoRetried || auto });
  };

  /** Stop: aborts the request. The server keeps what was shown as a CANCELLED message. */
  const stop = () => controller.current?.abort();

  /** Stops polling for an answer the server may still be writing; the history refreshes on its own later. */
  const stopWaiting = () => {
    setPhase((current) => (current.kind === 'waiting' ? { kind: 'idle' } : current));
    settle([]);
  };

  /** Forgets a failed or lost question (after "Edit" moved it back to the composer). */
  const dismiss = () => setPhase((current) => (current.kind === 'failed' || current.kind === 'lost' ? { kind: 'idle' } : current));

  // One automatic retry after a short governance wait (§4.9): never a loop.
  const autoRetry = useEffectEvent(() => retry(true));
  const autoAt = phase.kind === 'failed' && phase.auto ? phase.retryAt : null;
  useEffect(() => {
    if (autoAt === null) return;
    const timer = window.setTimeout(autoRetry, Math.max(0, autoAt - timestamp()));
    return () => window.clearTimeout(timer);
  }, [autoAt]);

  // The question is stored and the server may still be answering: poll the newest page.
  const poll = useEffectEvent(async () => {
    if (phase.kind !== 'waiting') return;
    const { question, view, startedAt } = phase;
    const runId = generation.current;
    try {
      const latest = await refetchNewestPage(workspaceId, conversationId);
      if (runId !== generation.current) return;
      const asked = view.meta ? latest.find((message) => message.id === view.meta?.userMessageId) : findSentQuestion(latest, question.content, question.afterSequence);
      const answered = view.meta ? latest.some((message) => message.id === view.meta?.assistantMessageId) : !!(asked && answerAfter(latest, asked));
      if (answered || timestamp() - startedAt > TURN_BUDGET_MS) {
        settle([]);
        setPhase({ kind: 'idle' });
      }
    } catch {
      /* keep polling until the budget runs out */
    }
  });
  const waiting = phase.kind === 'waiting';
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting]);

  return {
    phase,
    results,
    busy: phase.kind === 'running' || phase.kind === 'reconciling' || phase.kind === 'waiting',
    send,
    retry,
    stop,
    stopWaiting,
    dismiss,
  };
}

export type TurnController = ReturnType<typeof useTurn>;

/** How long another tab's turn can hold the conversation before we stop believing it. */
export const OTHER_TAB_TURN_MAX_MS = TURN_LOCK_MAX_MS;
