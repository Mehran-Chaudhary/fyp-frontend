import { call, callPaginated, workspacePath } from './client';
import type { ListWorkflowsParams, NodeTypeDescriptor, SaveDefinitionInput, ValidationReport, Workflow, WorkflowGraph, WorkflowSettings, WorkflowSummary, WorkflowVersion } from '@/lib/workflows/types';

const pathFor = (workspaceId: string, suffix = '') => workspacePath(workspaceId, `/workflows${suffix}`);
const id = encodeURIComponent;

/** Phase 5 operations 08–20. A single captured workspace scopes both path and header. */
export const workflowsApi = {
  list(workspaceId: string, params: ListWorkflowsParams = {}, signal?: AbortSignal) {
    const [path, scope] = pathFor(workspaceId);
    return callPaginated<WorkflowSummary>(path, { ...scope, query: { ...params }, signal });
  },
  nodeTypes(workspaceId: string, signal?: AbortSignal) {
    const [path, scope] = pathFor(workspaceId, '/node-types');
    return call<{ nodeTypes: NodeTypeDescriptor[] }>(path, { ...scope, signal });
  },
  validate(workspaceId: string, graph: WorkflowGraph, signal?: AbortSignal) {
    const [path, scope] = pathFor(workspaceId, '/validate');
    return call<ValidationReport>(path, { ...scope, method: 'POST', body: { graph }, signal, timeoutMs: 35_000 });
  },
  create(workspaceId: string, body: { name: string; description?: string; graph?: WorkflowGraph; settings?: WorkflowSettings }) {
    const [path, scope] = pathFor(workspaceId);
    return call<Workflow>(path, { ...scope, method: 'POST', body });
  },
  get(workspaceId: string, workflowId: string, signal?: AbortSignal) {
    const [path, scope] = pathFor(workspaceId, `/${id(workflowId)}`);
    return call<Workflow>(path, { ...scope, signal });
  },
  update(workspaceId: string, workflowId: string, body: { name?: string; description?: string | null }) {
    const [path, scope] = pathFor(workspaceId, `/${id(workflowId)}`);
    return call<Workflow>(path, { ...scope, method: 'PATCH', body });
  },
  save(workspaceId: string, workflowId: string, body: SaveDefinitionInput) {
    const [path, scope] = pathFor(workspaceId, `/${id(workflowId)}/definition`);
    return call<Workflow>(path, { ...scope, method: 'PUT', body, localCodes: ['WORKFLOW_VERSION_CONFLICT'] });
  },
  versions(workspaceId: string, workflowId: string, page = 1, signal?: AbortSignal) {
    const [path, scope] = pathFor(workspaceId, `/${id(workflowId)}/versions`);
    return callPaginated<WorkflowVersion>(path, { ...scope, query: { page, limit: 10 }, signal });
  },
  version(workspaceId: string, workflowId: string, version: number, signal?: AbortSignal) {
    const [path, scope] = pathFor(workspaceId, `/${id(workflowId)}/versions/${version}`);
    return call<WorkflowVersion>(path, { ...scope, signal });
  },
  restore(workspaceId: string, workflowId: string, version: number, changeNote?: string) {
    const [path, scope] = pathFor(workspaceId, `/${id(workflowId)}/versions/${version}/restore`);
    return call<Workflow>(path, { ...scope, method: 'POST', body: changeNote ? { changeNote } : {} });
  },
  publish(workspaceId: string, workflowId: string, version: number) {
    const [path, scope] = pathFor(workspaceId, `/${id(workflowId)}/publish`);
    return call<Workflow>(path, { ...scope, method: 'POST', body: { version } });
  },
  archive(workspaceId: string, workflowId: string) {
    const [path, scope] = pathFor(workspaceId, `/${id(workflowId)}/archive`);
    return call<Workflow>(path, { ...scope, method: 'POST', body: {} });
  },
  delete(workspaceId: string, workflowId: string) {
    const [path, scope] = pathFor(workspaceId, `/${id(workflowId)}`);
    return call<{ deleted: true }>(path, { ...scope, method: 'DELETE' });
  },
};

export const workflowKeys = {
  all: (workspaceId: string) => ['ws', workspaceId, 'workflows'] as const,
  list: (workspaceId: string, params: ListWorkflowsParams) => [...workflowKeys.all(workspaceId), 'list', params] as const,
  detail: (workspaceId: string, workflowId: string) => [...workflowKeys.all(workspaceId), 'detail', workflowId] as const,
  versions: (workspaceId: string, workflowId: string) => [...workflowKeys.all(workspaceId), 'versions', workflowId] as const,
  version: (workspaceId: string, workflowId: string, version: number) => [...workflowKeys.all(workspaceId), 'version', workflowId, version] as const,
};
