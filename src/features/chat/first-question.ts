import type { TurnOptions } from './use-turn';

/**
 * The first question of a conversation created from the draft screen, handed to
 * the thread in memory: never through the URL or history state, which can be
 * persisted (spec §9.2).
 */
interface FirstQuestion {
  content: string;
  options: TurnOptions;
}

const pending = new Map<string, FirstQuestion>();

export function handOffFirstQuestion(conversationId: string, question: FirstQuestion): void {
  pending.set(conversationId, question);
}

export function peekFirstQuestion(conversationId: string): FirstQuestion | undefined {
  return pending.get(conversationId);
}

export function takeFirstQuestion(conversationId: string): FirstQuestion | undefined {
  const question = pending.get(conversationId);
  pending.delete(conversationId);
  return question;
}
