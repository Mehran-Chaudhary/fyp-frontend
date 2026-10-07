import { Link } from 'react-router';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { statusLabel } from '@/lib/runs/state';
import { useRealtime } from '@/features/realtime/realtime-context';
export function RunStatusBadge({ status }: { status: string }) {
  return <Badge tone={['COMPLETED', 'SUCCEEDED'].includes(status) ? 'success' : ['FAILED', 'TIMED_OUT'].includes(status) ? 'danger' : status === 'WAITING_APPROVAL' ? 'warning' : ['RUNNING', 'QUEUED'].includes(status) ? 'brand' : 'neutral'} dot>{statusLabel(status)}</Badge>;
}
export function RunNavigation() {
  const ws = useWorkspace(); const can = useCan();
  return <nav aria-label="Workflow operations" className="flex flex-wrap gap-2">
    {can('workflow:read') && <><Button variant="secondary" size="sm" asChild><Link to={`/w/${ws.slug}/workflows`}>Workflows</Link></Button><Button variant="secondary" size="sm" asChild><Link to={`/w/${ws.slug}/runs`}>Runs</Link></Button></>}
    {can('workflow:approve') && <Button variant="secondary" size="sm" asChild><Link to={`/w/${ws.slug}/approvals`}>Approvals</Link></Button>}
    {can('workflow:update') && <Button variant="secondary" size="sm" asChild><Link to={`/w/${ws.slug}/runs/dead-letters`}>Dead letters</Link></Button>}
  </nav>;
}
export function LiveConnection() {
  const live = useRealtime();
  return <div className="flex flex-wrap items-center gap-2 text-xs text-muted" role="status"><Badge dot tone={live.status === 'live' ? 'success' : 'warning'}>{live.status === 'live' ? 'Live updates' : live.status === 'connecting' ? 'Connecting' : 'REST recovery'}</Badge>{live.reason && <span>{live.reason}</span>}{live.status === 'offline' && <Button size="sm" variant="ghost" onClick={live.reconnect}>Reconnect</Button>}</div>;
}
