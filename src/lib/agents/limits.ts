/**
 * Deployment limits the API doesn't expose (Phase 4 spec §6, checked against the
 * backend's configuration). The server has the final word: a 422 still explains.
 */

/** AGENT_MAX_MESSAGE_LENGTH: one question or prompt preview, in UTF-16 units (default 16,000). */
export const AGENT_MAX_MESSAGE_LENGTH = 16_000;

/** Direct chat (P4-API-20/21): messages per request, and characters per message. */
export const DIRECT_CHAT_MAX_MESSAGES = 50;
export const DIRECT_CHAT_MAX_CONTENT = 32_000;

/** Conversation titles (P4-API-13/15). */
export const CONVERSATION_TITLE_MAX = 120;

/** LLM_REQUEST_TIMEOUT + 30 s: the longest the server holds a conversation's turn lock. */
export const TURN_LOCK_MAX_MS = 330_000;
