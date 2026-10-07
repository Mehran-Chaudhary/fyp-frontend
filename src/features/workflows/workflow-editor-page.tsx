import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Background, BackgroundVariant, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, type Connection, type Edge, type Node, type NodeChange, type NodeProps, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Archive, ArrowLeft, ArrowRight, Bot, CheckCircle2, CircleAlert, Flag, GitBranch, History, Layers, ListChecks, PanelRightClose, Pencil, Play, Plus, Redo2, Save, Search, Settings2, ShieldCheck, Sparkles, Trash2, Undo2, Wrench, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { UnsavedChangesDialog } from '@/components/feedback/unsaved-changes-dialog';
import { useUnsavedChanges } from '@/components/feedback/use-unsaved-changes';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FormError } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Pagination } from '@/components/ui/pagination';
import { RelativeTime } from '@/components/ui/relative-time';
import { Select } from '@/components/ui/select';
import { RunStartDialog } from '@/features/runs/run-start-dialog';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { ApiError } from '@/lib/api/errors';
import { workflowKeys, workflowsApi } from '@/lib/api/workflows';
import { useDocumentTitle } from '@/lib/hooks';
import { toast, toastError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { canLoop, defaultNodeData, jsonDraftErrors, loopBodyExecutions, nextNodeId, normalizeGraph, settingsErrors, sourceHandles } from '@/lib/workflows/graph';
import type { ConditionRule, GraphEdge, GraphIssue, GraphNode, NodeTypeDescriptor, Workflow, WorkflowGraph, WorkflowNodeType, WorkflowSettings, WorkflowVersion } from '@/lib/workflows/types';
import { NodeProperties, type JsonDrafts } from './node-properties';
import { useLiveValidation } from './use-live-validation';
import './workflow-canvas.css';

const icons = { trigger: Zap, agent: Bot, tool: Wrench, retrieval: Search, condition: GitBranch, supervisor: Sparkles, approval: ShieldCheck, output: Flag };
const colors = { trigger: '#36846a', agent: '#5d68bb', tool: '#b78238', retrieval: '#397d9c', condition: '#9270b1', supervisor: '#916534', approval: '#b26958', output: '#36846a' };
type CanvasNode = Node<{ node: GraphNode; descriptor?: NodeTypeDescriptor; errors: GraphIssue[]; warnings: GraphIssue[] }, 'workflow'>;
interface Draft { graph: WorkflowGraph; settings: WorkflowSettings }

function WorkflowCanvasNode({ data, selected }: NodeProps<CanvasNode>) {
  const { node, descriptor, errors, warnings } = data;
  const Icon = icons[node.type] ?? GitBranch;
  const handles = sourceHandles(node, descriptor);
  const color = colors[node.type] ?? '#36846a';
  return <div className={cn('workflow-node w-[218px] rounded-xl border bg-surface shadow-card', selected ? 'border-brand-600 ring-2 ring-brand-100' : errors.length ? 'border-danger-500 ring-2 ring-danger-100' : 'border-line-strong')}>
    {node.type !== 'trigger' && <Handle type="target" position={Position.Left} aria-label={`${node.id} input`} />}
    <div className="flex items-start gap-2.5 p-3"><span className="rounded-lg p-2" style={{ backgroundColor: `${color}13`, color }}><Icon className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold">{node.label || descriptor?.label || node.type}</p><p className="mt-0.5 truncate font-mono text-[10px] text-muted">{node.id}</p></div>{errors.length ? <CircleAlert className="size-4 shrink-0 text-danger-600" aria-label={`${errors.length} validation errors`} /> : warnings.length ? <CircleAlert className="size-4 shrink-0 text-warning-600" aria-label={`${warnings.length} warnings`} /> : null}</div>
    {handles.length > 0 && <div className="border-t border-line py-1.5">{handles.map((handle) => <div key={handle} className="relative flex h-6 items-center justify-end px-4 text-[10px] text-muted"><span className={handle === 'error' || handle === 'rejected' ? 'text-danger-600' : undefined}>{handle}</span><Handle type="source" id={handle} position={Position.Right} style={{ top: '50%', background: handle === 'error' || handle === 'rejected' ? '#c45b47' : color }} aria-label={`${node.id} ${handle} output`} /></div>)}</div>}
    {errors.length > 0 && <p className="border-t border-danger-100 bg-danger-50 px-3 py-2 text-[10px] text-danger-700">{errors[0].message}</p>}
  </div>;
}
const nodeTypes = { workflow: WorkflowCanvasNode };

export function WorkflowEditorPage() {
  const workspace = useWorkspace();
  const can = useCan();
  const { workflowId = '' } = useParams();
  const query = useQuery({ queryKey: workflowKeys.detail(workspace.id, workflowId), enabled: can('workflow:read') && !!workflowId, queryFn: ({ signal }) => workflowsApi.get(workspace.id, workflowId, signal) });
  useDocumentTitle(query.data?.name ?? 'Workflow canvas');
  if (!can('workflow:read')) return <Card><NoAccessState permissions={['workflow:read']} workspaceName={workspace.name} title="You cannot read workflows" /></Card>;
  if (query.isPending) return <Skeleton className="h-[70vh] rounded-xl" />;
  if (query.isError && !query.data) return <Card><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Card>;
  return query.data ? <WorkflowEditor key={`${workspace.id}:${workflowId}`} source={query.data} /> : null;
}

function WorkflowEditor({ source }: { source: Workflow }) {
  const workspace = useWorkspace();
  const can = useCan();
  const client = useQueryClient();
  const navigate = useNavigate();
  const editable = can('workflow:update');
  const [workflow, setWorkflow] = useState(source);
  const [draft, setDraft] = useState<Draft>(() => ({ graph: structuredClone(source.definition.graph), settings: structuredClone(source.definition.settings) }));
  const [jsonDrafts, setJsonDrafts] = useState<JsonDrafts>({});
  const [changeNote, setChangeNote] = useState('');
  const [selection, setSelection] = useState<{ nodeId?: string; edgeId?: string }>({});
  const [panel, setPanel] = useState<'properties' | 'versions' | 'settings'>('properties');
  const [showPalette, setShowPalette] = useState(false);
  const [flow, setFlow] = useState<ReactFlowInstance<CanvasNode, Edge> | null>(null);
  const [undo, setUndo] = useState<Draft[]>([]);
  const [redo, setRedo] = useState<Draft[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [conflict, setConflict] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<{ type: 'archive' | 'delete' | 'restore' | 'discard'; version?: number } | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [showIssues, setShowIssues] = useState(true);
  const [connectSource, setConnectSource] = useState('');
  const [connectTarget, setConnectTarget] = useState('');
  const [connectHandle, setConnectHandle] = useState('out');
  const descriptors = useQuery({ queryKey: [...workflowKeys.all(workspace.id), 'node-types'], queryFn: ({ signal }) => workflowsApi.nodeTypes(workspace.id, signal), staleTime: Infinity });
  const invalidJson = jsonDraftErrors(jsonDrafts);
  const invalidSettings = settingsErrors(draft.settings);
  const hasInvalidSettings = Object.keys(invalidSettings).length > 0;
  const dirty = JSON.stringify(draft) !== JSON.stringify({ graph: workflow.definition.graph, settings: workflow.definition.settings }) || invalidJson.length > 0;
  const newer = source.currentVersion !== workflow.currentVersion;
  const { blocker, allowNavigation } = useUnsavedChanges(dirty);
  const validation = useLiveValidation(workspace.id, draft.graph, editable || can('workflow:create'), workflow.definition.validation);
  const report = validation.report;
  const selectedNode = draft.graph.nodes.find((node) => node.id === selection.nodeId);
  const selectedEdge = draft.graph.edges.find((edge) => edge.id === selection.edgeId);
  const descriptorFor = useCallback((type: WorkflowNodeType) => descriptors.data?.nodeTypes.find((descriptor) => descriptor.type === type), [descriptors.data]);
  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; }, [draft]);

  const edit = (next: Draft, history = true) => {
    if (!editable || busy) return;
    if (history) { setUndo((previous) => [...previous.slice(-39), draftRef.current]); setRedo([]); }
    setDraft(next);
    draftRef.current = next;
  };
  const editGraph = (graph: WorkflowGraph, history = true) => edit({ ...draftRef.current, graph }, history);
  const adopt = (next: Workflow) => {
    setWorkflow(next);
    const nextDraft = { graph: structuredClone(next.definition.graph), settings: structuredClone(next.definition.settings) };
    setDraft(nextDraft); draftRef.current = nextDraft;
    setJsonDrafts({}); setUndo([]); setRedo([]); setConflict(null); setChangeNote(''); setFailure(null);
    client.setQueryData(workflowKeys.detail(workspace.id, next.id), next);
    if (next.definition.graph.viewport) void flow?.setViewport(next.definition.graph.viewport);
  };
  const refresh = () => {
    void client.invalidateQueries({ queryKey: workflowKeys.all(workspace.id) });
    void client.invalidateQueries({ queryKey: ['ws', workspace.id, 'workflow-runs'] });
  };
  const reload = async () => {
    setBusy('reload');
    try { adopt(await workflowsApi.get(workspace.id, workflow.id)); } catch (error) { toastError(error); }
    finally { setBusy(null); setConfirm(null); }
  };
  const save = async (expectedVersion = workflow.currentVersion) => {
    if (busy || invalidJson.length || hasInvalidSettings) return;
    setBusy('save'); setFailure(null);
    try {
      const next = await workflowsApi.save(workspace.id, workflow.id, { graph: normalizeGraph(draft.graph), settings: draft.settings, expectedVersion, ...(changeNote.trim() ? { changeNote: changeNote.trim() } : {}) });
      adopt(next); refresh(); setSaveOpen(false);
      toast.success(next.definition.valid ? `Saved version ${next.currentVersion}` : `Saved as a draft with ${next.definition.validation.errors.length} problems`);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'WORKFLOW_VERSION_CONFLICT') {
        setConflict(typeof error.details?.currentVersion === 'number' ? error.details.currentVersion : null);
        if (typeof error.details?.currentVersion !== 'number') {
          try { const latest = await workflowsApi.get(workspace.id, workflow.id); setConflict(latest.currentVersion); } catch { setFailure('A newer version exists. Reload it before saving.'); }
        }
        setSaveOpen(false);
      } else { setFailure(error instanceof Error ? error.message : 'The workflow could not be saved.'); toastError(error); }
    } finally { setBusy(null); }
  };
  const action = async (type: 'publish' | 'archive' | 'delete' | 'restore', version = workflow.currentVersion) => {
    if (busy) return;
    setBusy(type); setFailure(null);
    try {
      if (type === 'delete') {
        await workflowsApi.delete(workspace.id, workflow.id);
        client.removeQueries({ queryKey: workflowKeys.detail(workspace.id, workflow.id) });
        client.removeQueries({ queryKey: workflowKeys.versions(workspace.id, workflow.id) });
        refresh(); allowNavigation(); navigate(`/w/${workspace.slug}/workflows`); toast.success('Workflow deleted'); return;
      }
      const next = type === 'publish' ? await workflowsApi.publish(workspace.id, workflow.id, version) : type === 'archive' ? await workflowsApi.archive(workspace.id, workflow.id) : await workflowsApi.restore(workspace.id, workflow.id, version);
      if (type === 'restore') adopt(next); else { setWorkflow((current) => ({ ...next, currentVersion: current.currentVersion, definition: current.definition })); client.setQueryData(workflowKeys.detail(workspace.id, workflow.id), next); }
      refresh(); setConfirm(null);
      toast.success(type === 'publish' ? `Version ${version} is published` : type === 'archive' ? 'Workflow archived' : `Version ${version} restored as version ${next.currentVersion}`);
    } catch (error) {
      const issues = error instanceof ApiError && Array.isArray(error.details?.errors) ? (error.details.errors as GraphIssue[]).map((issue) => issue.message).join(' ') : '';
      setFailure(`${error instanceof Error ? error.message : 'The operation failed.'}${issues ? ` ${issues}` : ''}`);
      toastError(error);
    } finally { setBusy(null); }
  };

  const addNode = (descriptor: NodeTypeDescriptor) => {
    const graph = draftRef.current.graph;
    if (graph.nodes.length >= 50 || (!descriptor.multiple && graph.nodes.some((node) => node.type === descriptor.type))) return;
    const position = flow ? flow.screenToFlowPosition({ x: window.innerWidth * 0.5, y: window.innerHeight * 0.43 }) : { x: 220 + graph.nodes.length * 40, y: 160 + graph.nodes.length * 30 };
    const node: GraphNode = { id: nextNodeId(descriptor.type, graph.nodes), type: descriptor.type, position, data: defaultNodeData(descriptor.type) };
    editGraph({ ...graph, nodes: [...graph.nodes, node] }); setSelection({ nodeId: node.id }); setPanel('properties'); setShowPalette(false);
  };
  const connect = (connection: Connection) => {
    if (!editable || !connection.source || !connection.target || draftRef.current.graph.edges.length >= 150) return;
    const graph = draftRef.current.graph;
    if (graph.edges.some((edge) => edge.source === connection.source && edge.target === connection.target && (edge.sourceHandle ?? 'out') === (connection.sourceHandle ?? 'out'))) { toast.info('These steps are already connected by that outcome.'); return; }
    const edge: GraphEdge = { id: `edge_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`, source: connection.source, target: connection.target, ...(connection.sourceHandle && connection.sourceHandle !== 'out' ? { sourceHandle: connection.sourceHandle } : {}) };
    if (canLoop(graph, { ...edge, sourceHandle: edge.sourceHandle ?? 'out' })) edge.data = { loop: { maxIterations: 2, onExhausted: 'fall_through' } };
    editGraph({ ...graph, edges: [...graph.edges, edge] }); setSelection({ edgeId: edge.id }); setPanel('properties');
  };
  const updateNode = (node: GraphNode) => {
    const previous = draft.graph.nodes.find((item) => item.id === node.id);
    let edges = draft.graph.edges;
    if (node.type === 'condition' && previous) {
      const oldRules = (previous.data.rules ?? []) as ConditionRule[];
      const newRules = (node.data.rules ?? []) as ConditionRule[];
      // Stable rule edits preserve connected outcomes; deletions remain visible to validation.
      if (oldRules.length === newRules.length) edges = edges.map((edge) => {
        const index = oldRules.findIndex((rule) => rule.id === edge.sourceHandle);
        return edge.source === node.id && index >= 0 ? { ...edge, sourceHandle: newRules[index].id } : edge;
      });
    }
    editGraph({ ...draft.graph, nodes: draft.graph.nodes.map((item) => item.id === node.id ? node : item), edges });
  };
  const deleteSelection = () => {
    if (selectedNode) {
      editGraph({ ...draft.graph, nodes: draft.graph.nodes.filter((node) => node.id !== selectedNode.id), edges: draft.graph.edges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id) });
      setJsonDrafts((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith(`${selectedNode.id}:`))));
    } else if (selectedEdge) editGraph({ ...draft.graph, edges: draft.graph.edges.filter((edge) => edge.id !== selectedEdge.id) });
    setSelection({});
  };
  const changeNodes = (changes: NodeChange<CanvasNode>[]) => {
    if (!editable || busy) return;
    const positions = changes.filter((change) => change.type === 'position');
    if (!positions.length) return;
    const graph = draftRef.current.graph;
    const nodes = graph.nodes.map((node) => { const change = positions.find((item) => item.id === node.id); return change?.position ? { ...node, position: change.position } : node; });
    editGraph({ ...graph, nodes }, false);
  };
  const flowNodes = useMemo<CanvasNode[]>(() => draft.graph.nodes.map((node, index) => ({
    id: node.id, type: 'workflow', position: node.position ?? { x: index * 280, y: 100 }, selected: selection.nodeId === node.id,
    data: { node, descriptor: descriptorFor(node.type), errors: report.errors.filter((issue) => issue.nodeId === node.id), warnings: report.warnings.filter((issue) => issue.nodeId === node.id) },
  })), [draft.graph.nodes, selection.nodeId, descriptorFor, report]);
  const flowEdges = useMemo<Edge[]>(() => draft.graph.edges.map((edge) => ({ ...edge, sourceHandle: edge.sourceHandle ?? 'out', selected: selection.edgeId === edge.id, markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 }, label: edge.data?.loop ? `↻ ${edge.data.loop.maxIterations} repeats · ${edge.data.loop.onExhausted === 'fail' ? 'fail' : 'fall through'}` : edge.sourceHandle === 'out' || !edge.sourceHandle ? undefined : edge.sourceHandle,
    type: 'smoothstep', style: { strokeWidth: selection.edgeId === edge.id ? 3 : 1.6, stroke: report.errors.some((issue) => issue.edgeId === edge.id) ? '#c4472f' : edge.data?.loop ? '#9270b1' : edge.sourceHandle === 'error' || edge.sourceHandle === 'rejected' ? '#c45b47' : '#7a9489', strokeDasharray: edge.data?.loop || edge.sourceHandle === 'error' ? '6 4' : undefined },
  })), [draft.graph.edges, selection.edgeId, report.errors]);

  return <div className="space-y-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><Link to={`/w/${workspace.slug}/workflows`} className="mb-2 inline-flex items-center gap-1 text-xs text-muted hover:text-brand-700"><ArrowLeft className="size-3" />Workflows</Link><div className="flex flex-wrap items-center gap-2"><h1 className="max-w-[34rem] truncate text-xl font-semibold tracking-tight">{workflow.name}</h1><Badge tone={workflow.status === 'ACTIVE' ? 'success' : workflow.status === 'DRAFT' ? 'warning' : 'neutral'}>{workflow.status === 'ACTIVE' ? 'Published' : workflow.status === 'DRAFT' ? 'Draft' : 'Archived'}</Badge>{editable && <Button size="icon-xs" variant="ghost" aria-label="Rename workflow" onClick={() => setRenameOpen(true)}><Pencil /></Button>}</div><p className="mt-1 text-xs text-muted">Current v{workflow.currentVersion}{workflow.publishedVersion !== null ? ` · Published v${workflow.publishedVersion}` : ''} · {dirty ? 'Unsaved changes' : 'All changes saved'}</p></div>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button size="sm" variant={panel === 'versions' ? 'subtle' : 'secondary'} onClick={() => setPanel(panel === 'versions' ? 'properties' : 'versions')}><History />Versions</Button>
        <Button size="icon-sm" variant={panel === 'settings' ? 'subtle' : 'secondary'} aria-label="Workflow settings" onClick={() => setPanel(panel === 'settings' ? 'properties' : 'settings')}><Settings2 /></Button>
        {can('workflow:execute') && <Button size="sm" variant="secondary" onClick={() => setRunOpen(true)} disabled={!!busy || dirty} title={dirty ? 'Save or discard your canvas changes before running.' : undefined}><Play />Run</Button>}
        {can('workflow:publish') && <Button size="sm" variant="secondary" disabled={!!busy || dirty || !workflow.definition.valid || workflow.publishedVersion === workflow.currentVersion && workflow.status === 'ACTIVE'} title={dirty ? 'Save the current changes before publishing.' : !workflow.definition.valid ? 'Fix the validation errors before publishing.' : undefined} onClick={() => void action('publish')}><ArrowUpRightIcon />Publish v{workflow.currentVersion}</Button>}
        {editable && <Button size="sm" onClick={() => setSaveOpen(true)} disabled={!!busy || !dirty || invalidJson.length > 0 || hasInvalidSettings} title={invalidJson.length ? 'Finish the JSON fields before saving.' : hasInvalidSettings ? 'Fix the limits in workflow settings before saving.' : undefined}><Save />Save draft</Button>}
      </div>
    </div>
    {!editable && <p className="rounded-lg border border-line bg-well px-3 py-2 text-xs text-muted">Read-only canvas. Editing requires workflow:update.</p>}
    {(newer || conflict !== null) && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning-200 bg-warning-50 p-3 text-xs text-warning-700"><span>A newer version exists: v{conflict ?? source.currentVersion}. Your unsaved work is still here.</span><div className="flex gap-2"><Button size="xs" variant="secondary" disabled={!!busy} onClick={() => dirty ? setConfirm({ type: 'discard' }) : void reload()}>Reload theirs</Button>{editable && dirty && <Button size="xs" disabled={!!busy || !!invalidJson.length || hasInvalidSettings} onClick={() => void save(conflict ?? source.currentVersion)}>Keep mine and save on top</Button>}</div></div>}
    <FormError message={failure ?? undefined} />
    {invalidJson.length > 0 && <div className="rounded-lg border border-danger-200 bg-danger-50 p-3 text-xs text-danger-700">Complete JSON in {invalidJson.map(([name]) => name).join(', ')} before saving. The incomplete text is kept in memory.</div>}
    {hasInvalidSettings && <div className="rounded-lg border border-danger-200 bg-danger-50 p-3 text-xs text-danger-700">Fix workflow limits before saving. {Object.values(invalidSettings).join(' ')}<Button size="xs" variant="ghost" onClick={() => setPanel('settings')}>Open settings</Button></div>}
    <div className="workflow-canvas grid min-h-[620px] overflow-hidden rounded-xl border border-line bg-surface shadow-card lg:h-[calc(100dvh-245px)] lg:min-h-[600px] lg:grid-cols-[170px_minmax(250px,1fr)_310px]">
      <aside className={cn('border-b border-line bg-well/40 p-3 lg:block lg:overflow-y-auto lg:border-r lg:border-b-0', showPalette ? 'block' : 'hidden')} aria-label="Node palette"><div className="mb-3 flex items-center justify-between"><h2 className="text-[11px] font-semibold tracking-wider text-muted uppercase">Add a step</h2><Badge tone="outline">{draft.graph.nodes.length}/50</Badge></div>{descriptors.isPending ? <Skeleton className="h-64" /> : descriptors.isError ? <ErrorState compact error={descriptors.error} onRetry={() => void descriptors.refetch()} /> : <div className="space-y-1.5">{descriptors.data.nodeTypes.map((descriptor) => { const Icon = icons[descriptor.type] ?? GitBranch; const disabled = !editable || !!busy || draft.graph.nodes.length >= 50 || !descriptor.multiple && draft.graph.nodes.some((node) => node.type === descriptor.type); return <button type="button" key={descriptor.type} disabled={disabled} onClick={() => addNode(descriptor)} title={descriptor.description} className="flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-3 text-left text-xs transition hover:border-line hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"><Icon className="size-4 shrink-0" style={{ color: colors[descriptor.type] }} /><span className="font-medium">{descriptor.label}</span><Plus className="ml-auto size-3 text-faint" /></button>; })}</div>}<p className="mt-5 text-[11px] leading-relaxed text-muted">Connect an outcome on the right of a step to an input on the left. Select a step to configure it.</p><div className="mt-5 space-y-2 border-t border-line pt-3 text-[11px] text-muted"><p className="flex items-center gap-2"><span className="h-px w-5 bg-[#7a9489]" /> Normal path</p><p className="flex items-center gap-2"><span className="h-px w-5 border-t border-dashed border-[#c45b47]" /> Error recovery</p><p className="flex items-center gap-2"><span className="h-px w-5 border-t border-dashed border-[#9270b1]" /> Bounded loop</p></div></aside>
      <section className="relative flex min-w-0 flex-col" aria-label="Workflow graph">
        <div className="z-10 flex min-h-11 flex-wrap items-center gap-1.5 border-b border-line bg-surface px-2"><Button size="icon-xs" variant="ghost" className="lg:hidden" aria-label="Toggle node palette" onClick={() => setShowPalette(!showPalette)}><Plus /></Button><Button size="icon-xs" variant="ghost" aria-label="Undo canvas edit" disabled={!editable || !undo.length || !!busy} onClick={() => { const previous = undo.at(-1); if (previous) { setRedo((history) => [...history, draft]); setUndo((history) => history.slice(0, -1)); setDraft(previous); draftRef.current = previous; setJsonDrafts({}); } }}><Undo2 /></Button><Button size="icon-xs" variant="ghost" aria-label="Redo canvas edit" disabled={!editable || !redo.length || !!busy} onClick={() => { const next = redo.at(-1); if (next) { setUndo((history) => [...history, draft]); setRedo((history) => history.slice(0, -1)); setDraft(next); draftRef.current = next; setJsonDrafts({}); } }}><Redo2 /></Button><span className="mx-1 h-4 border-l border-line" /><span className="text-[11px] text-muted">{draft.graph.nodes.length} steps · {draft.graph.edges.length} connections</span><Button className="ml-auto" size="xs" variant="ghost" onClick={() => setShowIssues(!showIssues)}><ListChecks />{validation.pending ? 'Checking…' : report.valid ? 'Valid' : `${report.errors.length} issues`}</Button></div>
        <div className="min-h-[440px] flex-1"><ReactFlow<CanvasNode, Edge> nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} onInit={setFlow} onNodesChange={changeNodes} onConnect={connect} onNodeDragStart={() => { setUndo((previous) => [...previous.slice(-39), draftRef.current]); setRedo([]); }} onNodeClick={(_, node) => { setSelection({ nodeId: node.id }); setPanel('properties'); }} onEdgeClick={(_, edge) => { setSelection({ edgeId: edge.id }); setPanel('properties'); }} onPaneClick={() => setSelection({})} onMoveEnd={(event, viewport) => { if (event && editable && !busy) editGraph({ ...draftRef.current.graph, viewport }, false); }} nodesDraggable={editable && !busy} nodesConnectable={editable && !busy} elementsSelectable deleteKeyCode={null} fitView={!draft.graph.viewport} defaultViewport={draft.graph.viewport} minZoom={0.25} maxZoom={1.75} fitViewOptions={{ padding: 0.25 }} proOptions={{ hideAttribution: true }}>
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#d5d5cd" /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor={(node) => colors[(node.data as CanvasNode['data']).node.type]} className="!h-24 !w-32" /></ReactFlow></div>
        {showIssues && <div className="max-h-44 overflow-y-auto border-t border-line bg-surface p-3" aria-live="polite"><div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="flex items-center gap-1.5 font-medium">{report.valid ? <CheckCircle2 className="size-3.5 text-success-600" /> : <CircleAlert className="size-3.5 text-danger-600" />}{validation.pending ? 'Validating current changes…' : validation.error ? 'Validation unavailable' : report.valid ? 'Graph is valid' : `${report.errors.length} problems to resolve`}</span><span className="text-muted">Worst case: {report.stepBound ?? 'unknown'} / {draft.settings.maxSteps ?? 'platform limit'} steps</span></div>{validation.error && <p className="mt-2 text-xs text-danger-700">{validation.error.message}<Button size="xs" variant="ghost" onClick={validation.retry}>Retry</Button></p>}{[...report.errors.map((issue) => ({ issue, warning: false })), ...report.warnings.map((issue) => ({ issue, warning: true }))].map(({ issue, warning }, index) => <button key={`${issue.code}-${index}`} type="button" onClick={() => { setSelection({ nodeId: issue.nodeId, edgeId: issue.edgeId }); setPanel('properties'); if (issue.nodeId) void flow?.fitView({ nodes: [{ id: issue.nodeId }], maxZoom: 1, duration: 250 }); }} className={cn('mt-2 block w-full rounded-md p-2 text-left text-[11px]', warning ? 'bg-warning-50 text-warning-700' : 'bg-danger-50 text-danger-700')}><strong>{warning ? 'Warning' : issue.nodeId || issue.edgeId || 'Graph'} · {issue.code}</strong><span className="mt-0.5 block">{issue.message}</span></button>)}</div>}
      </section>
      <aside className="max-h-[620px] overflow-y-auto border-t border-line bg-surface lg:max-h-none lg:border-t-0 lg:border-l" aria-label="Workflow inspector">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-4 py-3"><h2 className="text-xs font-semibold">{panel === 'versions' ? 'Version history' : panel === 'settings' ? 'Workflow settings' : selectedNode ? 'Step properties' : selectedEdge ? 'Connection properties' : 'Your canvas'}</h2>{panel !== 'properties' && <Button size="icon-xs" variant="ghost" aria-label="Back to properties" onClick={() => setPanel('properties')}><PanelRightClose /></Button>}</div>
        <div className="p-4">{panel === 'versions' ? <VersionsPanel workflow={workflow} busy={!!busy} dirty={dirty} onRestore={(version) => setConfirm({ type: 'restore', version })} onPublish={(version) => void action('publish', version)} /> : panel === 'settings' ? <div className="space-y-5"><p className="text-xs leading-relaxed text-muted">Optional limits can lower the platform ceilings. The server applies its configured ceiling to larger values. Limits are saved with the next version.</p><fieldset disabled={!editable || !!busy} className="space-y-4">{([{ key: 'maxSteps', label: 'Maximum steps', min: 2, max: 10000 }, { key: 'maxTokens', label: 'Maximum tokens', min: 1000, max: 100000000 }, { key: 'runTimeoutMs', label: 'Run timeout (milliseconds)', min: 1000, max: undefined }] as const).map((field) => <Field key={field.key} label={field.label} optional error={invalidSettings[field.key]}><Input type="number" min={field.min} max={field.max} step={1} value={draft.settings[field.key] ?? ''} placeholder="Platform default" onChange={(event) => { const settings = { ...draft.settings }; if (event.target.value) settings[field.key] = Number(event.target.value); else delete settings[field.key]; edit({ ...draft, settings }); }} /></Field>)}</fieldset><div className="space-y-3 border-t border-line pt-4">{can('workflow:publish') && workflow.status !== 'ARCHIVED' && <Button variant="secondary" size="sm" className="w-full" onClick={() => setConfirm({ type: 'archive' })}><Archive />Archive workflow</Button>}{can('workflow:delete') && <Button variant="danger-outline" size="sm" className="w-full" onClick={() => setConfirm({ type: 'delete' })}><Trash2 />Delete workflow</Button>}<p className="text-xs text-muted">Archiving blocks new published runs. Deleting also cancels active runs. Run history stays available.</p></div></div> : selectedNode ? <><fieldset disabled={!editable || !!busy}><NodeProperties node={selectedNode} descriptor={descriptorFor(selectedNode.type)} graph={draft.graph} onChange={updateNode} drafts={jsonDrafts} onDraft={(key, text) => setJsonDrafts((previous) => ({ ...previous, [key]: text }))} /></fieldset>{editable && <Button className="mt-6 w-full" variant="danger-outline" size="sm" onClick={deleteSelection}><Trash2 />Remove step</Button>}</> : selectedEdge ? <fieldset disabled={!editable || !!busy}><EdgeProperties edge={selectedEdge} graph={draft.graph} descriptorFor={descriptorFor} onChange={(edge) => editGraph({ ...draft.graph, edges: draft.graph.edges.map((item) => item.id === edge.id ? edge : item) })} /><Button className="mt-6 w-full" variant="danger-outline" size="sm" onClick={deleteSelection}><Trash2 />Remove connection</Button></fieldset> : <div className="space-y-6"><EmptyState className="px-0 py-4" icon={<Layers />} title="Every step, connected" description="Choose a step or connection on the canvas to inspect and configure it." />{editable && <details className="rounded-lg border border-line p-3"><summary className="cursor-pointer text-xs font-medium">Connect steps with the keyboard</summary><div className="mt-3 space-y-3"><Field label="From step"><Select value={connectSource || undefined} placeholder="Choose source" options={draft.graph.nodes.filter((node) => node.type !== 'output').map((node) => ({ value: node.id, label: node.label || node.id }))} onValueChange={(value) => { setConnectSource(value); const node = draft.graph.nodes.find((item) => item.id === value); setConnectHandle(node ? sourceHandles(node, descriptorFor(node.type))[0] ?? 'out' : 'out'); }} /></Field><Field label="Outcome"><Select value={connectHandle} options={(draft.graph.nodes.find((node) => node.id === connectSource) ? sourceHandles(draft.graph.nodes.find((node) => node.id === connectSource)!, descriptorFor(draft.graph.nodes.find((node) => node.id === connectSource)!.type)) : ['out']).map((handle) => ({ value: handle, label: handle }))} onValueChange={setConnectHandle} /></Field><Field label="To step"><Select value={connectTarget || undefined} placeholder="Choose target" options={draft.graph.nodes.filter((node) => node.type !== 'trigger').map((node) => ({ value: node.id, label: node.label || node.id }))} onValueChange={setConnectTarget} /></Field><Button size="sm" className="w-full" disabled={!connectSource || !connectTarget} onClick={() => connect({ source: connectSource, target: connectTarget, sourceHandle: connectHandle, targetHandle: null })}><ArrowRight />Connect</Button></div></details>}<Link className="flex items-center justify-center gap-2 text-xs text-brand-700 hover:underline" to={`/w/${workspace.slug}/runs?workflowId=${workflow.id}`}><History className="size-3.5" />View runs of this workflow</Link></div>}</div>
      </aside>
    </div>
    <UnsavedChangesDialog blocker={blocker} />
    <Dialog open={saveOpen} onOpenChange={(open) => !busy && setSaveOpen(open)}><DialogContent><DialogHeader title="Save workflow version" description={report.valid ? 'Save a new version. Your published version and active runs stay pinned until you publish.' : 'Invalid graphs can be saved as drafts. Resolve the issues before publishing or running this version.'} /><DialogBody><Field label="Change note" optional><Textarea maxLength={500} value={changeNote} onChange={(event) => setChangeNote(event.target.value)} placeholder="What changed in this version?" /></Field><FormError className="mt-3" message={failure ?? undefined} /></DialogBody><DialogFooter><Button variant="secondary" onClick={() => setSaveOpen(false)} disabled={!!busy}>Cancel</Button><Button loading={busy === 'save'} disabled={!!invalidJson.length || hasInvalidSettings} onClick={() => void save()}>Save version</Button></DialogFooter></DialogContent></Dialog>
    <ConfirmDialog open={confirm !== null} onOpenChange={(open) => { if (!open) { setConfirm(null); setFailure(null); } }} title={confirm?.type === 'delete' ? 'Delete this workflow?' : confirm?.type === 'archive' ? 'Archive this workflow?' : confirm?.type === 'restore' ? `Restore version ${confirm.version}?` : 'Discard your changes?'} description={confirm?.type === 'delete' ? 'Runs in progress are cancelled. Run history stays.' : confirm?.type === 'archive' ? 'Members can no longer run it; history stays.' : confirm?.type === 'restore' ? `This adds version ${workflow.currentVersion + 1}, identical to version ${confirm.version}.${dirty ? ' Your unsaved canvas edits will be discarded.' : ''}` : 'The latest server version will replace your unsaved canvas changes.'} confirmLabel={confirm?.type === 'delete' ? 'Delete workflow' : confirm?.type === 'archive' ? 'Archive workflow' : confirm?.type === 'restore' ? 'Restore as a new version' : 'Reload theirs'} tone={confirm?.type === 'delete' ? 'danger' : 'warning'} typeToConfirm={confirm?.type === 'delete' ? workflow.name : undefined} pending={!!busy} error={failure} onConfirm={() => { if (confirm?.type === 'discard') void reload(); else if (confirm) void action(confirm.type, confirm.version); }} />
    <RenameDialog key={`${renameOpen}:${workflow.name}`} open={renameOpen} onOpenChange={setRenameOpen} workflow={workflow} onSaved={(next) => { setWorkflow((current) => ({ ...next, currentVersion: current.currentVersion, definition: current.definition })); client.setQueryData(workflowKeys.detail(workspace.id, workflow.id), next); refresh(); }} />
    <RunStartDialog workflowId={workflow.id} publishedVersion={workflow.publishedVersion} latestVersion={workflow.currentVersion} open={runOpen} onOpenChange={setRunOpen} />
  </div>;
}

