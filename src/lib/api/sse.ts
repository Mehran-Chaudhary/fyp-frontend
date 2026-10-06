/**
 * Server-Sent Events over POST (Phase 4 spec §4.5, Appendix A).
 *
 * `EventSource` can only GET and can't send the bearer header, so the two streaming
 * operations (P4-API-19, P4-API-21) are read with fetch and this line parser.
 */

export interface SseMessage {
  event: string;
  data: string;
  id?: string;
}

/**
 * The SSE line protocol: `event:` / `data:` / `id:` fields, a blank line ends an
 * event, `:` lines are heartbeats, `retry:` is ignored (a POST is never
 * reconnected: that would send the question again). Feed it decoded text in any
 * chunking; CRLF and LF line endings both work.
 */
export function createSseParser(onMessage: (message: SseMessage) => void): { push(text: string): void } {
  let buffer = '';
  let event = '';
  let data: string[] = [];
  let id: string | undefined;
  return {
    push(text: string) {
      buffer += text;
      for (;;) {
        const end = buffer.indexOf('\n');
        if (end < 0) return;
        let line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line === '') {
          if (data.length > 0) onMessage({ event: event || 'message', data: data.join('\n'), id });
          event = '';
          data = [];
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
        else if (field === 'id') id = value;
      }
    },
  };
}
