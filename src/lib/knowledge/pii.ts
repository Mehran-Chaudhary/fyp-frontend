import type { DetectedEntity } from '../api/types';

export type MaskedPart = { kind: 'text'; text: string } | { kind: 'entity'; placeholder: string; entity?: DetectedEntity };

/** Placeholders as the server writes them: [PERSON_1], [EMAIL_ADDRESS_2], [CUSTOM_1]. */
const PLACEHOLDER = /\[([A-Z][A-Z0-9_]*)_(\d+)\]/g;

/** Splits `maskedText` into plain text and placeholder chips (Phase 3 spec §5 "Privacy settings and previews"). */
export function splitPlaceholders(maskedText: string, entities: readonly DetectedEntity[]): MaskedPart[] {
  const byPlaceholder = new Map(entities.map((entity) => [entity.placeholder, entity]));
  const parts: MaskedPart[] = [];
  let last = 0;
  for (const match of maskedText.matchAll(PLACEHOLDER)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ kind: 'text', text: maskedText.slice(last, at) });
    parts.push({ kind: 'entity', placeholder: match[0], entity: byPlaceholder.get(match[0]) });
    last = at + match[0].length;
  }
  if (last < maskedText.length) parts.push({ kind: 'text', text: maskedText.slice(last) });
  return parts;
}

/** "[EMAIL_ADDRESS_2]" → { type: 'EMAIL_ADDRESS', index: 2 }. */
export function parsePlaceholder(placeholder: string): { type: string; index: number } | null {
  const match = /^\[([A-Z][A-Z0-9_]*)_(\d+)\]$/.exec(placeholder);
  return match ? { type: match[1], index: Number(match[2]) } : null;
}

/** The report has no totalPages: compute it (§5 "Privacy settings and previews"). */
export const reportPages = (totalChunks: number, limit: number): number => Math.max(1, Math.ceil(totalChunks / limit));

/** "EMAIL_ADDRESS" → "Email address", for types the entity catalogue doesn't label. */
export function humanizeEntityType(type: string): string {
  const words = type.toLowerCase().split('_').filter(Boolean);
  if (words.length === 0) return type;
  const acronyms = new Set(['iban', 'cnic', 'ssn', 'ip', 'url', 'nrp', 'uk', 'us', 'ntn', 'nhs']);
  return words
    .map((word, index) => (acronyms.has(word) ? word.toUpperCase() : index === 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/** How a detection was made, for the chip's tooltip. */
export const ENTITY_SOURCE_LABEL: Readonly<Record<DetectedEntity['source'], string>> = {
  pattern: 'Pattern',
  ner: 'Language model (NER)',
  custom: 'Custom term',
  propagation: 'Repeated elsewhere in the text',
};
