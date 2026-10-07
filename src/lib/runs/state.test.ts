import { describe, expect, it } from 'vitest';
import { applyRunEvent, compareEventIds, parseRunInput, runActions } from './state';
import type { RealtimeEvent, RunDetail } from './types';

const run = { id: 'run', status: 'RUNNING', steps: [{ id: 'one', nodeId: 'loop', iteration: 0, status: 'SUCCEEDED', handles: ['out'] }, { id: 'two', nodeId: 'loop', iteration: 1, status: 'RUNNING', handles: [] }] } as RunDetail;
const event = (type: RealtimeEvent['type'], data: RealtimeEvent['data'] = {}): RealtimeEvent => ({ id: '9-12', organizationId: 'ws', runId: 'run', at: '', type, nodeId: 'loop', data });
describe('run reconciliation', () => {
  it('compares stream identifiers numerically without precision loss', () => {
    expect(compareEventIds('9-12', '9-2')).toBeGreaterThan(0);
    expect(compareEventIds('10-0', '9-9999')).toBeGreaterThan(0);
    expect(compareEventIds('9999999999999999999-1', '9999999999999999998-1')).toBeGreaterThan(0);
  });
  it('updates the exact loop iteration without mutating the snapshot', () => {
    const result = applyRunEvent(run, event('step.completed', { iteration: 1, handles: ['else'], durationMs: 12 }));
    expect(result.steps[0]).toBe(run.steps[0]); expect(result.steps[1].status).toBe('SUCCEEDED'); expect(result.steps[1].handles).toEqual(['else']); expect(run.steps[1].status).toBe('RUNNING');
  });
  it('never reopens terminal runs on late approval or step messages', () => {
    const completed = { ...run, status: 'COMPLETED' as const };
    expect(applyRunEvent(completed, event('step.waiting_approval', { iteration: 1 })).status).toBe('COMPLETED');
    expect(applyRunEvent(completed, event('run.started')).status).toBe('COMPLETED');
    expect(applyRunEvent(completed, event('approval.decided')).status).toBe('COMPLETED');
    expect(applyRunEvent({ ...run, status: 'FAILED' }, event('run.resumed')).status).toBe('RUNNING');
  });
  it('ignores an event for another run', () => expect(applyRunEvent(run, { ...event('run.failed'), runId: 'other' })).toBe(run));
});
describe('route-first permissions', () => {
  it('requires execute even for an editor controlling someone else’s run', () => {
    const can = (p: string) => ['workflow:update', 'workflow:read', 'workflow:read_all'].includes(p);
    expect(runActions({ status: 'RUNNING', initiatorUserId: 'other' }, 'me', can).cancel).toBe(false);
  });
  it('allows owners to control only active or resumable states and delete only finished runs', () => {
    const can = (p: string) => ['workflow:execute', 'workflow:read'].includes(p);
    expect(runActions({ status: 'RUNNING', initiatorUserId: 'me' }, 'me', can)).toMatchObject({ cancel: true, resume: false, delete: false });
    expect(runActions({ status: 'FAILED', initiatorUserId: 'me' }, 'me', can)).toMatchObject({ cancel: false, resume: true, delete: true });
    expect(runActions({ status: 'CANCELLED', initiatorUserId: 'me' }, 'me', can).resume).toBe(false);
  });
});
describe('run input', () => {
  it('requires an object and enforces the byte limit for Unicode input', () => {
    expect(parseRunInput('{"amount":30}')).toEqual({ amount: 30 });
    for (const value of ['[]', 'null', 'invalid', '"text"']) expect(() => parseRunInput(value)).toThrow();
    expect(() => parseRunInput(JSON.stringify({ value: '€'.repeat(22000) }))).toThrow('64 KB');
  });
});