function ArrowUpRightIcon() { return <ArrowRight className="-rotate-45" />; }

function EdgeProperties({ edge, graph, descriptorFor, onChange }: { edge: GraphEdge; graph: WorkflowGraph; descriptorFor: (type: WorkflowNodeType) => NodeTypeDescriptor | undefined; onChange: (edge: GraphEdge) => void }) {
  const source = graph.nodes.find((node) => node.id === edge.source);
  const handles = source ? sourceHandles(source, descriptorFor(source.type)) : [];
  const loopAllowed = canLoop(graph, { ...edge, sourceHandle: edge.sourceHandle ?? 'out' });
  return <div className="space-y-4"><div className="rounded-lg bg-well p-3 text-xs"><strong className="break-all">{edge.source}</strong><ArrowRight className="my-1 size-3 text-muted" /><strong className="break-all">{edge.target}</strong></div><Field label="Source outcome"><Select value={edge.sourceHandle ?? 'out'} onValueChange={(sourceHandle) => onChange({ ...edge, sourceHandle, data: undefined })} options={handles.filter(Boolean).map((handle) => ({ value: handle, label: handle }))} /></Field><label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={!!edge.data?.loop} disabled={!loopAllowed && !edge.data?.loop} onChange={(event) => onChange({ ...edge, data: event.target.checked ? { loop: { maxIterations: 2, onExhausted: 'fall_through' } } : undefined })} /><span>Bounded loop<span className="mt-1 block text-muted">Only a condition rule may return to an earlier step.</span></span></label>{edge.data?.loop && <><Field label="Maximum repeats" hint={`The body runs at most ${loopBodyExecutions(edge.data.loop.maxIterations)} times, including the first pass.`}><Input type="number" min={1} max={100} step={1} value={edge.data.loop.maxIterations} onChange={(event) => onChange({ ...edge, data: { loop: { ...edge.data!.loop!, maxIterations: Number(event.target.value) } } })} /></Field><Field label="When repeats are exhausted"><Select value={edge.data.loop.onExhausted ?? 'fall_through'} onValueChange={(value) => onChange({ ...edge, data: { loop: { ...edge.data!.loop!, onExhausted: value as 'fail' | 'fall_through' } } })} options={[{ value: 'fall_through', label: 'Continue on the else path' }, { value: 'fail', label: 'Fail the run' }]} /></Field></>}<p className="text-[11px] text-muted">Error paths recover from a permanently failed step. Ordinary cycles are invalid.</p></div>;
}

