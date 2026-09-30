import { describe, expect, it } from 'vitest';
import type { DetectedEntity } from '../api/types';
import { humanizeEntityType, parsePlaceholder, reportPages, splitPlaceholders } from './pii';

const entities: DetectedEntity[] = [
  { entityType: 'PERSON', start: 8, end: 19, score: 0.85, source: 'ner', recognizer: 'e2e-ner@1', placeholder: '[PERSON_1]' },
  { entityType: 'EMAIL_ADDRESS', start: 23, end: 44, score: 1, source: 'pattern', recognizer: 'email', placeholder: '[EMAIL_ADDRESS_1]' },
];

describe('splitPlaceholders', () => {
  it('splits text and placeholders, each placeholder carrying its entity', () => {
    const parts = splitPlaceholders('Contact [PERSON_1] at [EMAIL_ADDRESS_1].', entities);
    expect(parts.map((part) => part.kind)).toEqual(['text', 'entity', 'text', 'entity', 'text']);
    expect(parts[1]).toEqual({ kind: 'entity', placeholder: '[PERSON_1]', entity: entities[0] });
    expect(parts[3]).toEqual({ kind: 'entity', placeholder: '[EMAIL_ADDRESS_1]', entity: entities[1] });
    expect(parts[4]).toEqual({ kind: 'text', text: '.' });
  });

  it('keeps plain text as one part', () => {
    expect(splitPlaceholders('Annual leave policy.', [])).toEqual([{ kind: 'text', text: 'Annual leave policy.' }]);
  });

  it('handles placeholders at the edges and next to each other', () => {
    const parts = splitPlaceholders('[PERSON_1][EMAIL_ADDRESS_1]', entities);
    expect(parts.map((part) => part.kind)).toEqual(['entity', 'entity']);
  });

  it('still chips a placeholder the entity list lacks', () => {
    expect(splitPlaceholders('[CUSTOM_1]', [])).toEqual([{ kind: 'entity', placeholder: '[CUSTOM_1]', entity: undefined }]);
  });

  it('leaves bracketed text that is not a placeholder alone', () => {
    expect(splitPlaceholders('See [note] and [a_1].', [])).toEqual([{ kind: 'text', text: 'See [note] and [a_1].' }]);
  });
});

describe('report helpers', () => {
  it('computes pages from totalChunks', () => {
    expect(reportPages(21, 10)).toBe(3);
    expect(reportPages(0, 10)).toBe(1);
    expect(reportPages(10, 10)).toBe(1);
  });

  it('parses placeholders', () => {
    expect(parsePlaceholder('[EMAIL_ADDRESS_12]')).toEqual({ type: 'EMAIL_ADDRESS', index: 12 });
    expect(parsePlaceholder('EMAIL')).toBeNull();
  });

  it('labels unknown entity types', () => {
    expect(humanizeEntityType('EMAIL_ADDRESS')).toBe('Email address');
    expect(humanizeEntityType('IBAN_CODE')).toBe('IBAN code');
  });
});
