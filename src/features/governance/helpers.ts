import type { Quota, TimeWindow, Timeseries } from '@/lib/api/governance-types';

export function quotaGauge(quota: Quota): { label: string; percent: number | null; tone: 'success' | 'warning' | 'danger' } {
  if (quota.usage) {
    const percent = quota.usage.percent;
    return { label: `${quota.usage.used.toLocaleString()} of ${quota.tokenLimit.toLocaleString()} tokens`, percent, tone: percent >= 100 ? 'danger' : percent >= quota.alertThreshold ? 'warning' : 'success' };
  }
  const available = quota.rate?.available;
  return {
    label: available == null ? `${quota.tokenLimit.toLocaleString()} tokens per minute · availability unknown` : `${available.toLocaleString()} of ${quota.tokenLimit.toLocaleString()} tokens available`,
    percent: available == null ? null : Math.round((1 - available / quota.tokenLimit) * 100), tone: 'success',
  };
}
export function windowFromDays(days: number, now = Date.now()): TimeWindow {
  return { from: new Date(now - days * 86_400_000).toISOString(), to: new Date(now).toISOString() };
}
export function validateWindow(from: string, to: string, maxDays = 400): string | null {
  const start = Date.parse(from); const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Choose valid start and end dates.';
  if (start >= end) return 'The start must be before the end.';
  if (end - start > maxDays * 86_400_000) return `Choose a window of ${maxDays} days or fewer.`;
  return null;
}
/** Split paths at null buckets: no observations must never become zero latency. */
export function seriesSegments(points: Timeseries['points'], width: number, height: number) {
  const maximum = Math.max(1, ...points.map((point) => point.value ?? 0));
  const segments: Array<Array<{ x: number; y: number; value: number; at: string }>> = [];
  let segment: (typeof segments)[number] = [];
  points.forEach((point, index) => {
    if (point.value === null) { if (segment.length) segments.push(segment); segment = []; return; }
    segment.push({ x: points.length <= 1 ? width / 2 : index * width / (points.length - 1), y: height - point.value / maximum * height, value: point.value, at: point.at });
  });
  if (segment.length) segments.push(segment);
  return { segments, maximum };
}
export function quotaChangeWeakens(quota: Quota, limit: number, enforcement: Quota['enforcement']) {
  return limit > quota.tokenLimit || (quota.enforcement === 'HARD' && enforcement === 'SOFT');
}
export function saveGovernanceFile(result: { blob: Blob; filename: string | null }, fallback: string) {
  const url = URL.createObjectURL(result.blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = result.filename ?? fallback; document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
