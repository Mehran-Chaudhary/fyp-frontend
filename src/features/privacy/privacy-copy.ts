import type { PiiDetector, PiiEntityType } from '@/lib/api/types';

/** How each detector finds personal data (spec §4.8). */
export const DETECTOR_GROUPS: Readonly<Record<PiiDetector, { title: string; description: string }>> = {
  pattern: {
    title: 'Patterns',
    description: 'Found by validated pattern recognizers inside AgentVault. Always available.',
  },
  ner: {
    title: 'Names, places and organisations',
    description: "Found by the language model (NER) in the AI service. Unavailable while it isn't configured or is down.",
  },
  custom: {
    title: 'Private terms',
    description: 'Your deny list, masked as Custom. Switched on automatically while the deny list has terms.',
  },
};

export const DETECTOR_ORDER: readonly PiiDetector[] = ['pattern', 'ner', 'custom'];

/** Ready-made texts for the preview: invented people and numbers, nothing real. */
export const SAMPLE_TEXTS: ReadonlyArray<{ key: string; label: string; text: string }> = [
  {
    key: 'hr',
    label: 'HR record',
    text: 'Ayesha Raza (ayesha.raza@acme.test, +92 300 1234567) earns PKR 950,000 per year.',
  },
  {
    key: 'support',
    label: 'Support ticket',
    text:
      'Ticket 4471: Daniel Okafor called from 203.0.113.42 about a refund to card 4111 1111 1111 1111. ' +
      'He asked us to email daniel.okafor@example.org or call +44 20 7946 0958. His CNIC on file is 35202-1234567-1.',
  },
  {
    key: 'finance',
    label: 'Finance note',
    text:
      'Transfer EUR 12,500 from IBAN GB82 WEST 1234 5698 7654 32 to the Lahore office on Friday. ' +
      'Approved by Sara Malik; the vendor API key is sk_live_51HxExampleOnly0000.',
  },
];

/**
 * A sample built from the catalogue's own examples of the types this policy masks,
 * so every enabled type has something to find.
 */
export function sampleFromCatalogue(types: readonly PiiEntityType[]): string {
  const examples = types
    .filter((type) => type.enabled && type.example && type.detector !== 'custom')
    .map((type) => `${type.label}: ${type.example}.`);
  return examples.join(' ');
}

/** Where a detection came from, in words. */
export const SOURCE_LABEL: Readonly<Record<string, string>> = {
  pattern: 'Pattern',
  ner: 'Language model',
  custom: 'Deny list',
  propagation: 'Repeat of an earlier match',
};
