import { describe, expect, it } from 'vitest';
import { createSseParser, type SseMessage } from './sse';

/** The verified raw bytes of a direct-chat stream (Phase 4 spec §4.5), `done` shortened. */
const RAW = [
  'retry: 5000',
  '',
  'id: 1',
  'event: meta',
  'data: {"invocationId":"6b16a8de-a212-464f-8177-2a869949227c","model":"qwen/qwen3.8-27b"}',
  '',
  'id: 2',
  'event: status',
  'data: {"stage":"redacting"}',
  '',
  ': keep-alive',
  '',
  'id: 3',
  'event: delta',
  'data: {"text":"Hello"}',
  '',
  'id: 4',
  'event: delta',
  'data: {"text":" Imran Siddiqui.\\nNext line"}',
  '',
  'id: 5',
  'event: done',
  'data: {"content":"Hello Imran Siddiqui.\\nNext line"}',
  '',
  '',
].join('\n');

function parseAll(text: string, chunk: number): SseMessage[] {
  const out: SseMessage[] = [];
  const parser = createSseParser((message) => out.push(message));
  for (let i = 0; i < text.length; i += chunk) parser.push(text.slice(i, i + chunk));
  return out;
}

describe('createSseParser (spec §4.5)', () => {
  it('reads events, ignores retry and heartbeats', () => {
    const events = parseAll(RAW, RAW.length);
    expect(events.map((event) => event.event)).toEqual(['meta', 'status', 'delta', 'delta', 'done']);
    expect(events[0].id).toBe('1');
    expect(JSON.parse(events[3].data).text).toBe(' Imran Siddiqui.\nNext line');
  });

  it.each([1, 3, 7, 64])('gives the same events in %i-character chunks', (size) => {
    expect(parseAll(RAW, size)).toEqual(parseAll(RAW, RAW.length));
  });

  it('accepts CRLF line endings', () => {
    expect(parseAll(RAW.replace(/\n/g, '\r\n'), 5)).toEqual(parseAll(RAW, RAW.length));
  });

  it('joins several data lines and defaults the event name', () => {
    expect(parseAll('data: a\ndata: b\n\n', 2)).toEqual([{ event: 'message', data: 'a\nb', id: undefined }]);
  });

  it('holds an unfinished event until its blank line', () => {
    const out: SseMessage[] = [];
    const parser = createSseParser((message) => out.push(message));
    parser.push('event: delta\ndata: {"text":"x"}\n');
    expect(out).toHaveLength(0);
    parser.push('\n');
    expect(out).toHaveLength(1);
  });
});
