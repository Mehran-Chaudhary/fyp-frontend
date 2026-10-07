import { call, callPaginated, download, workspacePath, type RequestOptions } from './client';
import type { AgentCircuit, AnalyticsOverview, AuditArchive, AuditFilters, AuditLog, AuditStatistics, ChainVerification, CreateQuotaInput, Quota, QuotaHistoryEntry, SecurityEvent, SeriesMetric, Timeseries, TimeWindow, TopDimension, TopEntry, UpdateQuotaInput } from './governance-types';

function scoped<T>(workspaceId: string, subpath: string, options: RequestOptions = {}) {
  const [path, scope] = workspacePath(workspaceId, subpath);
  return call<T>(path, { ...options, ...scope });
}
function file(workspaceId: string, subpath: string, query?: RequestOptions['query'], signal?: AbortSignal) {
  const [path, scope] = workspacePath(workspaceId, subpath);
  return download(path, { ...scope, query, signal, timeoutMs: 120_000, accept: 'application/x-ndjson' });
}
export const auditApi = {
  list(workspaceId: string, filters: AuditFilters, signal?: AbortSignal) {
    const [path, scope] = workspacePath(workspaceId, '/audit-logs');
    return callPaginated<AuditLog>(path, { ...scope, query: { ...filters }, signal });
  },
  statistics: (workspaceId: string, signal?: AbortSignal) => scoped<AuditStatistics>(workspaceId, '/audit-logs/statistics', { signal }),
  verify: (workspaceId: string, maxRecords?: number, signal?: AbortSignal) => scoped<ChainVerification>(workspaceId, '/audit-logs/verify', { query: { maxRecords }, signal, timeoutMs: 120_000 }),
  export: (workspaceId: string, window: Partial<TimeWindow>, signal?: AbortSignal) => file(workspaceId, '/audit-logs/export', { ...window }, signal),
  archives: (workspaceId: string, signal?: AbortSignal) => scoped<AuditArchive[]>(workspaceId, '/audit-logs/archives', { signal }),
  archive: (workspaceId: string, sequence: string, signal?: AbortSignal) => file(workspaceId, `/audit-logs/archives/${encodeURIComponent(sequence)}`, undefined, signal),
};
export const analyticsApi = {
  overview: (workspaceId: string, window: TimeWindow, signal?: AbortSignal) => scoped<AnalyticsOverview>(workspaceId, '/analytics/overview', { query: { ...window }, signal }),
  timeseries: (workspaceId: string, window: TimeWindow, metric: SeriesMetric, interval: 'hour' | 'day', signal?: AbortSignal) => scoped<Timeseries>(workspaceId, '/analytics/timeseries', { query: { ...window, metric, interval }, signal }),
  top: (workspaceId: string, window: TimeWindow, dimension: TopDimension, signal?: AbortSignal) => scoped<TopEntry[]>(workspaceId, '/analytics/top', { query: { ...window, dimension, limit: 10 }, signal }),
  security: (workspaceId: string, before?: string, signal?: AbortSignal) => scoped<SecurityEvent[]>(workspaceId, '/analytics/security-events', { query: { limit: 50, before }, signal }),
};
export const quotasApi = {
  list: (workspaceId: string, signal?: AbortSignal) => scoped<Quota[]>(workspaceId, '/quotas', { signal }),
  mine: (workspaceId: string, signal?: AbortSignal) => scoped<Quota[]>(workspaceId, '/quotas/me', { signal }),
  create: (workspaceId: string, body: CreateQuotaInput) => scoped<Quota>(workspaceId, '/quotas', { method: 'POST', body }),
  update: (workspaceId: string, id: string, body: UpdateQuotaInput) => scoped<Quota>(workspaceId, `/quotas/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  remove: (workspaceId: string, id: string) => scoped<{ deleted: true }>(workspaceId, `/quotas/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  history: (workspaceId: string, id: string, periods: number, signal?: AbortSignal) => scoped<QuotaHistoryEntry[]>(workspaceId, `/quotas/${encodeURIComponent(id)}/history`, { query: { periods }, signal }),
};
export const circuitsApi = {
  list: (workspaceId: string, signal?: AbortSignal) => scoped<AgentCircuit[]>(workspaceId, '/circuits', { signal }),
  get: (workspaceId: string, agentId: string, signal?: AbortSignal) => scoped<AgentCircuit>(workspaceId, `/circuits/agents/${encodeURIComponent(agentId)}`, { signal }),
  reset: (workspaceId: string, agentId: string) => scoped<{ reset: true; wasOpen: boolean }>(workspaceId, `/circuits/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' }),
};
