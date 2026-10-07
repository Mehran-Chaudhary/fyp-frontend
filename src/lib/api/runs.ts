import { call, callPaginated, workspacePath } from './client';
import type { ApprovalDecisionInput, ApprovalItem, ContentView, DeadLetter, Run, RunDetail, RunStatus, RunTrace, StartRunInput } from '@/lib/runs/types';

export interface RunFilters { scope?: 'mine' | 'all'; status?: RunStatus; workflowId?: string; page?: number; limit?: number }
export const runsApi = {
  start: (ws: string, workflowId: string, body: StartRunInput, signal?: AbortSignal) => {
    const [path, ctx] = workspacePath(ws, `/workflows/${workflowId}/runs`);
    return call<Run>(path, { ...ctx, method: 'POST', body, signal, timeoutMs: 30_000 });
  },
  list: (ws: string, filters: RunFilters, signal?: AbortSignal) => {
    const [path, ctx] = workspacePath(ws, '/workflow-runs');
    return callPaginated<Run>(path, { ...ctx, query: { ...filters }, signal });
  },
  detail: (ws: string, id: string, signal?: AbortSignal) => call<RunDetail>(...args(ws, `/${id}`, signal)),
  content: (ws: string, id: string, stepId?: string, reveal = false, signal?: AbortSignal) => {
    const [path, ctx] = args(ws, `/${id}${stepId ? `/steps/${stepId}` : ''}/content`, signal);
    return call<ContentView>(path, { ...ctx, query: { reveal } });
  },
  trace: (ws: string, id: string, signal?: AbortSignal) => call<RunTrace>(...args(ws, `/${id}/trace`, signal)),
  cancel: (ws: string, id: string) => { const [path, ctx] = args(ws, `/${id}/cancel`); return call<Run>(path, { ...ctx, method: 'POST' }); },
  resume: (ws: string, id: string) => { const [path, ctx] = args(ws, `/${id}/resume`); return call<Run>(path, { ...ctx, method: 'POST' }); },
  remove: (ws: string, id: string) => { const [path, ctx] = args(ws, `/${id}`); return call<{ deleted: true }>(path, { ...ctx, method: 'DELETE' }); },
  approvals: (ws: string, signal?: AbortSignal) => call<ApprovalItem[]>(...args(ws, '/approvals', signal)),
  decide: (ws: string, id: string, stepId: string, body: ApprovalDecisionInput) => {
    const [path, ctx] = args(ws, `/${id}/steps/${stepId}/approval`);
    return call<Run>(path, { ...ctx, method: 'POST', body });
  },
  deadLetters: (ws: string, page: number, signal?: AbortSignal) => {
    const [path, ctx] = args(ws, '/dead-letters', signal);
    return callPaginated<DeadLetter>(path, { ...ctx, query: { page, limit: 20 } });
  },
};
function args(ws: string, suffix: string, signal?: AbortSignal) {
  const [path, ctx] = workspacePath(ws, `/workflow-runs${suffix}`);
  return [path, { ...ctx, signal }] as const;
}
export const runKeys = {
  list: (ws: string) => ['ws', ws, 'runs'] as const,
  detail: (ws: string, id: string) => ['ws', ws, 'run', id] as const,
  approvals: (ws: string) => ['ws', ws, 'approvals'] as const,
  deadLetters: (ws: string) => ['ws', ws, 'dead-letters'] as const,
};
