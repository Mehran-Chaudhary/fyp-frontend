import type { EventStreamEnd } from '../api/client';
import { isApiError } from '../api/errors';
import type { SseMessage } from '../api/sse';
import { authEvents } from '../api/token-manager';
import type { ChatStreamEvent, StreamErrorEvent, TurnStreamEvent } from '../api/types';

/** A failure in either form: a JSON envelope before the stream, or an `error` event after (§4.4). */
export interface StreamFailure {
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  retryAfterSeconds?: number;
  requestId?: string;
  /** False: refused before anything ran (JSON). True: an `error` event after `meta`. */
  afterOpen: boolean;
}

export type StreamOutcome<TDone> =
  | { kind: 'done'; result: TDone; requestId?: string }
  | { kind: 'failed'; failure: StreamFailure }
  /** You aborted. Anything shown may have been stored as a CANCELLED message. */
  | { kind: 'aborted'; opened: boolean; requestId?: string }
  /** The connection broke, went silent, or ended without `done`/`error`. Reconcile with a read. */
  | { kind: 'interrupted'; opened: boolean; requestId?: string };

type AnyStreamEvent = TurnStreamEvent | ChatStreamEvent;
type DoneOf<E extends AnyStreamEvent> = Extract<E, { event: 'done' }>['data'];

const KNOWN_EVENTS: ReadonlySet<string> = new Set(['meta', 'status', 'delta', 'tool', 'done', 'error']);

/**
 * Reads one POST event stream to its end and folds it into an outcome (Appendix A
 * `postEventStream`). Never throws for HTTP or stream failures: every ending is an
 * outcome, so the caller has exactly one place to decide what to show. `open` is an
 * endpoint function (P4-API-19 or P4-API-21) bound to its workspace and body.
 */
export async function postEventStream<E extends AnyStreamEvent>(
  open: (options: { onMessage: (message: SseMessage) => void; signal?: AbortSignal }) => Promise<EventStreamEnd>,
  options: { onEvent: (event: E) => void; signal?: AbortSignal },
): Promise<StreamOutcome<DoneOf<E>>> {
  let done: DoneOf<E> | undefined;
  let failure: StreamFailure | undefined;

  const onMessage = (message: SseMessage) => {
    if (!KNOWN_EVENTS.has(message.event)) return;
    let data: unknown;
    try {
      data = JSON.parse(message.data);
    } catch {
      return; // every server event is one JSON line; ignore anything else
    }
    const event = { event: message.event, data } as E;
    if (event.event === 'done') done = event.data as DoneOf<E>;
    if (event.event === 'error') failure = { ...(event.data as StreamErrorEvent), afterOpen: true };
    options.onEvent(event);
  };

  let end: EventStreamEnd;
  try {
    end = await open({ onMessage, signal: options.signal });
  } catch (error) {
    if (options.signal?.aborted) return { kind: 'aborted', opened: false };
    if (isApiError(error)) {
      return {
        kind: 'failed',
        failure: {
          status: error.status,
          code: error.code,
          message: error.message,
          details: error.details,
          retryAfterSeconds: error.retryAfterSeconds,
          requestId: error.requestId,
          afterOpen: false,
        },
      };
    }
    return { kind: 'interrupted', opened: false };
  }

  if (end.kind === 'aborted') return { kind: 'aborted', opened: end.opened, requestId: end.requestId };
  // `done` or `error` may have arrived just before the connection dropped: they still count.
  if (done !== undefined) return { kind: 'done', result: done, requestId: end.requestId };
  if (failure) return { kind: 'failed', failure: { ...failure, requestId: failure.requestId ?? end.requestId } };
  return { kind: 'interrupted', opened: end.kind === 'interrupted' ? end.opened : true, requestId: end.requestId };
}

// ── Every running stream, so a sign-out can stop them all (§9.2, §9.3) ──────

const running = new Set<AbortController>();

/** Tracks a stream's controller until the returned function is called. */
export function trackStream(controller: AbortController): () => void {
  running.add(controller);
  return () => running.delete(controller);
}

/** Aborts every stream in this tab: sign-out, session end. Partial text is discarded by its owner. */
export function abortAllStreams(): void {
  for (const controller of running) controller.abort();
  running.clear();
}

authEvents.on('session-ended', () => abortAllStreams());

// ── One turn per conversation across tabs (§9.3) ────────────────────────────

/** Ids only: no content ever crosses the channel. */
export interface TurnSignal {
  type: 'started' | 'ended';
  workspaceId: string;
  conversationId: string;
  tab: string;
}

const TAB_ID = (() => {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2);
  }
})();

const turnChannel: BroadcastChannel | null = (() => {
  try {
    return typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('agentvault-turns') : null;
  } catch {
    return null;
  }
})();

/** Tells other tabs that this tab started or finished a turn in a conversation. */
export function announceTurn(type: TurnSignal['type'], workspaceId: string, conversationId: string): void {
  try {
    turnChannel?.postMessage({ type, workspaceId, conversationId, tab: TAB_ID } satisfies TurnSignal);
  } catch {
    /* channel closed */
  }
}

/** Turns started or finished in other tabs. Returns the unsubscribe function. */
export function onOtherTabTurn(listener: (signal: TurnSignal) => void): () => void {
  if (!turnChannel) return () => undefined;
  const handle = (event: MessageEvent<TurnSignal>) => {
    const signal = event.data;
    if (!signal || typeof signal !== 'object' || signal.tab === TAB_ID) return;
    if (signal.type !== 'started' && signal.type !== 'ended') return;
    listener(signal);
  };
  turnChannel.addEventListener('message', handle);
  return () => turnChannel.removeEventListener('message', handle);
}