function RenameDialog({ workflow, open, onOpenChange, onSaved }: { workflow: Workflow; open: boolean; onOpenChange: (value: boolean) => void; onSaved: (workflow: Workflow) => void }) {
  const workspace = useWorkspace();
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async () => { setBusy(true); setError(undefined); try { const next = await workflowsApi.update(workspace.id, workflow.id, { name: name.trim(), description: description.trim() || null }); onSaved(next); onOpenChange(false); toast.success('Workflow details updated'); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Details could not be saved.'); } finally { setBusy(false); } };
  return <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}><DialogContent><DialogHeader title="Workflow details" description="Names and descriptions change in place without creating a version." /><form onSubmit={(event) => { event.preventDefault(); void submit(); }}><DialogBody className="space-y-4"><Field label="Name"><Input value={name} maxLength={80} required onChange={(event) => setName(event.target.value)} /></Field><Field label="Description" optional><Textarea value={description} maxLength={2000} onChange={(event) => setDescription(event.target.value)} /></Field><FormError message={error} /></DialogBody><DialogFooter><Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={busy} disabled={!name.trim()}>Save details</Button></DialogFooter></form></DialogContent></Dialog>;
}

function VersionsPanel({ workflow, busy, dirty, onRestore, onPublish }: { workflow: Workflow; busy: boolean; dirty: boolean; onRestore: (version: number) => void; onPublish: (version: number) => void }) {
  const workspace = useWorkspace();
  const can = useCan();
  const [page, setPage] = useState(1);
  const [inspect, setInspect] = useState<number | null>(null);
  const query = useQuery({ queryKey: [...workflowKeys.versions(workspace.id, workflow.id), page], queryFn: ({ signal }) => workflowsApi.versions(workspace.id, workflow.id, page, signal) });
  const detail = useQuery({ queryKey: workflowKeys.version(workspace.id, workflow.id, inspect ?? 0), queryFn: ({ signal }) => workflowsApi.version(workspace.id, workflow.id, inspect!, signal), enabled: inspect !== null, staleTime: Infinity });
  if (query.isPending) return <Skeleton className="h-64" />;
  if (query.isError) return <ErrorState compact error={query.error} onRetry={() => void query.refetch()} />;
  return <div className="space-y-4"><p className="text-xs text-muted">Append-only history. Restore adds a copy; publish an older version to roll back.</p>{query.data.items.map((version) => <div key={version.version} className="space-y-2.5 rounded-lg border border-line p-3"><div className="flex flex-wrap items-center gap-1.5"><button className="text-xs font-semibold hover:text-brand-700 hover:underline" onClick={() => setInspect(version.version)}>Version {version.version}</button>{version.version === workflow.currentVersion && <Badge>Current</Badge>}{version.version === workflow.publishedVersion && <Badge tone="success">Published</Badge>}<Badge tone={version.valid ? 'success' : 'warning'}>{version.valid ? 'Valid' : 'Invalid draft'}</Badge></div><p className="text-xs text-muted">{version.changeNote || 'No change note.'}</p><p className="text-[10px] text-faint"><RelativeTime value={version.createdAt} />{version.restoredFromVersion !== null ? ` · Restored from v${version.restoredFromVersion}` : ''}</p><p className="truncate text-[10px] text-faint" title={version.createdById ?? undefined}>Author: {version.createdById ?? 'System'}</p><div className="flex flex-wrap gap-2">{can('workflow:update') && <Button size="xs" variant="secondary" disabled={busy || version.version === workflow.currentVersion} onClick={() => onRestore(version.version)}>Restore</Button>}{can('workflow:publish') && <Button size="xs" variant="secondary" disabled={busy || dirty || !version.valid || workflow.status === 'ACTIVE' && version.version === workflow.publishedVersion} title={!version.valid ? 'This version has validation errors.' : dirty ? 'Save or discard unsaved changes first.' : undefined} onClick={() => onPublish(version.version)}>Publish this version</Button>}</div></div>)}{query.data.pagination.totalPages > 1 && <Pagination pagination={query.data.pagination} onPageChange={setPage} noun={['version', 'versions']} busy={query.isFetching} />}<Dialog open={inspect !== null} onOpenChange={(open) => !open && setInspect(null)}><DialogContent size="xl"><DialogHeader title={`Version ${inspect}`} description="An immutable snapshot of this workflow's graph, limits, and validation report." /><DialogBody>{detail.isPending ? <Skeleton className="h-64" /> : detail.isError ? <ErrorState error={detail.error} onRetry={() => void detail.refetch()} /> : <VersionSnapshot version={detail.data} />}</DialogBody><DialogFooter><Button variant="secondary" onClick={() => setInspect(null)}>Close</Button></DialogFooter></DialogContent></Dialog></div>;
}

function VersionSnapshot({ version }: { version: WorkflowVersion }) {
  return <div className="space-y-4"><div className="flex items-center justify-between text-xs"><Badge tone={version.valid ? 'success' : 'warning'}>{version.valid ? 'Valid graph' : `${version.validation.errors.length} validation issues`}</Badge><span>{version.graph.nodes.length} steps · {version.graph.edges.length} connections</span></div><dl className="space-y-2 text-xs"><div><dt className="text-muted">Change note</dt><dd>{version.changeNote || '—'}</dd></div><div><dt className="text-muted">Content digest</dt><dd className="break-all font-mono text-[10px]">{version.digest}</dd></div></dl>{version.validation.errors.map((issue, index) => <p className="rounded-md bg-danger-50 p-2 text-xs text-danger-700" key={index}>{issue.nodeId || issue.edgeId || 'Graph'}: {issue.message}</p>)}<details><summary className="cursor-pointer text-xs font-medium">Inspect graph and settings</summary><pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-well p-3 text-[11px]">{JSON.stringify({ graph: version.graph, settings: version.settings }, null, 2)}</pre></details></div>;
}
