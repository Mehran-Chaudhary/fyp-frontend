import type { Citation, Conversation, Message, MessagePage, WithheldReason } from '../api/types';

// ── Notices (§4.7, §5.6) ────────────────────────────────────────────────────

export interface MessageNotice {
  tone: 'info' | 'warning' | 'danger';
  text: string;
}

const WITHHELD_TEXT: Readonly<Record<WithheldReason, MessageNotice>> = {
  CLEARANCE: { tone: 'info', text: 'Hidden: this message drew on material above your clearance.' },
  COMPARTMENT: { tone: 'info', text: 'Hidden: this message drew on a knowledge base you cannot access.' },
  SOURCE_DELETED: { tone: 'info', text: 'Withdrawn: a document this message relied on has been deleted.' },
  REDACTION_UNAVAILABLE: { tone: 'warning', text: 'Hidden: personal data cannot be masked right now. Try again later.' },
};

/** The banner for a message, or null when it is an ordinary complete message. Never an error toast. */
export function messageNotice(
  message: Pick<Message, 'contentState' | 'withheldReason' | 'status' | 'errorCode' | 'content'>,
): MessageNotice | null {
  if (message.contentState === 'WITHHELD') {
    return (message.withheldReason && WITHHELD_TEXT[message.withheldReason]) ?? { tone: 'info', text: 'Hidden from you.' };
  }
  if (message.status === 'CANCELLED') {
    return { tone: 'warning', text: message.content ? 'Stopped: partial answer.' : 'Stopped before any text was written.' };
  }
  if (message.status === 'FAILED') {
    return { tone: 'danger', text: message.content ? 'The answer failed part-way.' : 'The answer failed.' };
  }
  if (message.contentState === 'MASKED') {
    return { tone: 'info', text: 'Personal data is masked in this view.' };
  }
  return null;
}

/** A longer explanation of a withheld reason, for the notice's tooltip. */
export const WITHHELD_DETAIL: Readonly<Record<WithheldReason, string>> = {
  CLEARANCE:
    'Every read re-checks a message against your access today. This one quoted documents classified above your clearance.',
  COMPARTMENT:
    "This one quoted a knowledge base you can't read. It stays hidden for you while that's true, and it's left out of the agent's memory.",
  SOURCE_DELETED:
    'A document it relied on was deleted, which withdraws the message for everyone, its owner included. It no longer counts as memory.',
  REDACTION_UNAVAILABLE:
    "Masking isn't available for text that wasn't analysed in the last hour, so the content is hidden rather than shown unmasked.",
};

// ── Citations (§5.6) ────────────────────────────────────────────────────────

export type AnswerSegment = { type: 'text'; text: string } | { type: 'citation'; tag: string; citation: Citation | null };

/**
 * Splits an answer into text and [S1]-style markers linked to the message's
 * citations. A tag with no matching citation stays a plain marker (null citation).
 */
export function splitCitations(content: string, citations: readonly Citation[]): AnswerSegment[] {
  const byTag = new Map(citations.map((citation) => [citation.tag, citation]));
  const segments: AnswerSegment[] = [];
  let last = 0;
  for (const match of content.matchAll(/\[(S\d{1,3})\]/g)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ type: 'text', text: content.slice(last, index) });
    segments.push({ type: 'citation', tag: match[1], citation: byTag.get(match[1]) ?? null });
    last = index + match[0].length;
  }
  if (last < content.length) segments.push({ type: 'text', text: content.slice(last) });
  return segments;
}

/** Sources the answer cites first (in rank order), then the rest it was given ("Also consulted"). */
export function partitionCitations(citations: readonly Citation[]): { cited: Citation[]; consulted: Citation[] } {
  const sorted = [...citations].sort((a, b) => a.rank - b.rank);
  return { cited: sorted.filter((citation) => citation.cited), consulted: sorted.filter((citation) => !citation.cited) };
}

// ── History pages (§5.6 "History", P4-API-17) ───────────────────────────────

/**
 * Infinite-query pages (newest page first, each chronological) as one chronological
 * list, without duplicates: a page refetched while a turn was saved can repeat rows.
 */
export function flattenPages(pages: readonly MessagePage[]): Message[] {
  const seen = new Set<string>();
  const out: Message[] = [];
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    for (const message of pages[index].messages) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      out.push(message);
    }
  }
  return out.sort((a, b) => a.sequence - b.sequence);
}

/** Puts freshly stored messages into the newest page, replacing older copies by id. */
export function withMessages(page: MessagePage, messages: readonly Message[]): MessagePage {
  const incoming = new Map(messages.map((message) => [message.id, message]));
  const kept = page.messages.filter((message) => !incoming.has(message.id));
  return { ...page, messages: [...kept, ...messages].sort((a, b) => a.sequence - b.sequence) };
}

/** The highest sequence known, or 0 for an empty conversation. */
export const lastSequence = (messages: readonly Pick<Message, 'sequence'>[]): number =>
  messages.reduce((max, message) => Math.max(max, message.sequence), 0);

// ── Conversations ───────────────────────────────────────────────────────────

/** "New conversation" until the server derives a title from the first question. */
export function conversationTitle(conversation: Pick<Conversation, 'title' | 'isOwner'>): string {
  if (conversation.title) return conversation.title;
  return conversation.isOwner ? 'New conversation' : 'Untitled (title could not be masked)';
}

// ── Polite announcements (§5 "Announce streaming politely") ─────────────────

/**
 * The part of `text` after `from` that ends on a sentence boundary, for an
 * aria-live region that speaks whole sentences instead of every token.
 */
export function completedSentences(text: string, from: number): { spoken: string; next: number } {
  const rest = text.slice(from);
  let end = -1;
  const pattern = /[.!?…](?=\s)|\n/g;
  for (const match of rest.matchAll(pattern)) end = (match.index ?? 0) + match[0].length;
  if (end < 0) return { spoken: '', next: from };
  return { spoken: rest.slice(0, end).trim(), next: from + end };
}

/** The last finished sentence of a streaming answer: what a polite live region reads next. */
export function latestSentence(text: string): string {
  const { spoken } = completedSentences(text, 0);
  if (!spoken) return '';
  const pieces = spoken.split(/(?<=[.!?…])\s+|\n+/).filter((piece) => piece.trim());
  return pieces[pieces.length - 1]?.trim() ?? '';
}
