/**
 * A small, safe Markdown reader for model output, instructions and greetings
 * (Phase 4 spec §5 "Never render model output … as raw HTML").
 *
 * It produces a tree that React renders as elements: there is no HTML pass-through
 * at all, links are limited to http(s) and mailto, and `[S1]` citation markers and
 * `[PERSON_1]` placeholders come out as their own tokens. It is forgiving on
 * purpose: text that is still streaming (an unclosed fence, a half-written
 * `**bold`) renders sensibly and settles once the rest arrives.
 *
 * Supported: paragraphs with line breaks, ATX headings, fenced code, block quotes,
 * ordered/unordered (nested) lists, task-free GFM tables, horizontal rules; inline
 * code, strong, emphasis, strikethrough, links, bare URLs and backslash escapes.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'del'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'citation'; tag: string }
  | { type: 'placeholder'; text: string }
  | { type: 'break' };

export type Align = 'left' | 'center' | 'right' | null;

export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'heading'; level: number; children: Inline[] }
  | { type: 'code'; lang: string | null; text: string; open: boolean }
  | { type: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { type: 'quote'; children: Block[] }
  | { type: 'rule' }
  | { type: 'table'; align: Align[]; header: Inline[][]; rows: Inline[][][] };

const MAX_DEPTH = 8;

// ── Blocks ──────────────────────────────────────────────────────────────────

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const TABLE_DELIMITER = /^ *\|? *:?-{1,}:? *(\| *:?-{1,}:? *)*\|? *$/;

export function parseMarkdown(source: string): Block[] {
  return parseBlocks(source.replace(/\r\n?/g, '\n').split('\n'), 0);
}

const isBlank = (line: string) => line.trim() === '';

function startsBlock(line: string, next: string | undefined): boolean {
  if (FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line)) return true;
  const item = LIST_ITEM.exec(line);
  // Like CommonMark: an ordered list interrupts a paragraph only when it starts at 1.
  if (item && item[3] !== undefined && (!/^\d/.test(item[2]) || /^1[.)]$/.test(item[2]))) return true;
  return isTableStart(line, next);
}

function isTableStart(line: string, next: string | undefined): boolean {
  return line.includes('|') && next !== undefined && next.includes('-') && TABLE_DELIMITER.test(next);
}

function parseBlocks(lines: string[], depth: number): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      let j = i + 1;
      let open = true;
      for (; j < lines.length; j += 1) {
        const close = lines[j].trim();
        if (close.startsWith(marker[0].repeat(marker.length)) && /^(`+|~+)$/.test(close) && close[0] === marker[0]) {
          open = false;
          break;
        }
        body.push(lines[j]);
      }
      blocks.push({ type: 'code', lang: fence[2] || null, text: body.join('\n'), open });
      i = open ? j : j + 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, children: parseInline(heading[2] ?? '') });
      i += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && !isBlank(lines[i])) {
        const match = QUOTE.exec(lines[i]);
        inner.push(match ? match[1] : lines[i]);
        i += 1;
      }
      blocks.push({ type: 'quote', children: depth < MAX_DEPTH ? parseBlocks(inner, depth + 1) : [paragraph(inner)] });
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      const parsed = parseList(lines, i, depth);
      blocks.push(parsed.block);
      i = parsed.next;
      continue;
    }

    if (isTableStart(line, lines[i + 1])) {
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]).map(alignOf);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
        const cells = splitRow(lines[i]);
        rows.push(header.map((_, index) => parseInline(cells[index] ?? '')));
        i += 1;
      }
      blocks.push({ type: 'table', align: header.map((_, index) => align[index] ?? null), header: header.map((cell) => parseInline(cell)), rows });
      continue;
    }

    const text: string[] = [line];
    i += 1;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i], lines[i + 1])) {
      text.push(lines[i]);
      i += 1;
    }
    blocks.push(paragraph(text));
  }
  return blocks;
}

const paragraph = (lines: string[]): Block => ({ type: 'paragraph', children: parseInline(lines.map((l) => l.trim()).join('\n')) });

function parseList(lines: string[], from: number, depth: number): { block: Block; next: number } {
  const first = LIST_ITEM.exec(lines[from])!;
  const ordered = /^\d/.test(first[2]);
  const indent = first[1].length;
  const start = ordered ? Number.parseInt(first[2], 10) : 1;
  const items: Block[][] = [];
  let i = from;

  while (i < lines.length) {
    const match = LIST_ITEM.exec(lines[i]);
    if (!match || match[1].length < indent || match[1].length > indent + 3 || /^\d/.test(match[2]) !== ordered) break;
    const contentIndent = match[1].length + match[2].length + 1;
    const body: string[] = [match[3] ?? ''];
    i += 1;
    while (i < lines.length) {
      const current = lines[i];
      if (isBlank(current)) {
        // A blank line continues the item only when indented content follows.
        const next = lines[i + 1];
        if (next !== undefined && !isBlank(next) && leadingSpaces(next) >= contentIndent) {
          body.push('');
          i += 1;
          continue;
        }
        break;
      }
      // A marker at (about) this item's own indent is the next item or an outer one;
      // anything indented further belongs to this item (a nested list, more text).
      const sibling = LIST_ITEM.exec(current);
      if (sibling && sibling[1].length <= indent + 1) break;
      const lead = leadingSpaces(current);
      if (lead > indent) {
        body.push(current.slice(Math.min(lead, contentIndent)));
      } else if (!startsBlock(current, lines[i + 1])) {
        body.push(current.trim()); // lazy continuation of the item's paragraph
      } else {
        break;
      }
      i += 1;
    }
    items.push(depth < MAX_DEPTH ? parseBlocks(body, depth + 1) : [paragraph(body)]);
    // A blank line between items keeps the list going.
    if (i < lines.length && isBlank(lines[i])) {
      let j = i;
      while (j < lines.length && isBlank(lines[j])) j += 1;
      const next = j < lines.length ? LIST_ITEM.exec(lines[j]) : null;
      if (next && next[1].length >= indent && next[1].length <= indent + 3 && /^\d/.test(next[2]) === ordered) i = j;
      else break;
    }
  }
  return { block: { type: 'list', ordered, start, items }, next: i };
}

const leadingSpaces = (line: string): number => line.length - line.replace(/^ +/, '').length;

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  for (let k = 0; k < row.length; k += 1) {
    if (row[k] === '\\' && row[k + 1] === '|') {
      current += '|';
      k += 1;
    } else if (row[k] === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += row[k];
    }
  }
  cells.push(current.trim());
  return cells;
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
}

// ── Inlines ─────────────────────────────────────────────────────────────────

const CITATION = /^\[(S\d{1,3})\]/;
const PLACEHOLDER = /^\[[A-Z][A-Z0-9_]*_\d+\]/;
const BARE_URL = /^https?:\/\/[^\s<>"'`]+/;
const ESCAPABLE = new Set('\\`*_{}[]()#+-.!|~>'.split(''));

/** Only these leave the page; anything else (javascript:, data:) stays text. */
export function safeHref(raw: string): string | null {
  const href = raw.trim().replace(/^<|>$/g, '');
  if (/^mailto:[^\s]+$/i.test(href)) return href;
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseInline(source: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) out.push({ type: 'text', text: buffer });
    buffer = '';
  };
  let i = 0;

  while (i < source.length) {
    const char = source[i];
    const rest = source.slice(i);

    if (char === '\\' && i + 1 < source.length && ESCAPABLE.has(source[i + 1])) {
      buffer += source[i + 1];
      i += 2;
      continue;
    }

    if (char === '\n') {
      flush();
      out.push({ type: 'break' });
      i += 1;
      continue;
    }

    if (char === '`') {
      const run = /^`+/.exec(rest)![0];
      const close = source.indexOf(run, i + run.length);
      if (close > 0) {
        flush();
        out.push({ type: 'code', text: source.slice(i + run.length, close).replace(/^ (.+) $/, '$1') });
        i = close + run.length;
        continue;
      }
      buffer += run;
      i += run.length;
      continue;
    }

    if (char === '[') {
      const citation = CITATION.exec(rest);
      if (citation) {
        flush();
        out.push({ type: 'citation', tag: citation[1] });
        i += citation[0].length;
        continue;
      }
      const placeholder = PLACEHOLDER.exec(rest);
      if (placeholder) {
        flush();
        out.push({ type: 'placeholder', text: placeholder[0] });
        i += placeholder[0].length;
        continue;
      }
      const link = readLink(source, i);
      if (link) {
        const href = safeHref(link.href);
        flush();
        const children = depth < MAX_DEPTH ? parseInline(link.label, depth + 1) : [{ type: 'text' as const, text: link.label }];
        if (href) out.push({ type: 'link', href, children });
        else out.push(...children);
        i = link.end;
        continue;
      }
    }

    if ((char === 'h' || char === 'H') && (i === 0 || /[\s(]/.test(source[i - 1]))) {
      const url = BARE_URL.exec(rest);
      if (url) {
        const trimmed = url[0].replace(/[.,;:!?)\]'"]+$/, '');
        const href = safeHref(trimmed);
        if (href) {
          flush();
          out.push({ type: 'link', href, children: [{ type: 'text', text: trimmed }] });
          i += trimmed.length;
          continue;
        }
      }
    }

    if (char === '*' || char === '_' || char === '~') {
      const emphasis = readEmphasis(source, i, depth);
      if (emphasis) {
        flush();
        out.push(emphasis.node);
        i = emphasis.end;
        continue;
      }
    }

    buffer += char;
    i += 1;
  }
  flush();
  return out;
}

function readLink(source: string, from: number): { label: string; href: string; end: number } | null {
  let level = 0;
  let k = from;
  for (; k < source.length; k += 1) {
    if (source[k] === '\\') {
      k += 1;
      continue;
    }
    if (source[k] === '[') level += 1;
    else if (source[k] === ']') {
      level -= 1;
      if (level === 0) break;
    } else if (source[k] === '\n' && source[k + 1] === '\n') return null;
  }
  if (level !== 0 || source[k + 1] !== '(') return null;
  const close = source.indexOf(')', k + 2);
  if (close < 0) return null;
  const href = source.slice(k + 2, close).trim().split(/\s+/)[0] ?? '';
  if (!href) return null;
  return { label: source.slice(from + 1, k), href, end: close + 1 };
}

function readEmphasis(source: string, from: number, depth: number): { node: Inline; end: number } | null {
  const char = source[from];
  const double = source[from + 1] === char;
  if (char === '~' && !double) return null;
  const marker = double ? char + char : char;
  const after = source[from + marker.length];
  // An opening delimiter must touch text.
  if (after === undefined || /\s/.test(after) || after === char) return null;
  // `_` inside a word (snake_case) is never emphasis.
  if (char === '_' && from > 0 && /[\p{L}\p{N}]/u.test(source[from - 1])) return null;

  let search = from + marker.length;
  for (;;) {
    const close = source.indexOf(marker, search);
    if (close < 0) return null;
    const before = source[close - 1];
    const following = source[close + marker.length];
    const touchesText = before !== undefined && !/\s/.test(before);
    const intraword = char === '_' && following !== undefined && /[\p{L}\p{N}]/u.test(following);
    // `**a*` must not close `*a**`: skip a single marker that is part of a longer run.
    const longer = !double && following === char;
    if (touchesText && !intraword && !longer && close > from + marker.length) {
      const inner = source.slice(from + marker.length, close);
      if (inner.includes('\n\n')) return null;
      const children = depth < MAX_DEPTH ? parseInline(inner, depth + 1) : [{ type: 'text' as const, text: inner }];
      const type = char === '~' ? 'del' : double ? 'strong' : 'em';
      return { node: { type, children }, end: close + marker.length };
    }
    search = close + 1;
  }
}

/** The plain text of inline nodes (headings' accessible names, table captions). */
export function inlineText(nodes: readonly Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'code':
          return node.text;
        case 'placeholder':
          return node.text;
        case 'citation':
          return `[${node.tag}]`;
        case 'break':
          return '\n';
        default:
          return inlineText(node.children);
      }
    })
    .join('');
}

/** Markdown as one line of plain text, for previews (cards, pickers). */
export function plainText(source: string, max = 200): string {
  const flat = parseMarkdown(source)
    .map((block) => blockText(block))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function blockText(block: Block): string {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      return inlineText(block.children);
    case 'code':
      return block.text;
    case 'list':
      return block.items.map((item) => item.map(blockText).join(' ')).join(' ');
    case 'quote':
      return block.children.map(blockText).join(' ');
    case 'table':
      return [block.header, ...block.rows].map((row) => row.map(inlineText).join(' ')).join(' ');
    case 'rule':
      return '';
  }
}
