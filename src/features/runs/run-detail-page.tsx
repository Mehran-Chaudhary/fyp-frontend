import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Background, Controls, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeft, RotateCcw, Square, Trash2, GitBranch, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { EmptyState, ErrorState, PageHeader } from '@/components/feedback/states';
import { NoAccessState } from '@/components/feedback/no-access';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Spinner } from '@/components/ui/spinner';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { useRealtime } from '@/features/realtime/realtime-context';
import { call, workspacePath } from '@/lib/api/client';
import { runsApi, runKeys } from '@/lib/api/runs';
import { meQuery } from '@/lib/queries';
import { isRunActive, runActions, runErrorText, stepKey } from '@/lib/runs/state';
import type { RunDetail, Step } from '@/lib/runs/types';
import { LiveConnection, RunStatusBadge } from './run-bits';
import { RunContent } from './run-content';

export function RunDetailPage() {
  const { runId = '' } = useParams(); const ws = useWorkspace(); const can = useCan();
  const query = useQuery({ queryKey: runKeys.detail(ws.id, runId), queryFn: ({ signal }) => runsApi.detail(ws.id, runId, signal), enabled: can('workflow:read'), refetchInterval: query => query.state.data && isRunActive(query.state.data.status) ? 30_000 : false });
  const { session } = useRealtime();
  useEffect(() => can('workflow:read') ? session?.watch(runId) : undefined, [session, runId, can]);
  if (!can('workflow:read')) return <NoAccessState permissions={['workflow:read']} workspaceName={ws.name} />;
  if (query.isPending) return <div className="py-20"><Spinner /></div>;
  if (query.isError) return <div className="grid gap-4"><ErrorState error={query.error} title="Run unavailable" onRetry={() => void query.refetch()} />{can('audit:read') && <RunTracePanel runId={runId} />}</div>;
  return <RunView key={runId} run={query.data} refresh={() => void query.refetch()} />;
}
function RunView({ run, refresh }: { run: RunDetail; refresh: () => void }) {
  const ws = useWorkspace(); const can = useCan(); const client = useQueryClient(); const navigate = useNavigate(); const me = useQuery(meQuery);
  const [stepId, setStepId] = useState<string | null>(null); const [tab, setTab] = useState<'steps' | 'content' | 'trace'>('steps');
  const [action, setAction] = useState<'cancel' | 'resume' | 'delete' | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const allowed = runActions(run, me.data?.id, can); const selected = run.steps.find(step => step.id === stepId);
  const mutate = async () => {
    if (!action || busy) return; setBusy(true); setError(null);
    try {
      if (action === 'delete') { await runsApi.remove(ws.id, run.id); client.removeQueries({ queryKey: runKeys.detail(ws.id, run.id) }); navigate(`/w/${ws.slug}/runs`); }
      else await runsApi[action](ws.id, run.id);
      for (const area of ['runs', 'run', 'approvals', 'dead-letters']) void client.invalidateQueries({ queryKey: ['ws', ws.id, area] });
      setAction(null);
    } catch (cause) { setError(cause); refresh(); } finally { setBusy(false); }
  };
  return <div className="grid gap-5">
    <Link to={`/w/${ws.slug}/runs`} className="flex w-fit items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />All runs</Link>
    <PageHeader overline={<span className="flex items-center gap-2"><RunStatusBadge status={run.status} /><Badge>{run.classification}</Badge></span>} title={`Run ${run.id.slice(0, 8)}`} description={`Version ${run.workflowVersion} · Started ${new Date(run.startedAt ?? run.createdAt).toLocaleString()}`} actions={<>
      <Button variant="secondary" size="sm" onClick={refresh}><RefreshCw />Refresh</Button>
      {allowed.cancel && <Button variant="secondary" size="sm" onClick={() => { setError(null); setAction('cancel'); }}><Square />Cancel run</Button>}
      {allowed.resume && <Button size="sm" onClick={() => { setError(null); setAction('resume'); }}><RotateCcw />Resume run</Button>}
      {allowed.delete && <Button variant="danger-outline" size="sm" onClick={() => { setError(null); setAction('delete'); }}><Trash2 />Delete</Button>}
    </>} /><LiveConnection />
    {run.errorCode && <Callout tone="danger" title={run.errorCode}>{runErrorText(run.errorCode)}</Callout>}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[['Steps scheduled', `${run.stepsScheduled} / ${run.maxSteps}`], ['Tokens used', `${run.tokensUsed.toLocaleString()} / ${run.maxTokens.toLocaleString()}`], ['Tool calls', run.toolCalls], ['Deadline', new Date(run.deadlineAt).toLocaleTimeString()]].map(([label, value]) => <Card key={label} className="p-4"><p className="text-xs text-muted">{label}</p><p className="mt-2 text-lg font-semibold tabular-nums">{value}</p></Card>)}</div>
    <RunGraph run={run} onSelect={setStepId} />
    <div className="flex gap-1 border-b border-line" role="tablist" aria-label="Run details">{(['steps', 'content', ...(allowed.trace ? ['trace'] : [])] as Array<typeof tab>).map(value => <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`border-b-2 px-4 py-3 text-sm font-medium capitalize ${tab === value ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted'}`}>{value === 'content' ? 'Input & output' : value}</button>)}</div>
    {tab === 'steps' && <div className="grid items-start gap-5 xl:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.5fr)]"><Card className="overflow-hidden"><div className="divide-y divide-line">{run.steps.map(step => <button key={stepKey(step.nodeId, step.iteration)} onClick={() => setStepId(step.id)} className={`flex w-full items-center justify-between gap-3 p-4 text-left transition hover:bg-well ${step.id === stepId ? 'bg-brand-50' : ''}`}><div className="min-w-0"><p className="truncate text-sm font-medium">{step.nodeId}<span className="ml-2 text-xs text-muted">#{step.iteration}</span></p><p className="mt-1 text-xs text-muted">{step.nodeType} · Attempt {step.attempt}/{step.maxAttempts}</p></div><RunStatusBadge status={step.status} /></button>)}</div></Card><Card className="min-w-0 p-5">{selected ? <StepPanel key={`${selected.id}-${selected.status}-${ws.permissions.join(',')}`} runId={run.id} step={selected} /> : <EmptyState icon={<GitBranch />} title="Inspect a step" description="Choose a step to inspect timing, decisions, tool outcomes, and protected input and output." />}</Card></div>}
    {tab === 'content' && <Card className="p-5"><RunContent key={`${run.status}-${ws.permissions.join(',')}`} runId={run.id} /></Card>}
    {tab === 'trace' && allowed.trace && <RunTracePanel runId={run.id} />}
    <ConfirmDialog open={!!action} onOpenChange={open => { if (!open) setAction(null); }} title={action === 'delete' ? 'Delete this run permanently?' : action === 'cancel' ? 'Cancel this run?' : 'Resume this run?'} description={action === 'delete' ? 'Its encryption key and content will be destroyed. The audit trail and trace remain.' : action === 'cancel' ? 'In-flight steps are stopped. A cancelled run cannot be resumed.' : 'Failed and cancelled steps retry with a fresh deadline. Successful steps keep their outputs.'} tone={action === 'delete' ? 'danger' : 'warning'} confirmLabel={action === 'delete' ? 'Delete run' : action === 'cancel' ? 'Cancel run' : 'Resume run'} pending={busy} onConfirm={() => void mutate()}>{error ? <ErrorState compact error={error} /> : null}</ConfirmDialog>
  </div>;
}
function StepPanel({ runId, step }: { runId: string; step: Step }) {
  return <div className="grid gap-5"><div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold">{step.nodeId} · iteration {step.iteration}</h2><RunStatusBadge status={step.status} /></div>
    <dl className="grid grid-cols-2 gap-3 text-xs">{[['Duration', step.durationMs === null ? 'In progress / not started' : `${step.durationMs} ms`], ['Predecessors', step.predecessors.join(', ') || 'Trigger'], ['Outcome handles', step.handles.join(', ') || 'None yet'], ['Model / version', step.model ? `${step.model} · agent v${step.agentVersion}` : step.toolVersion ? `Tool v${step.toolVersion}` : '—'], ['Tokens', `${step.promptTokens} in / ${step.completionTokens} out`], ['Data label', `${step.classification} · ${step.integrity}`]].map(([label, value]) => <div key={label}><dt className="text-muted">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}</dl>
    {step.errorCode && <Callout tone="danger" title={`${step.errorCode} · ${step.failureClass ?? 'Error'}`}>{runErrorText(step.errorCode)}{step.deadLettered && <p className="mt-2">Recorded in dead letters.</p>}</Callout>}
    {step.approval && <Callout title={step.approval.decision ? `Decision: ${step.approval.decision}` : 'Waiting for approval'} tone="info"><p>Expires {new Date(step.approval.expiresAt).toLocaleString()}</p>{step.approval.decidedBy && <p>Decided by {step.approval.decidedBy === 'timeout' ? 'timeout policy' : step.approval.decidedById ?? 'a person'}</p>}</Callout>}
    {!!step.toolCalls.length && <div><h3 className="mb-2 text-sm font-semibold">Tool outcomes</h3>{step.toolCalls.map(call => <div key={call.executionId} className="mb-2 flex flex-wrap gap-2 rounded-lg bg-well p-3 text-xs"><strong>{call.tool}</strong><Badge tone={call.status === 'ok' ? 'success' : 'danger'}>{call.status}</Badge><span>{call.durationMs} ms</span><span>{call.code ?? call.reason}</span></div>)}</div>}
    <RunContent runId={runId} stepId={step.id} />
  </div>;
}
function RunGraph({ run, onSelect }: { run: RunDetail; onSelect: (id: string) => void }) {
  const ws = useWorkspace();
  const graph = useQuery({ queryKey: ['ws', ws.id, 'workflow', run.workflowId, 'run-graph', run.workflowVersion], queryFn: ({ signal }) => { const [path, ctx] = workspacePath(ws.id, `/workflows/${run.workflowId}/versions/${run.workflowVersion}`); return call<{ graph: { nodes: Array<{ id: string; type: string; label?: string; position?: { x: number; y: number } }>; edges: Array<{ id: string; source: string; target: string; sourceHandle?: string }> } }>(path, { ...ctx, signal }); }, staleTime: Infinity });
  if (!graph.data) return null;
  const nodes = graph.data.graph.nodes.map((node, index) => {
    const step = run.steps.filter(step => step.nodeId === node.id).sort((a, b) => b.iteration - a.iteration)[0];
    const border = !step ? '#d4d0c7' : step.status === 'SUCCEEDED' ? '#36846a' : step.status === 'FAILED' ? '#d2472f' : step.status === 'WAITING_APPROVAL' ? '#b8851e' : '#8c9792';
    return { id: node.id, position: node.position ?? { x: index * 240, y: 0 }, data: { label: <div className="grid gap-1 text-xs"><strong>{node.label ?? node.id}</strong><span>{node.type}{step ? ` · #${step.iteration}` : ''}</span>{step && <RunStatusBadge status={step.status} />}</div> }, style: { border: `2px solid ${border}`, borderRadius: 12, background: '#fffefa', width: 190 }, selectable: !!step };
  });
  const edges = graph.data.graph.edges.map(edge => {
    const taken = run.steps.some(step => step.nodeId === edge.source && step.handles.includes(edge.sourceHandle ?? 'out'));
    return { id: edge.id, source: edge.source, target: edge.target, label: edge.sourceHandle ?? 'out', animated: isRunActive(run.status) && taken, style: { stroke: taken ? '#36846a' : '#d4d0c7', strokeWidth: taken ? 2 : 1 } };
  });
  return <div className="hidden h-72 overflow-hidden rounded-xl border border-line bg-[#fbfaf7] sm:block" aria-label="Workflow execution graph"><ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} nodesConnectable={false} onNodeClick={(_, node) => { const step = run.steps.filter(step => step.nodeId === node.id).sort((a, b) => b.iteration - a.iteration)[0]; if (step) onSelect(step.id); }}><Background /><Controls showInteractive={false} /></ReactFlow></div>;
}
function RunTracePanel({ runId }: { runId: string }) {
  const ws = useWorkspace(); const trace = useQuery({ queryKey: ['ws', ws.id, 'run-trace', runId], queryFn: ({ signal }) => runsApi.trace(ws.id, runId, signal), gcTime: 0 });
  if (trace.isPending) return <Spinner />;
  if (trace.isError) return <ErrorState compact error={trace.error} title="Trace unavailable" onRetry={() => void trace.refetch()} />;
  return <Card className="grid gap-4 p-5"><div className="flex items-center gap-2"><h2 className="font-semibold">Audit-derived trace</h2><Badge tone={trace.data.complete ? 'success' : 'warning'}>{trace.data.complete ? 'Complete' : 'Partial'}</Badge></div><p className="text-xs text-muted">Reconstructed from the audit chain. The trace survives deletion of the run.</p>{trace.data.problems.length > 0 && <Callout tone="warning" title="Trace gaps">{trace.data.problems.join('; ')}</Callout>}<pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-well p-4 text-xs">{JSON.stringify(trace.data.trace, null, 2)}</pre></Card>;
}
