/**
 * Carries a question from the vault's "Ask" box to the Search page. Questions can
 * be sensitive ("What is the CEO salary?"), so they never go into the URL, history
 * state or storage (§9.2): only this module's memory, until the page reads it.
 */
export interface HandedOffQuery {
  workspaceId: string;
  query: string;
  knowledgeBaseIds: string[];
}

let pending: HandedOffQuery | null = null;

export function handOffQuery(value: HandedOffQuery): void {
  pending = value;
}

/** Reads the handed-off question for a workspace without consuming it (safe in render). */
export function peekHandedOffQuery(workspaceId: string): HandedOffQuery | null {
  return pending && pending.workspaceId === workspaceId ? pending : null;
}

export function clearHandedOffQuery(): void {
  pending = null;
}
