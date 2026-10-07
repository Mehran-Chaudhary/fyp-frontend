import { describe, expect, it } from 'vitest';
import type { Quota } from '@/lib/api/governance-types';
import { quotaChangeWeakens, quotaGauge, seriesSegments, validateWindow } from './helpers';

const rate: Quota = { id: 'q', scope: 'ORGANIZATION', subjectId: null, period: 'MINUTE', tokenLimit: 100, enforcement: 'HARD', alertThreshold: 80, managedBy: 'PLATFORM', label: null, usage: null, rate: { available: null } };
describe('governance contract edge cases', () => {
  it('keeps unavailable rate telemetry distinct from an empty bucket', () => {
    expect(quotaGauge(rate).percent).toBeNull();
    expect(quotaGauge({ ...rate, rate: { available: 0 } }).percent).toBe(100);
    expect(quotaGauge({ ...rate, rate: { available: 100 } }).percent).toBe(0);
  });
  it('preserves overspent soft budgets for the label while identifying their danger', () => {
    const gauge = quotaGauge({ ...rate, period: 'DAY', usage: { used: 200, reserved: 0, remaining: 0, percent: 200, periodStart: '', resetsAt: '' } });
    expect(gauge.percent).toBe(200); expect(gauge.tone).toBe('danger');
  });
  it('does not connect percentiles across null observations or turn null into zero', () => {
    const result = seriesSegments([{ at: 'a', value: 10 }, { at: 'b', value: null }, { at: 'c', value: 0 }], 100, 100);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[1][0]).toMatchObject({ x: 100, y: 100, value: 0 });
  });
  it('validates ordering and hourly time windows', () => {
    expect(validateWindow('bad', 'bad')).not.toBeNull();
    expect(validateWindow('2026-01-02', '2026-01-01')).not.toBeNull();
    expect(validateWindow('2026-01-01', '2026-01-16', 14)).not.toBeNull();
    expect(validateWindow('2026-01-01', '2026-01-15', 14)).toBeNull();
  });
  it('flags every relaxation and no tightening', () => {
    expect(quotaChangeWeakens(rate, 200, 'HARD')).toBe(true);
    expect(quotaChangeWeakens(rate, 50, 'SOFT')).toBe(true);
    expect(quotaChangeWeakens(rate, 50, 'HARD')).toBe(false);
  });
});
