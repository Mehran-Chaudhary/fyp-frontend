import { describe, expect, it } from 'vitest';
import type { ApiKey } from '../api/types';
import { filterApiKeys, formatUsageCount } from './api-keys';

const NOW = Date.parse('2026-10-05T12:00:00.000Z');

function key(overrides: Partial<ApiKey>): ApiKey {
  return {
    id: overrides.id ?? 'k',
    name: 'Ingestion worker',
    description: null,
    prefix: 'av_live_ab12',
    scopes: ['document:read'],
    createdById: 'user-1',
    expiresAt: '2027-01-01T00:00:00.000Z',
    revokedAt: null,
    lastUsedAt: null,
    lastUsedIp: null,
    usageCount: '0',
    allowedIps: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

const KEYS = [
  key({ id: 'active' }),
  key({ id: 'expired', expiresAt: '2026-10-01T00:00:00.000Z' }),
  // Revoked wins over expired.
  key({ id: 'revoked', revokedAt: '2026-10-02T00:00:00.000Z', expiresAt: '2026-10-01T00:00:00.000Z', createdById: 'user-2' }),
  key({ id: 'forever', expiresAt: null, name: 'Legacy sync', description: 'Old integration' }),
];

describe('filterApiKeys', () => {
  it('derives status as revoked, then expired, then active', () => {
    expect(filterApiKeys(KEYS, { status: 'revoked' }, NOW).map((k) => k.id)).toEqual(['revoked']);
    expect(filterApiKeys(KEYS, { status: 'expired' }, NOW).map((k) => k.id)).toEqual(['expired']);
    expect(filterApiKeys(KEYS, { status: 'active' }, NOW).map((k) => k.id)).toEqual(['active', 'forever']);
  });

  it('filters by creator and by text in name, prefix or description', () => {
    expect(filterApiKeys(KEYS, { creatorId: 'user-2' }, NOW).map((k) => k.id)).toEqual(['revoked']);
    expect(filterApiKeys(KEYS, { search: 'old integ' }, NOW).map((k) => k.id)).toEqual(['forever']);
    expect(filterApiKeys(KEYS, { search: 'AV_LIVE' }, NOW)).toHaveLength(4);
  });
});

describe('formatUsageCount', () => {
  it('groups digits without converting to a number', () => {
    expect(formatUsageCount('0')).toBe('0');
    expect(formatUsageCount('1234567')).toBe('1,234,567');
    // Above Number.MAX_SAFE_INTEGER: digits must survive exactly.
    expect(formatUsageCount('9007199254740993')).toBe('9,007,199,254,740,993');
  });

  it('leaves anything unexpected as it is', () => {
    expect(formatUsageCount('n/a')).toBe('n/a');
  });
});
