import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowUpRight } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { EmptyState, ErrorState, PageHeader } from '@/components/feedback/states';
import { NoAccessState } from '@/components/feedback/no-access';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { runsApi, runKeys } from '@/lib/api/runs';
import { RUN_STATUSES, statusLabel } from '@/lib/runs/state';
import type { RunStatus } from '@/lib/runs/types';
import { LiveConnection, RunNavigation, RunStatusBadge } from './run-bits';

export function RunsPage() {
  const ws = useWorkspace(); const can = useCan(); const params = useParams(); const [search] = useSearchParams();
  const workflowId = params.workflowId ?? search.get('workflowId') ?? undefined;
  const [page, setPage] = useState(1); const [scope, setScope] = useState<'mine' | 'all'>('mine'); const [status, setStatus] = useState<RunStatus | 'all'>('all');
  const effectiveScope = can('workflow:read_all') ? scope : 'mine';
  const filters = { page, limit: 20, scope: effectiveScope, status: status === 'all' ? undefined : status, workflowId };
  const query = useQuery({ queryKey: [...runKeys.list(ws.id), filters], queryFn: ({ signal }) => runsApi.list(ws.id, filters, signal), enabled: can('workflow:read'), refetchInterval: 30_000 });
  if (!can('workflow:read')) return <NoAccessState permissions={['workflow:read']} workspaceName={ws.name} />;
  return <div className="grid gap-6"><PageHeader overline="Orchestration" title={workflowId ? 'Workflow runs' : 'Runs'} description="Follow execution, inspect each step, and recover failed workflows." actions={<RunNavigation />} /><LiveConnection />
    <div className="flex flex-wrap gap-3">{can('workflow:read_all') && <Select aria-label="Run visibility" value={effectiveScope} onValueChange={value => { setScope(value); setPage(1); }} options={[{ value: 'mine', label: 'My runs' }, { value: 'all', label: 'Everyone' }]} />}
      <Select aria-label="Run status" value={status} onValueChange={value => { setStatus(value); setPage(1); }} options={[{ value: 'all', label: 'All statuses' }, ...RUN_STATUSES.map(value => ({ value, label: statusLabel(value) }))]} /></div>
    {query.isPending ? <div className="py-12"><Spinner /></div> : query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : <>
      <Card className="overflow-hidden">{query.data.items.length ? <div className="divide-y divide-line">{query.data.items.map(run => <Link key={run.id} to={`/w/${ws.slug}/runs/${run.id}`} className="group flex flex-wrap items-center justify-between gap-4 p-5 transition hover:bg-well">
        <div className="flex min-w-0 items-center gap-3"><span className="rounded-xl border border-line bg-well p-3 text-brand-700"><Activity className="size-5" /></span><div><p className="font-medium text-ink">Run {run.id.slice(0, 8)} <span className="ml-1 text-xs font-normal text-muted">v{run.workflowVersion}</span></p><p className="mt-1 text-xs text-muted">{new Date(run.createdAt).toLocaleString()} · {run.trigger === 'API' ? 'API key' : 'Manual'}</p></div></div>
        <div className="flex flex-wrap items-center gap-4"><span className="text-xs text-muted">{run.stepsScheduled} steps · {run.tokensUsed.toLocaleString()} tokens</span><RunStatusBadge status={run.status} /><ArrowUpRight className="size-4 text-muted" /></div>
      </Link>)}</div> : <EmptyState icon={<Activity />} title={status === 'all' ? 'No runs yet' : 'No matching runs'} description={status === 'all' ? 'Open a published workflow to start your first run.' : 'Try another status or visibility filter.'} action={status === 'all' ? <Button asChild variant="secondary"><Link to={`/w/${ws.slug}/workflows`}>Explore workflows</Link></Button> : undefined} />}</Card>
      <Pagination pagination={query.data.pagination} onPageChange={setPage} noun={['run', 'runs']} busy={query.isFetching} /></>}
  </div>;
}
