import { describe, expect, it } from 'vitest';
import type { EventStreamEnd } from '../api/client';
import { ApiError } from '../api/errors';
import type { SseMessage } from '../api/sse';
import type { ChatStreamEvent } from '../api/types';
import { postEventStream } from './stream';

const send = (messages: SseMessage[], end: EventStreamEnd) => async (options: { onMessage: (message: SseMessage) => void }) => {
  for (const message of messages) options.onMessage(message);
  return end;
};

describe('postEventStream (Appendix A)', () => {
  it('ends with done', async () => {
    const seen: string[] = [];
    const outcome = await postEventStream<ChatStreamEvent>(
      send(
        [
          { event: 'meta', data: '{"invocationId":"i","model":"m"}' },
          { event: 'delta', data: '{"text":"pong"}' },
          { event: 'done', data: '{"content":"pong"}' },
        ],
        { kind: 'closed', requestId: 'r1' },
      ),
      { onEvent: (event) => seen.push(event.event) },
    );
    expect(seen).toEqual(['meta', 'delta', 'done']);
    expect(outcome).toMatchObject({ kind: 'done', requestId: 'r1', result: { content: 'pong' } });
  });

  it('turns an error event into a failure after open', async () => {
    const outcome = await postEventStream<ChatStreamEvent>(
      send([{ event: 'error', data: '{"code":"PII_DETECTION_UNAVAILABLE","message":"x","status":503}' }], { kind: 'closed', requestId: 'r2' }),
      { onEvent: () => undefined },
    );
    expect(outcome).toEqual({
      kind: 'failed',
      failure: { code: 'PII_DETECTION_UNAVAILABLE', message: 'x', status: 503, afterOpen: true, requestId: 'r2' },
    });
  });

  it('turns a JSON refusal into a failure before open', async () => {
    const outcome = await postEventStream<ChatStreamEvent>(
      async () => {
        throw new ApiError({ status: 409, code: 'CONVERSATION_ARCHIVED', message: 'archived', requestId: 'r3' });
      },
      { onEvent: () => undefined },
    );
    expect(outcome).toMatchObject({ kind: 'failed', failure: { code: 'CONVERSATION_ARCHIVED', status: 409, afterOpen: false } });
  });

  it('reports a stream that closed without done as interrupted', async () => {
    const outcome = await postEventStream<ChatStreamEvent>(send([{ event: 'delta', data: '{"text":"a"}' }], { kind: 'closed' }), {
      onEvent: () => undefined,
    });
    expect(outcome).toMatchObject({ kind: 'interrupted', opened: true });
  });

  it('ignores unknown events and non-JSON data', async () => {
    const seen: string[] = [];
    await postEventStream<ChatStreamEvent>(
      send(
        [
          { event: 'message', data: 'x' },
          { event: 'delta', data: 'not json' },
        ],
        { kind: 'closed' },
      ),
      { onEvent: (event) => seen.push(event.event) },
    );
    expect(seen).toEqual([]);
  });
});
