import type { AccessLevel, Classification } from '@/lib/api/types';
import { hashString } from '@/lib/utils';

/** How each classification looks and what it means (§3.3). */
export const CLASSIFICATION_META: Readonly<
  Record<Classification, { label: string; description: string; className: string; pip: string }>
> = {
  PUBLIC: {
    label: 'Public',
    description: 'Readable by everyone who can see the knowledge base.',
    className: 'border-line-strong bg-well/80 text-ink-soft',
    pip: 'bg-ink-soft/70',
  },
  INTERNAL: {
    label: 'Internal',
    description: 'Needs internal clearance.',
    className: 'border-info-200 bg-info-50 text-info-700',
    pip: 'bg-info-500',
  },
  CONFIDENTIAL: {
    label: 'Confidential',
    description: 'Needs confidential clearance.',
    className: 'border-warning-200 bg-warning-50 text-warning-700',
    pip: 'bg-warning-500',
  },
  RESTRICTED: {
    label: 'Restricted',
    description: 'Needs restricted clearance. API keys can never read it.',
    className: 'border-danger-200 bg-danger-50 text-danger-700',
    pip: 'bg-danger-500',
  },
};

export const classificationLabel = (classification: Classification): string => CLASSIFICATION_META[classification].label;

/** What each access level allows on a knowledge base (§3.2). Role permissions still apply. */
export const ACCESS_LEVEL_META: Readonly<Record<AccessLevel, { label: string; description: string }>> = {
  READ: {
    label: 'Read',
    description: 'See the knowledge base and its documents, read chunks, download, search and open PII reports.',
  },
  WRITE: {
    label: 'Write',
    description: 'Also upload, edit, reclassify, reindex and delete documents.',
  },
  MANAGE: {
    label: 'Manage',
    description: 'Also edit the knowledge base, manage who can access it, and delete it.',
  },
};

/** Muted, distinguishable colours that sit well on the paper background. */
const KB_COLORS = ['#36846a', '#b07a2a', '#3e6bb0', '#7a5aa6', '#b5543f', '#5f7a2e', '#2f7f80', '#a8577e'] as const;

/** A stable colour for a knowledge base, the same everywhere it appears. */
export function knowledgeBaseColor(id: string): string {
  return KB_COLORS[hashString(id) % KB_COLORS.length];
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'do', 'does', 'for', 'from', 'how', 'i', 'in', 'is', 'it', 'its',
  'of', 'on', 'or', 'our', 'the', 'this', 'that', 'to', 'was', 'what', 'when', 'where', 'which', 'who', 'why', 'with',
  'we', 'you', 'your', 'can', 'my', 'me', 'am', 'will',
]);

/** The words of a query worth highlighting: no stop words, no one-letter words. Longest first. */
export function queryTerms(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
  return Array.from(new Set(words)).sort((a, b) => b.length - a.length);
}
