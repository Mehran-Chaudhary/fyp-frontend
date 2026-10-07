import { useQuery } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { EmptyState, ErrorState, PageHeader } from '@/components/feedback/states';
import { NoAccessState } from '@/components/feedback/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
import { Spinner } from '@/components/ui/spinner';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { runsApi, runKeys } from '@/lib/api/runs';
import { runErrorText } from '@/lib/runs/state';
import { RunNavigation, RunStatusBadge } from './run-bits';

export function DeadLettersPage() {
  const ws = useWorkspace(); const can = useCan(); const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: [...runKeys.deadLetters(ws.id), page], queryFn: ({ signal }) => runsApi.deadLetters(ws.id, page, signal), enabled: can('workflow:update') });
  if (!can('workflow:update')) return <NoAccessState permissions={['workflow:update']} workspaceName={ws.name} />;
  return <div className="grid gap-6"><PageHeader overline="Recovery" title="Dead letters" description="Permanently failed steps, without their content. Fix the cause before resuming a failed or timed-out run." actions={<RunNavigation />} />
    {query.isPending ? <Spinner /> : query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : <><div className="grid gap-3">{query.data.items.map(item => <Card key={item.stepId} className="flex flex-wrap items-center justify-between gap-4 p-5"><div className="grid gap-2"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{item.nodeId} #{item.iteration}</strong><Badge tone="danger">{item.failureClass ?? 'Failed'}</Badge><RunStatusBadge status={item.runStatus} /></div><p className="text-sm">{runErrorText(item.errorCode)}</p><p className="text-xs text-muted">{item.errorCode} · {item.attempts} attempts · {new Date(item.deadLetteredAt).toLocaleString()}</p></div>{can('workflow:read') && <Button asChild variant="secondary" size="sm"><Link to={`/w/${ws.slug}/runs/${item.runId}`}>Inspect & recover</Link></Button>}</Card>)}{!query.data.items.length && <Card><EmptyState icon={<Inbox />} title="No dead letters" description="Steps that exhaust retries or fail permanently will be listed here." /></Card>}</div><Pagination pagination={query.data.pagination} onPageChange={setPage} noun={['dead letter', 'dead letters']} busy={query.isFetching} /></>}
  </div>;
}
