import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './api/errors';

/**
 * Retry only what can get better on its own: network failures and 5xx, at most
 * twice (spec §11). 4xx answers are final, and auth 401s are the token manager's
 * business, not the query layer's.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (!isApiError(error)) return false;
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
