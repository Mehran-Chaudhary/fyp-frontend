import { describe, expect, it } from 'vitest';
import { filenameFromDisposition } from './download';

describe('filenameFromDisposition', () => {
  it('prefers the RFC 5987 name, so non-ASCII names survive', () => {
    expect(
      filenameFromDisposition(`attachment; filename="_berblick remote-work.md"; filename*=UTF-8''%C3%9Cberblick%20remote-work.md`),
    ).toBe('Überblick remote-work.md');
  });

  it('reads plain names', () => {
    expect(filenameFromDisposition(`attachment; filename="travel.pdf"; filename*=UTF-8''travel.pdf`)).toBe('travel.pdf');
    expect(filenameFromDisposition('attachment; filename="report.docx"')).toBe('report.docx');
    expect(filenameFromDisposition('attachment; filename=notes.txt')).toBe('notes.txt');
  });

  it('falls back to the plain name when the extended one is malformed', () => {
    expect(filenameFromDisposition(`attachment; filename="x.md"; filename*=UTF-8''%E0%A4%A.md`)).toBe('x.md');
  });

  it('returns null without a header or a name', () => {
    expect(filenameFromDisposition(null)).toBeNull();
    expect(filenameFromDisposition('inline')).toBeNull();
  });
});
