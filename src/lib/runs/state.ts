import type { RealtimeEvent, Run, RunDetail, RunStatus, StepStatus } from './types';

export const RUN_STATUSES: RunStatus[] = ['QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'];
export const isRunActive = (status: string) => ['QUEUED', 'RUNNING', 'WAITING_APPROVAL'].includes(status);
export const statusLabel = (status: string) => status.toLowerCase().replaceAll('_', ' ');
export const stepKey = (nodeId: string, iteration: number) => `${nodeId}#${iteration}`;
export function compareEventIds(a: string, b: string): number {
  const [am, as] = a.split('-').map(BigInt);
  const [bm, bs] = b.split('-').map(BigInt);
  return am === bm ? (as === bs ? 0 : as < bs ? -1 : 1) : am < bm ? -1 : 1;
}
export function runActions(run: Pick<Run, 'status' | 'initiatorUserId'>, userId: string | undefined, can: (permission: string) => boolean) {
  const own = !!userId && run.initiatorUserId === userId;
  // The route checks execute first, including for a workflow editor.
  const control = can('workflow:execute') && (own || can('workflow:update'));
  return { cancel: control && isRunActive(run.status), resume: control && ['FAILED', 'TIMED_OUT'].includes(run.status),
    delete: can('workflow:read') && (own || can('workflow:delete')) && !isRunActive(run.status),
    reveal: can('pii:reveal'), trace: can('audit:read') && can('workflow:read') };
}
const stepStates: Record<string, StepStatus> = { 'step.queued': 'QUEUED', 'step.started': 'RUNNING', 'step.retrying': 'QUEUED', 'step.completed': 'SUCCEEDED', 'step.failed': 'FAILED', 'step.skipped': 'SKIPPED', 'step.waiting_approval': 'WAITING_APPROVAL' };
const runStates: Record<string, RunStatus> = { 'run.started': 'RUNNING', 'run.resumed': 'RUNNING', 'run.completed': 'COMPLETED', 'run.failed': 'FAILED', 'run.cancelled': 'CANCELLED', 'run.timed_out': 'TIMED_OUT' };
/** Apply only metadata we know. REST fills in new steps and reconciles terminal events. */
export function applyRunEvent(run: RunDetail, event: RealtimeEvent): RunDetail {
  if (event.runId !== run.id) return run;
  const active = isRunActive(run.status);
  let status = run.status;
  if ((active || event.type === 'run.resumed') && runStates[event.type]) status = runStates[event.type];
  if (active && event.type === 'step.waiting_approval') status = 'WAITING_APPROVAL';
  if (status === 'WAITING_APPROVAL' && event.type === 'approval.decided') status = 'RUNNING';
  return { ...run, status,
    ...(typeof event.data.tokensUsed === 'number' ? { tokensUsed: event.data.tokensUsed } : {}),
    ...(typeof event.data.errorCode === 'string' && event.type.startsWith('run.') ? { errorCode: event.data.errorCode } : {}),
    steps: run.steps.map(step => {
      if (!active || step.nodeId !== event.nodeId || step.iteration !== event.data.iteration || !stepStates[event.type]) return step;
      return { ...step, status: stepStates[event.type],
        ...(typeof event.data.attempt === 'number' ? { attempt: event.data.attempt } : {}),
        ...(Array.isArray(event.data.handles) ? { handles: event.data.handles as string[] } : {}),
        ...(typeof event.data.errorCode === 'string' ? { errorCode: event.data.errorCode } : {}),
        ...(typeof event.data.durationMs === 'number' ? { durationMs: event.data.durationMs } : {}),
      };
    }),
  };
}
/** Keep only metadata received during an in-flight REST request, then fold it onto that snapshot. */
export function createRunEventJournal() {
  let serial = 0;
  const events: Array<{ serial: number; event: RealtimeEvent }> = [];
  return {
    mark: () => serial,
    record(event: RealtimeEvent) {
      events.push({ serial: ++serial, event });
      if (events.length > 1000) events.shift();
    },
    merge(run: RunDetail, after: number) {
      return events.filter(entry => entry.serial > after && entry.event.runId === run.id)
        .sort((a, b) => compareEventIds(a.event.id, b.event.id)).reduce((snapshot, entry) => applyRunEvent(snapshot, entry.event), run);
    },
    clear() { events.length = 0; },
  };
}
const ERROR_TEXT: Record<string, string> = {
  WORKFLOW_PRINCIPAL_REVOKED: 'The person who started this run no longer has permission to run it.',
  WORKFLOW_TIMEOUT: 'This run passed its time limit. It can be resumed.',
  WORKFLOW_STEP_LIMIT_EXCEEDED: 'This run reached its step limit.',
  WORKFLOW_TOKEN_BUDGET_EXCEEDED: 'This run used its token budget.',
  WORKFLOW_LOOP_EXHAUSTED: 'A loop ran out of iterations.',
  WORKFLOW_NO_OUTPUT: 'The workflow finished without reaching an output.',
  WORKFLOW_TEMPLATE_ERROR: 'A step referred to a value that was not available.',
  TOOL_PII_BLOCKED: 'A tool was stopped to protect personal data.',
  TOOL_EGRESS_BLOCKED: 'The tool would have sent data it is not allowed to send.',
  TOOL_TIMEOUT: 'A tool did not answer in time.', TOOL_EXECUTION_FAILED: 'A tool failed.',
  AGENT_CIRCUIT_OPEN: 'An agent is paused after unusual activity.', QUOTA_EXCEEDED: 'The token budget for this period is used up.',
};
export const runErrorText = (code: string | null) => code ? ERROR_TEXT[code] ?? 'A step could not complete. Review its error and dependencies before resuming.' : null;
export function parseRunInput(value: string): Record<string, unknown> {
  if (new TextEncoder().encode(value).byteLength > 65_536) throw new Error('Input must be 64 KB or smaller.');
  let input: unknown;
  try { input = JSON.parse(value); } catch { throw new Error('Enter valid JSON for the run input.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('The run input must be a JSON object.');
  return input as Record<string, unknown>;
}
