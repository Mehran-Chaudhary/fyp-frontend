import { useQuery } from '@tanstack/react-query';
import { Filter, History, RefreshCw } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { EmptyState, ErrorState, PageHeader } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card } from '@/components/ui/card';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Pagination } from '@/components/ui/pagination';
import { RelativeTime } from '@/components/ui/relative-time';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { useDocumentTitle } from '@/lib/hooks';
import { toolLedgerQuery } from '@/lib/tools/queries';
import type { ToolExecution } from '@/lib/tools/types';
import { ExecutionBadge, ToolsBack } from './shared';
import { useToolCan } from './use-tool-can';

export function ToolExecutionsPage() {
  const can = useToolCan();
  const ws = useWorkspace();
  useDocumentTitle('Tool execution ledger');
  return can.ledger ? <Ledger /> : <Card><NoAccessState permissions={['tool:read + usage:read']} workspaceName={ws.name} /></Card>;
}
const isUuid = (value: string) => !value || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function Ledger() {
  const ws = useWorkspace();
  const [params, setParams] = useSearchParams();
  const toolId = params.get('toolId') ?? '';
  const runId = params.get('runId') ?? '';
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const valid = isUuid(toolId) && isUuid(runId);
  const query = useQuery({ ...toolLedgerQuery(ws.id, { page, limit: 20, ...(toolId ? { toolId } : {}), ...(runId ? { runId } : {}) }), enabled: valid,
    refetchInterval: (state) => state.state.data?.items.some((item) => item.status === 'RUNNING') ? 5000 : false,
  });
  return <div className="grid gap-5"><ToolsBack /><PageHeader overline="TOOLS / EXECUTIONS" title="Execution ledger" description="Every tool call, including refusals, in newest-first order. Metadata connects an outcome to the exact tool version that ran." actions={<Button variant="secondary" onClick={() => void query.refetch()} disabled={!valid} loading={query.isFetching}><RefreshCw />Refresh</Button>} />
    <Callout tone="neutral" title="Content-free by design">Arguments and results are never returned here. The keyed argument digest lets equal calls be matched without revealing their content.</Callout>
    <Filters key={`${toolId}:${runId}`} toolId={toolId} runId={runId} onApply={(tool, run) => setParams({ ...(tool ? { toolId: tool } : {}), ...(run ? { runId: run } : {}) })} />
    {!valid ? <FormError message="Tool and run filters must be valid UUIDs." /> : query.isPending ? <Skeleton className="h-72 rounded-xl" /> : query.isError ? <Card><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Card> : !query.data.items.length ? <Card><EmptyState icon={<History />} title="No executions yet" description="Tool tests and calls from agents or workflows appear here, including denied attempts." /></Card> : <Card className="overflow-hidden"><Table><THead><TR><TH>Tool / version</TH><TH>Outcome</TH><TH>Context</TH><TH>Duration / output size</TH><TH>When</TH><TH>Evidence</TH></TR></THead><TBody>{query.data.items.map((item) => <ExecutionRow key={item.id} execution={item} />)}</TBody></Table></Card>}
    {valid && query.data && <Pagination pagination={query.data.pagination} onPageChange={(next) => setParams((old) => { const updated = new URLSearchParams(old); updated.set('page', String(next)); return updated; })} busy={query.isFetching} noun={['execution', 'executions']} />}
  </div>;
}
function Filters({ toolId, runId, onApply }: { toolId: string; runId: string; onApply: (tool: string, run: string) => void }) {
  const [tool, setTool] = useState(toolId);
  const [run, setRun] = useState(runId);
  const [attempted, setAttempted] = useState(false);
  const submit = (event: FormEvent) => { event.preventDefault(); setAttempted(true); if (isUuid(tool.trim()) && isUuid(run.trim())) onApply(tool.trim(), run.trim()); };
  return <form onSubmit={submit} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto_auto]"><Field label="Tool ID" optional error={attempted && !isUuid(tool.trim()) ? 'Enter a valid UUID.' : undefined}><Input value={tool} onChange={(e) => setTool(e.target.value)} placeholder="Built-in or HTTP tool UUID" /></Field><Field label="Workflow run ID" optional error={attempted && !isUuid(run.trim()) ? 'Enter a valid UUID.' : undefined}><Input value={run} onChange={(e) => setRun(e.target.value)} placeholder="Run UUID" /></Field><Button type="submit" variant="secondary"><Filter />Apply</Button><Button variant="ghost" onClick={() => { setTool(''); setRun(''); setAttempted(false); onApply('', ''); }}>Clear</Button></form>;
}
function ExecutionRow({ execution: item }: { execution: ToolExecution }) {
  const ws = useWorkspace();
  const base = `/w/${ws.slug}`;
  return <TR><TD><div className="min-w-36">{item.toolId ? <Link className="font-medium text-ink hover:text-brand-700" to={`${base}/tools/${item.toolId}`}>{item.toolName}</Link> : <span className="font-medium">{item.toolName}</span>}<p className="mt-1 text-xs text-muted">{item.toolVersion === null ? 'Unknown version' : `Version ${item.toolVersion}`}{item.sideEffects ? ' · Side effects' : ''}</p></div></TD>
    <TD><ExecutionBadge status={item.status} />{(item.errorCode || item.denialReason) && <p className="mt-1 max-w-64 font-mono text-[11px] text-muted">{item.errorCode}{item.denialReason ? ` · ${item.denialReason}` : ''}</p>}</TD>
    <TD><p className="text-xs">{item.contextClassification ?? '—'}</p><p className="mt-1 text-xs text-muted">{item.contextIntegrity ?? '—'}</p></TD>
    <TD><p className="whitespace-nowrap tabular-nums">{item.durationMs === null ? 'Pending' : `${item.durationMs.toLocaleString()} ms`}</p><p className="mt-1 whitespace-nowrap text-xs tabular-nums text-muted">{item.resultBytes.toLocaleString()} bytes</p></TD>
    <TD className="whitespace-nowrap"><RelativeTime value={item.createdAt} /></TD>
    <TD><details className="min-w-24 max-w-80"><summary className="cursor-pointer text-xs text-brand-700">View metadata</summary><dl className="mt-3 grid min-w-60 gap-2 text-xs"><Meta label="Execution ID" value={item.id} /><Meta label="Argument digest" value={item.argumentsDigest} /><Meta label="Completed" value={item.completedAt} />{item.workflowRunId && <div><dt className="text-muted">Workflow run</dt><dd><Link className="break-all text-brand-700 underline" to={`${base}/runs/${item.workflowRunId}`}>{item.workflowRunId}</Link></dd></div>}<Meta label="Workflow step" value={item.workflowStepId} />{item.agentId && <div><dt className="text-muted">Agent</dt><dd><Link className="break-all text-brand-700 underline" to={`${base}/agents/${item.agentId}`}>{item.agentId}</Link></dd></div>}<Meta label="Conversation ID" value={item.conversationId} /></dl></details></TD>
  </TR>;
}
function Meta({ label, value }: { label: string; value: string | null }) { return value ? <div><dt className="text-muted">{label}</dt><dd className="font-mono break-all text-ink-soft">{value}</dd></div> : null; }
