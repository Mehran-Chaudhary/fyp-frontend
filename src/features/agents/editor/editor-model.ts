import { BookOpenText, Brain, Cpu, Fingerprint, MessageSquareQuote, ScrollText, ShieldCheck, Users, Wrench } from 'lucide-react';
import type { AgentFormErrors, AgentFormField } from '@/lib/agents/agent-form';

/** The editor's sections in the spec's order (§5.2), with the form fields each one owns. */
export const EDITOR_SECTIONS = [
  { id: 'identity', label: 'Identity', icon: Fingerprint, fields: ['name', 'description'] },
  { id: 'persona', label: 'Persona', icon: MessageSquareQuote, fields: ['role', 'tone', 'language', 'greeting'] },
  { id: 'instructions', label: 'Instructions', icon: ScrollText, fields: ['instructions'] },
  {
    id: 'knowledge',
    label: 'Knowledge',
    icon: BookOpenText,
    fields: ['retrievalEnabled', 'knowledgeBaseIds', 'retrievalTopK', 'retrievalMode', 'rerank', 'maxContextTokens', 'minScore', 'maxClassification'],
  },
  {
    id: 'model',
    label: 'Model',
    icon: Cpu,
    fields: ['model', 'temperature', 'maxOutputTokens', 'topP', 'topK', 'repeatPenalty', 'seed', 'stop', 'contextWindow'],
  },
  { id: 'memory', label: 'Memory', icon: Brain, fields: ['maxMessages', 'maxHistoryTokens'] },
  { id: 'answers', label: 'Answers', icon: ShieldCheck, fields: ['grounding', 'citations'] },
  { id: 'access', label: 'Access', icon: Users, fields: ['accessMode', 'allowedRoleIds'] },
  { id: 'tools', label: 'Tools', icon: Wrench, fields: [] },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: unknown; fields: readonly AgentFormField[] }>;

export type EditorSectionId = (typeof EDITOR_SECTIONS)[number]['id'];

/** The first section holding an error, to scroll to after a failed save. */
export function firstSectionWithError(errors: AgentFormErrors): EditorSectionId | null {
  const keys = Object.keys(errors) as AgentFormField[];
  const section = EDITOR_SECTIONS.find((item) => (item.fields as readonly AgentFormField[]).some((field) => keys.includes(field)));
  return section?.id ?? null;
}
