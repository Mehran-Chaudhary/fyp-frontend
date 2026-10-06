import type { UsageSummary } from '../api/types';

export type UsageWindowKey = '24h' | '7d' | '30d' | '90d' | 'custom';

export const USAGE_WINDOWS: ReadonlyArray<{ key: Exclude<UsageWindowKey, 'custom'>; label: string; ms: number }> = [
  { key: '24h', label: 'Last 24 hours', ms: 24 * 3_600_000 },
  { key: '7d', label: 'Last 7 days', ms: 7 * 86_400_000 },
  { key: '30d', label: 'Last 30 days', ms: 30 * 86_400_000 },
  { key: '90d', label: 'Last 90 days', ms: 90 * 86_400_000 },
];

/**
 * A preset window ending now, rounded to the minute so the query key stays stable
 * while the page is open.
 */
export function presetWindow(key: Exclude<UsageWindowKey, 'custom'>, now: number): { from: string; to: string } {
  const preset = USAGE_WINDOWS.find((item) => item.key === key) ?? USAGE_WINDOWS[2];
  const to = Math.floor(now / 60_000) * 60_000;
  return { from: new Date(to - preset.ms).toISOString(), to: new Date(to).toISOString() };
}

/**
 * A custom window from two `yyyy-mm-dd` inputs, both inclusive, in local time. The
 * server doesn't reject `from` after `to` (P4-G14), so that's checked here.
 */
export function customWindow(fromDate: string, toDate: string): { window: { from: string; to: string } | null; error: string | null } {
  const from = parseLocalDate(fromDate);
  const to = parseLocalDate(toDate);
  if (!from || !to) return { window: null, error: 'Choose a start and an end date.' };
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
  if (from.getTime() >= end.getTime()) return { window: null, error: 'The start date must be on or before the end date.' };
  return { window: { from: from.toISOString(), to: end.toISOString() }, error: null };
}

function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `yyyy-mm-dd` in local time, for date inputs. */
export function toDateInput(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "—" for a percentile an empty window doesn't have (never "0 ms"). */
export function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value >= 10_000) return `${(value / 1000).toFixed(1)} s`;
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  if (value >= 100) return `${Math.round(value)} ms`;
  return `${value.toFixed(value >= 10 ? 0 : 1)} ms`;
}

export function formatShare(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
}

/** 12_345 → "12.3k" for tight spaces; exact numbers stay in tooltips and tables. */
export function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export type Outcome = 'completed' | 'failed' | 'cancelled' | 'refused' | 'blocked' | 'throttled';

export const OUTCOMES: ReadonlyArray<{ key: Outcome; label: string; description: string }> = [
  { key: 'completed', label: 'Completed', description: 'Answered in full.' },
  { key: 'cancelled', label: 'Cancelled', description: 'Stopped by the user or a dropped connection.' },
  { key: 'throttled', label: 'Throttled', description: 'Refused by governance: token rate, monthly allowance, a paused agent.' },
  { key: 'refused', label: 'Refused', description: 'Personal-data masking was unavailable, so nothing was sent.' },
  { key: 'blocked', label: 'Blocked', description: 'The egress check found sensitive data that survived masking; nothing was sent.' },
  { key: 'failed', label: 'Failed', description: 'The model or the platform failed.' },
];

/** Each outcome's share of the invocations, for a stacked bar. Zero-safe. */
export function outcomeShares(totals: UsageSummary['totals']): Array<{ key: Outcome; count: number; share: number }> {
  const sum = OUTCOMES.reduce((total, outcome) => total + totals[outcome.key], 0);
  return OUTCOMES.map((outcome) => ({
    key: outcome.key,
    count: totals[outcome.key],
    share: sum > 0 ? totals[outcome.key] / sum : 0,
  }));
}
