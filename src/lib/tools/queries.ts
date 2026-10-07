import { queryOptions } from '@tanstack/react-query';
import { toolsApi } from '../api/tools';
import type { ListToolsParams, ToolLedgerParams } from './types';

export const toolKeys = {
  lists: (ws: string) => ['ws', ws, 'tools'] as const,
  detail: (ws: string, id: string) => ['ws', ws, 'tool', id] as const,
  ledger: (ws: string) => ['ws', ws, 'tool-ledger'] as const,
};
export const toolsQuery = (ws: string, params: ListToolsParams = {}) => queryOptions({
  queryKey: [...toolKeys.lists(ws), params], queryFn: ({ signal }) => toolsApi.list(ws, params, signal),
});
export const toolQuery = (ws: string, id: string) => queryOptions({
  queryKey: toolKeys.detail(ws, id), queryFn: ({ signal }) => toolsApi.detail(ws, id, signal),
});
export const toolLedgerQuery = (ws: string, params: ToolLedgerParams = {}) => queryOptions({
  queryKey: [...toolKeys.ledger(ws), params], queryFn: ({ signal }) => toolsApi.ledger(ws, params, signal),
});
