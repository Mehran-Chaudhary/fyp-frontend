import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { ragApi } from '@/lib/api/endpoints';
import { isApiError } from '@/lib/api/errors';
import type { RetrievalQuery } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { useWorkspace } from '@/features/workspaces/workspace-context';

/**
 * P3-API-22 as a mutation: never cached (spec §9.2). Passages are document text, so
 * they're dropped as soon as the screen that asked for them goes away, and a search
 * still running then is cancelled (spec §9.1: cancel on leaving the screen).
 */
export function useRetrieval() {
  const workspace = useWorkspace();
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const current = controller;
    return () => current.current?.abort();
  }, []);

  const mutation = useMutation({
    mutationFn: (body: RetrievalQuery) => {
      // A newer search replaces one still running.
      controller.current?.abort();
      const next = new AbortController();
      controller.current = next;
      return ragApi.query(workspace.id, body, next.signal);
    },
    gcTime: 0,
  });

  return {
    ...mutation,
    /** Stops a running search and forgets its result. */
    cancel: () => {
      controller.current?.abort();
      mutation.reset();
    },
  };
}

export interface RetrievalProblem {
  message: string;
  /** A 422 about the question itself. */
  queryError?: string;
  /** Bases that are gone or hidden now: drop them from the selection. */
  goneKnowledgeBaseIds?: string[];
  /** 429: when searching may resume, epoch ms. */
  retryAt?: number;
  /** A dependency is down (AI service, vector store) or not configured: temporary, retry by hand. */
  unavailable?: boolean;
  /** Retrying the same search later can work (503, 408, a lost connection). */
  retryable?: boolean;
}

/** What a failed retrieval means, in words (spec §8 P3-API-22, §10). Never retried automatically. */
export function describeRetrievalError(error: unknown): RetrievalProblem {
  if (!isApiError(error)) return { message: messageFor(error), retryable: true };
  const details = error.details ?? {};
  switch (error.code) {
    case 'KNOWLEDGE_BASE_NOT_FOUND': {
      const ids = Array.isArray(details.knowledgeBaseIds)
        ? details.knowledgeBaseIds.filter((id): id is string => typeof id === 'string')
        : [];
      return {
        message:
          ids.length > 1
            ? `${ids.length} knowledge bases don't exist or you no longer have access to them. They were removed from the selection.`
            : "A knowledge base you picked doesn't exist or you no longer have access to it. It was removed from the selection.",
        goneKnowledgeBaseIds: ids,
      };
    }
    case 'VALIDATION_FAILED': {
      const fields = error.fieldErrors({ fields: ['query', 'topK', 'minScore', 'knowledgeBaseIds', 'documentIds', 'mode', 'rerank'] });
      const queryError = fields.query ? `The question ${fields.query.replace(/^query\s+/i, '')}` : undefined;
      return { message: queryError ?? (Object.values(fields).join(' ') || error.message), queryError };
    }
    case 'RATE_LIMIT_EXCEEDED':
      return {
        message: "You've reached this deployment's search limit for the minute.",
        retryAt: error.retryDeadline(60),
      };
    case 'KNOWLEDGE_LAYER_NOT_CONFIGURED':
      return { message: "Search isn't set up on this deployment yet.", unavailable: true };
    case 'AI_SERVICE_UNAVAILABLE':
      return {
        message: "The AI service that turns your question into a search vector isn't answering. It's usually temporary.",
        unavailable: true,
        retryable: true,
      };
    case 'VECTOR_STORE_UNAVAILABLE':
      return { message: "The vector store isn't answering. It's usually temporary.", unavailable: true, retryable: true };
    case 'REQUEST_TIMEOUT':
    case 'NETWORK_TIMEOUT':
      return { message: 'The search took longer than the server allows (60 seconds).', retryable: true };
    case 'NETWORK_ERROR':
      return { message: messageFor(error), retryable: true };
    default:
      return { message: messageFor(error), retryable: error.status >= 500 };
  }
}
