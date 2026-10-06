import type { AgentSummary } from '../api/types';
import { createCan } from '../permissions/can';

/**
 * Everything Phase 4 lets this member do in the workspace (spec §3.1, §3.7),
 * computed once from the contextual permission list and used by every screen.
 * Derived from permissions, never from role names: roles are editable.
 */
export function agentCapabilities(permissions: readonly string[]) {
  const has = createCan(permissions);
  return {
    browseAgents: has('agent:read'),
    createAgents: has('agent:create'),
    /** Edit, restore versions, and see every agent, drafts included. */
    manageAgents: has('agent:update'),
    deleteAgents: has('agent:delete'),
    publishAgents: has('agent:publish'),
    /** Start conversations, send messages, preview prompts. */
    chat: has('agent:execute'),
    readOwnConversations: has('conversation:read'),
    superviseConversations: has('conversation:read') && has('conversation:read_all'),
    deleteConversations: has('conversation:delete'),
    revealPersonalData: has('pii:reveal'),
    directChat: has('llm:invoke'),
    readModels: has.any('llm:invoke', 'llm:manage', 'agent:read'),
    manageModelPolicy: has('llm:manage'),
    readUsage: has('usage:read'),
    /** Granting tools needs it; the tool catalogue itself is Phase 5. */
    grantTools: has('tool:read'),
    /** Secondary reads that only enrich a screen (§2 "Shared dependencies"). */
    readKnowledgeBases: has('knowledgebase:read'),
    readRoles: has('role:read'),
    readMembers: has('member:read'),
    readDocuments: has('document:read'),
  };
}

export type AgentCapabilities = ReturnType<typeof agentCapabilities>;

/**
 * What a member may do with one agent they can see. Whether they can see it is the
 * server's decision (a hidden agent is 404); this only gates controls. A creator
 * without agent:update can't edit or publish their own draft (P4-G04).
 */
export function agentActions(agent: Pick<AgentSummary, 'visibility'>, can: AgentCapabilities) {
  return {
    edit: can.manageAgents,
    restore: can.manageAgents,
    delete: can.deleteAgents,
    publish: can.publishAgents && agent.visibility === 'PRIVATE',
    unpublish: can.publishAgents && agent.visibility === 'WORKSPACE',
    chat: can.chat,
    preview: can.chat,
  };
}

export type AgentActions = ReturnType<typeof agentActions>;
