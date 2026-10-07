import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, GitBranch, History, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { EmptyState, ErrorState, PageHeader } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FormError } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Pagination } from '@/components/ui/pagination';
import { RelativeTime } from '@/components/ui/relative-time';
import { Select } from '@/components/ui/select';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { ApiError } from '@/lib/api/errors';
import { workflowKeys, workflowsApi } from '@/lib/api/workflows';
import { useDebouncedValue, useDocumentTitle } from '@/lib/hooks';
import { toast } from '@/lib/toast';
import type { WorkflowStatus } from '@/lib/workflows/types';

export function WorkflowsPage() {
  const workspace = useWorkspace();
  const can = useCan();
  useDocumentTitle('Workflows');
  return can('workflow:read') ? <WorkflowDirectory /> : <Card><NoAccessState permissions={['workflow:read']} workspaceName={workspace.name} title="Workflows are not available to you" /></Card>;
}

function WorkflowDirectory() {
  const workspace = useWorkspace();
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const rawSearch = params.get('search') ?? '';
  const [search, setSearch] = useState(rawSearch);
  const [syncedSearch, setSyncedSearch] = useState(rawSearch);
  if (syncedSearch !== rawSearch) { setSearch(rawSearch); setSyncedSearch(rawSearch); }
  const debounced = useDebouncedValue(search.trim(), 300);
  const rawStatus = params.get('status');
  const status = (['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(rawStatus ?? '') ? rawStatus : undefined) as WorkflowStatus | undefined;
  const rawPage = Number(params.get('page'));
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const filters = { page, limit: 18, search: debounced || undefined, status };
  const query = useQuery({ queryKey: workflowKeys.list(workspace.id, filters), queryFn: ({ signal }) => workflowsApi.list(workspace.id, filters, signal) });
  const [createOpen, setCreateOpen] = useState(false);
  const base = `/w/${workspace.slug}`;
  return <div className="space-y-6">
    <PageHeader overline="ORCHESTRATION" title="Workflows" description="Bring agents, tools and people into one repeatable process. Build safely, publish deliberately, and follow every step."
      actions={<>{can('workflow:read') && <Button asChild variant="secondary"><Link to={`${base}/runs`}><History />Run history</Link></Button>}{can('workflow:create') && <Button onClick={() => setCreateOpen(true)}><Plus />New workflow</Button>}</>} />
    <div className="flex flex-col gap-3 sm:flex-row">
      <Input value={search} maxLength={200} leading={<Search />} placeholder="Search workflows" aria-label="Search workflows" className="sm:w-80" onChange={(event) => { setSearch(event.target.value); setParams((previous) => { const next = new URLSearchParams(previous); next.delete('page'); if (event.target.value) next.set('search', event.target.value); else next.delete('search'); return next; }, { replace: true }); }} />
      <Select value={status ?? 'all'} onValueChange={(value) => setParams((previous) => { const next = new URLSearchParams(previous); next.delete('page'); if (value === 'all') next.delete('status'); else next.set('status', value); return next; }, { replace: true })} aria-label="Workflow status" className="sm:ml-auto sm:w-44" options={[{ value: 'all', label: 'All workflows' }, { value: 'ACTIVE', label: 'Published' }, { value: 'DRAFT', label: 'Drafts' }, { value: 'ARCHIVED', label: 'Archived' }]} />
    </div>
    {query.isPending ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton className="h-52 rounded-xl" key={i} />)}</div> : query.isError ? <Card><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Card> : !query.data.items.length ? <Card><EmptyState icon={<GitBranch />} title={search || status ? 'No workflows match' : 'Your next process starts here'} description={search || status ? 'Try another name or status.' : 'Create a workflow, connect its steps, and validate before publishing.'} action={can('workflow:create') ? <Button onClick={() => setCreateOpen(true)}><Plus />Create workflow</Button> : undefined} /></Card> : <>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{query.data.items.map((workflow) => <li key={workflow.id}>
        <Link to={`${base}/workflows/${workflow.id}`} className="group flex h-full flex-col rounded-xl border border-line bg-surface p-5 shadow-card transition hover:border-brand-300 hover:shadow-md">
          <div className="mb-4 flex items-start justify-between"><span className="rounded-xl border border-brand-200 bg-brand-50 p-2.5 text-brand-700"><GitBranch className="size-5" /></span><Badge tone={workflow.status === 'ACTIVE' ? 'success' : workflow.status === 'ARCHIVED' ? 'neutral' : 'warning'} dot>{workflow.status === 'ACTIVE' ? 'Published' : workflow.status === 'ARCHIVED' ? 'Archived' : 'Draft'}</Badge></div>
          <h2 className="flex items-center justify-between gap-3 text-[15px] font-semibold">{workflow.name}<ArrowUpRight className="size-4 text-faint transition group-hover:text-brand-600" /></h2>
          <p className="mt-1.5 mb-5 line-clamp-2 text-[13px] text-muted">{workflow.description || 'A connected process for your workspace.'}</p>
          <div className="mt-auto flex flex-wrap justify-between gap-2 border-t border-line pt-3 text-xs text-muted"><span>Current v{workflow.currentVersion}{workflow.publishedVersion !== null ? ` · live v${workflow.publishedVersion}` : ''}</span><span>Edited <RelativeTime value={workflow.updatedAt} /></span></div>
        </Link>
      </li>)}</ul>
      {query.data.pagination.totalPages > 1 && <Pagination pagination={query.data.pagination} busy={query.isFetching} noun={['workflow', 'workflows']} onPageChange={(next) => setParams((previous) => { const copy = new URLSearchParams(previous); copy.set('page', String(next)); return copy; })} />}
    </>}
    <CreateWorkflowDialog key={String(createOpen)} open={createOpen} onOpenChange={setCreateOpen} />
  </div>;
}

function CreateWorkflowDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (value: boolean) => void }) {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const mutation = useMutation({ mutationFn: () => workflowsApi.create(workspace.id, { name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}) }), onSuccess: (workflow) => {
    void client.invalidateQueries({ queryKey: workflowKeys.all(workspace.id) });
    client.setQueryData(workflowKeys.detail(workspace.id, workflow.id), workflow);
    toast.success('Workflow created');
    onOpenChange(false);
    navigate(`/w/${workspace.slug}/workflows/${workflow.id}`);
  } });
  const fieldErrors = mutation.error instanceof ApiError ? mutation.error.fieldErrors() : {};
  return <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}><DialogContent><DialogHeader title="Create workflow" description="Start with a trigger and output, then build the steps between them." icon={<GitBranch />} />
    <form onSubmit={(event) => { event.preventDefault(); if (name.trim()) mutation.mutate(); }}>
      <DialogBody className="space-y-4"><Field label="Name" error={fieldErrors.name}><Input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required placeholder="e.g. Research and review" /></Field><Field label="Description" optional error={fieldErrors.description}><Textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} placeholder="What does this workflow help your team do?" /></Field><FormError message={mutation.error?.message} /></DialogBody>
      <DialogFooter><Button variant="secondary" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>Cancel</Button><Button type="submit" disabled={!name.trim()} loading={mutation.isPending}>Create workflow</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
