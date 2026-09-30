import { useMutation } from '@tanstack/react-query';
import { ragApi } from '@/lib/api/endpoints';
import { isApiError } from '@/lib/api/errors';
import type { RetrievalQuery } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { useWorkspace } from '@/features/workspaces/workspace-context';

/**
 * E76 as a mutation: never cached (§10.1). Passages are document text, so they're
 * dropped from memory as soon as the screen that asked for them goes away.
 */
export function useRetrieval() {
  const workspace = useWorkspace();
  return useMutation({
    mutationFn: (body: RetrievalQuery) => ragApi.query(workspace.id, body),
    gcTime: 0,
  });
}

export interface RetrievalProblem {
  message: string;
  /** A 422 about the question itself. */
  queryError?: string;
  /** Bases that are gone or hidden now: drop them from the selection (§6.8). */
  goneKnowledgeBaseIds?: string[];
  /** 429: when searching may resume, epoch ms. */
  retryAt?: number;
  /** The knowledge layer isn't configured, or a service is down. */
  unavailable?: boolean;
}

/** What a failed retrieval means, in words (§6.8, §6.9). */
export function describeRetrievalError(error: unknown): RetrievalProblem {
  if (!isApiError(error)) return { message: messageFor(error) };
  const details = error.details ?? {};
  switch (error.code) {
    case 'KNOWLEDGE_BASE_NOT_FOUND': {
      const ids = Array.isArray(details.knowledgeBaseIds)
        ? details.knowledgeBaseIds.filter((id): id is string => typeof id === 'string')
        : [];
      return {
        message:
          ids.length > 1
            ? `${ids.length} knowledge bases are no longer available. They were removed from the selection.`
            : 'One knowledge base is no longer available. It was removed from the selection.',
        goneKnowledgeBaseIds: ids,
      };
    }
    case 'VALIDATION_FAILED': {
      const fields = error.fieldErrors({ fields: ['query', 'topK', 'minScore', 'knowledgeBaseIds', 'mode'] });
      const queryError = fields.query ? `The question ${fields.query.replace(/^query\s+/i, '')}` : undefined;
      return { message: queryError ?? (Object.values(fields).join(' ') || error.message), queryError };
    }
    case 'RATE_LIMIT_EXCEEDED':
      return {
        message: `You've run 60 searches in a minute.`,
        retryAt: error.retryDeadline(60),
      };
    case 'KNOWLEDGE_LAYER_NOT_CONFIGURED':
    case 'AI_SERVICE_UNAVAILABLE':
    case 'VECTOR_STORE_UNAVAILABLE':
      return { message: messageFor(error), unavailable: true };
    default:
      return { message: messageFor(error) };
  }
}
