import { call, callPaginated, workspacePath } from './client';
import type { CreateToolInput, ListToolsParams, Tool, ToolExecution, ToolLedgerParams, ToolTestResult, UpdateToolInput } from '../tools/types';

/** Phase 5 operations 01–07. Capture one workspace id for both URL and header. */
export const toolsApi = {
  list: (ws: string, params: ListToolsParams = {}, signal?: AbortSignal) => {
    const [path, context] = workspacePath(ws, '/tools');
    return callPaginated<Tool>(path, { ...context, query: { ...params }, signal });
  },
  create: (ws: string, body: CreateToolInput, signal?: AbortSignal) => {
    const [path, context] = workspacePath(ws, '/tools');
    return call<Tool>(path, { ...context, method: 'POST', body, signal, localCodes: ['TOOL_DEFINITION_INVALID', 'TOOL_NAME_TAKEN'] });
  },
  ledger: (ws: string, params: ToolLedgerParams = {}, signal?: AbortSignal) => {
    const [path, context] = workspacePath(ws, '/tools/executions');
    return callPaginated<ToolExecution>(path, { ...context, query: { ...params }, signal });
  },
  detail: (ws: string, id: string, signal?: AbortSignal) => call<Tool>(...withTool(ws, id, signal)),
  update: (ws: string, id: string, body: UpdateToolInput, signal?: AbortSignal) => {
    const [path, context] = workspacePath(ws, `/tools/${encodeURIComponent(id)}`);
    return call<Tool>(path, { ...context, method: 'PATCH', body, signal, localCodes: ['RESOURCE_CONFLICT', 'TOOL_DEFINITION_INVALID', 'TOOL_NAME_TAKEN'] });
  },
  delete: (ws: string, id: string) => {
    const [path, context] = workspacePath(ws, `/tools/${encodeURIComponent(id)}`);
    return call<{ deleted: true }>(path, { ...context, method: 'DELETE' });
  },
  test: (ws: string, id: string, args: Record<string, unknown>, signal?: AbortSignal) => {
    const [path, context] = workspacePath(ws, `/tools/${encodeURIComponent(id)}/test`);
    return call<ToolTestResult>(path, { ...context, method: 'POST', body: { arguments: args }, signal, timeoutMs: 75_000 });
  },
};
function withTool(ws: string, id: string, signal?: AbortSignal): [string, { workspaceId: string; signal?: AbortSignal }] {
  const [path, context] = workspacePath(ws, `/tools/${encodeURIComponent(id)}`);
  return [path, { ...context, signal }];
}
