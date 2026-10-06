import { describe, expect, it } from 'vitest';
import { inlineText, parseInline, parseMarkdown, safeHref } from './markdown';

describe('parseInline', () => {
  it('finds citations and placeholders', () => {
    expect(parseInline('24 days [S2][S10]. Ask [PERSON_1].')).toEqual([
      { type: 'text', text: '24 days ' },
      { type: 'citation', tag: 'S2' },
      { type: 'citation', tag: 'S10' },
      { type: 'text', text: '. Ask ' },
      { type: 'placeholder', text: '[PERSON_1]' },
      { type: 'text', text: '.' },
    ]);
  });

  it('reads emphasis, code and strikethrough', () => {
    expect(parseInline('**bold** and *it* and `a*b` and ~~old~~')).toEqual([
      { type: 'strong', children: [{ type: 'text', text: 'bold' }] },
      { type: 'text', text: ' and ' },
      { type: 'em', children: [{ type: 'text', text: 'it' }] },
      { type: 'text', text: ' and ' },
      { type: 'code', text: 'a*b' },
      { type: 'text', text: ' and ' },
      { type: 'del', children: [{ type: 'text', text: 'old' }] },
    ]);
  });

  it('leaves snake_case and unclosed markers alone (streaming)', () => {
    expect(inlineText(parseInline('max_output_tokens and **half'))).toBe('max_output_tokens and **half');
    expect(parseInline('max_output_tokens').every((node) => node.type === 'text')).toBe(true);
  });

  it('links only safe protocols', () => {
    expect(parseInline('[docs](https://example.com/a)')[0]).toEqual({
      type: 'link',
      href: 'https://example.com/a',
      children: [{ type: 'text', text: 'docs' }],
    });
    expect(parseInline('[x](javascript:alert(1))')[0]).toEqual({ type: 'text', text: 'x' });
    expect(safeHref('data:text/html,hi')).toBeNull();
    expect(safeHref('mailto:hr@acme.test')).toBe('mailto:hr@acme.test');
  });

  it('links bare URLs without trailing punctuation', () => {
    const nodes = parseInline('See https://acme.test/policy.');
    expect(nodes[1]).toMatchObject({ type: 'link', href: 'https://acme.test/policy' });
    expect(nodes[2]).toEqual({ type: 'text', text: '.' });
  });

  it('never produces HTML: tags stay text', () => {
    expect(parseInline('<img src=x onerror=alert(1)>')).toEqual([{ type: 'text', text: '<img src=x onerror=alert(1)>' }]);
  });

  it('honours escapes and line breaks', () => {
    expect(parseInline('a \\*not\\* b\nc')).toEqual([{ type: 'text', text: 'a *not* b' }, { type: 'break' }, { type: 'text', text: 'c' }]);
  });
});

describe('parseMarkdown', () => {
  it('reads headings, paragraphs, rules and quotes', () => {
    const blocks = parseMarkdown('# Title\n\nFirst line\nsecond line\n\n---\n\n> quoted\n> more');
    expect(blocks.map((block) => block.type)).toEqual(['heading', 'paragraph', 'rule', 'quote']);
  });

  it('reads nested lists', () => {
    const [list] = parseMarkdown('1. One\n2. Two\n   - nested a\n   - nested b\n3. Three');
    expect(list).toMatchObject({ type: 'list', ordered: true, start: 1 });
    if (list.type !== 'list') throw new Error('not a list');
    expect(list.items).toHaveLength(3);
    expect(list.items[1][1]).toMatchObject({ type: 'list', ordered: false });
  });

  it('keeps an unclosed fence open while streaming', () => {
    const [code] = parseMarkdown('```ts\nconst a = 1;');
    expect(code).toEqual({ type: 'code', lang: 'ts', text: 'const a = 1;', open: true });
    expect(parseMarkdown('```\nx\n```\nafter').map((block) => block.type)).toEqual(['code', 'paragraph']);
  });

  it('reads GFM tables', () => {
    const [table] = parseMarkdown('| Leave | Days |\n|:--|--:|\n| Annual | 24 |\n| Sick | 10 |');
    expect(table).toMatchObject({ type: 'table', align: ['left', 'right'] });
    if (table.type !== 'table') throw new Error('not a table');
    expect(table.rows).toHaveLength(2);
    expect(inlineText(table.rows[0][1])).toBe('24');
  });

  it('lets a list interrupt a paragraph only when it can', () => {
    expect(parseMarkdown('Steps:\n- one\n- two').map((block) => block.type)).toEqual(['paragraph', 'list']);
    expect(parseMarkdown('In\n2024. was a year').map((block) => block.type)).toEqual(['paragraph']);
  });
});
