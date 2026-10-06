import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './api/errors';

/**
 * 503s that name a missing setting or a detector the workspace refuses to work
 * without (Phase 3 §6.5, §6.9): they won't change in the next few seconds, and
 * retrying spends a rate-limited budget.
 */
const NOT_RETRYABLE: ReadonlySet<string> = new Set([
  'KNOWLEDGE_LAYER_NOT_CONFIGURED',
  'PII_DETECTION_UNAVAILABLE',
  // Phase 4: configuration, and the 500 the egress check answers with.
  'LLM_NOT_CONFIGURED',
  'PII_EGRESS_BLOCKED',
]);

/**
 * Retry only what can get better on its own: network failures and 5xx, at most
 * twice (spec §11). 4xx answers are final, and auth 401s are the token manager's
 * business, not the query layer's.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (!isApiError(error)) return false;
  if (NOT_RETRYABLE.has(error.code)) return false;
  return error.status === 0 || error.status >= 500;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: shouldRetry,
      retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: false,
    },
  },
});
