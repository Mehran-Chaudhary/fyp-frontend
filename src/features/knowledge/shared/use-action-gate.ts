import type { KnowledgeBase } from '@/lib/api/types';
import { KNOWLEDGE_RULES, type KnowledgeAction } from '@/lib/knowledge/access';
import { ACCESS_LEVEL_META } from './meta';
import { useKnowledgeAccess, useLayerGap } from './use-knowledge-access';

export interface ActionGate {
  /** False when the role lacks the permission altogether: hide the control. */
  visible: boolean;
  /** Why it can't be used here (a low level, a missing service), or null when it can. */
  reason: string | null;
}

/**
 * §3.7: hide what the user can never do in this workspace; disable, with a reason,
 * what they could do elsewhere but not here (their level on this base is too low,
 * or the server can't do it yet).
 */
export function useActionGate(): (action: KnowledgeAction, knowledgeBase: KnowledgeBase | undefined) => ActionGate {
  const access = useKnowledgeAccess();
  const layer = useLayerGap();
  return (action, knowledgeBase) => {
    if (access.lacks(action)) return { visible: false, reason: null };
    if (!knowledgeBase) return { visible: true, reason: 'Checking your access…' };
    if (!access.can(action, knowledgeBase)) {
      return {
        visible: true,
        reason:
          knowledgeBase.access === 'READ'
            ? `You have read-only access to ${knowledgeBase.name}`
            : `You need ${ACCESS_LEVEL_META[KNOWLEDGE_RULES[action].level].label} access to ${knowledgeBase.name}`,
      };
    }
    if (action === 'download' && layer.blocked('download')) return { visible: true, reason: "Downloads aren't set up on this server yet" };
    if (action === 'reindex' && layer.blocked('reindex')) return { visible: true, reason: "Reindexing isn't set up on this server yet" };
    if (action === 'upload' && layer.blocked('upload')) return { visible: true, reason: "Uploads aren't set up on this server yet" };
    if (action === 'search' && layer.blocked('search')) return { visible: true, reason: "Search isn't set up on this server yet" };
    return { visible: true, reason: null };
  };
}
