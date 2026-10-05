import type { ApiKey } from '../api/types';
import { apiKeyStatus, type ApiKeyStatus } from './status';

export { apiKeyStatus, type ApiKeyStatus };

export type ApiKeyStatusFilter = 'all' | ApiKeyStatus;

/**
 * Client-side filtering of the API-key list (P2-API-28). Allowed because that
 * list is complete (not paginated); the page says the filtering is local.
 * Status is derived in order: revoked, then expired, then active.
 */
export function filterApiKeys(
  keys: readonly ApiKey[],
  filters: { status?: ApiKeyStatusFilter; creatorId?: string | null; search?: string },
  now = Date.now(),
): ApiKey[] {
  const needle = filters.search?.trim().toLowerCase() ?? '';
  return keys.filter((key) => {
    if (filters.status && filters.status !== 'all' && apiKeyStatus(key, now) !== filters.status) return false;
    if (filters.creatorId && key.createdById !== filters.creatorId) return false;
    if (!needle) return true;
    return (
      key.name.toLowerCase().includes(needle) ||
      key.prefix.toLowerCase().includes(needle) ||
      (key.description ?? '').toLowerCase().includes(needle)
    );
  });
}

/**
 * `usageCount` is a 64-bit counter sent as a decimal string: group its digits as
 * text, never through Number (which loses precision above 2^53).
 */
export function formatUsageCount(value: string): string {
  return /^\d+$/.test(value) ? value.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',') : value;
}
