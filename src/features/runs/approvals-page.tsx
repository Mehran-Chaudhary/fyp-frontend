import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardCheck, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { EmptyState, ErrorState, PageHeader } from '@/components/feedback/states';
import { NoAccessState } from '@/components/feedback/no-access';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { runsApi, runKeys } from '@/lib/api/runs';
import type { ApprovalItem } from '@/lib/runs/types';
import { LiveConnection, RunNavigation } from './run-bits';

export function ApprovalsPage() {
  const ws = useWorkspace(); const can = useCan(); const client = useQueryClient();
  const [target, setTarget] = useState<{ item: ApprovalItem; decision: 'approve' | 'reject' } | null>(null);
  const [comment, setComment] = useState(''); const [pending, setPending] = useState(false); const [error, setError] = useState<unknown>(null);
  const query = useQuery({ queryKey: runKeys.approvals(ws.id), queryFn: ({ signal }) => runsApi.approvals(ws.id, signal), enabled: can('workflow:approve'), refetchInterval: 60_000, gcTime: 0 });
  const decide = async () => {
    if (!target || pending) return; setPending(true); setError(null);
    try {
      await runsApi.decide(ws.id, target.item.runId, target.item.stepId, { decision: target.decision, ...(comment.trim() ? { comment: comment.trim() } : {}) });
      setTarget(null); setComment('');
      for (const area of ['run', 'runs', 'approvals']) void client.invalidateQueries({ queryKey: ['ws', ws.id, area] });
    } catch (cause) { setError(cause); void query.refetch(); } finally { setPending(false); }
  };
  if (!can('workflow:approve')) return <NoAccessState permissions={['workflow:approve']} workspaceName={ws.name} />;
  return <div className="grid gap-6"><PageHeader overline="Human oversight" title="Approvals" description="Review the oldest requests first. Every decision is encrypted and audited." actions={<RunNavigation />} /><LiveConnection />
    {query.isPending ? <Spinner /> : query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : query.data.length ? <div className="grid gap-4">{query.data.map(item => <Card key={item.stepId} className="grid gap-4 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">{item.nodeId}</h2><p className="mt-1 text-xs text-muted">Requested {new Date(item.requestedAt).toLocaleString()} · Expires {new Date(item.expiresAt).toLocaleString()}</p></div><Badge>{item.classification}</Badge></div>
      {item.message !== null ? <p className="whitespace-pre-wrap break-words rounded-lg bg-well p-4 text-sm">{item.message}</p> : <p className="text-sm text-muted">The approval message is withheld because your clearance does not cover its data.</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">{can('workflow:read') && <Link className="text-sm text-brand-700 underline underline-offset-4" to={`/w/${ws.slug}/runs/${item.runId}`}>Inspect run {item.runId.slice(0, 8)}</Link>}
        {item.canDecide ? <div className="flex gap-2"><Button variant="danger-outline" size="sm" onClick={() => { setError(null); setComment(''); setTarget({ item, decision: 'reject' }); }}><X />Reject</Button><Button size="sm" onClick={() => { setError(null); setComment(''); setTarget({ item, decision: 'approve' }); }}><Check />Approve</Button></div> : <p className="text-xs text-muted">{item.message === null ? 'You are not cleared to decide this request.' : 'You started this run. Someone else must decide.'}</p>}
      </div></Card>)}{query.data.length === 100 && <p className="text-sm text-muted">Showing the 100 oldest pending requests. More appear as requests are resolved.</p>}</div> : <Card><EmptyState icon={<ClipboardCheck />} title="All caught up" description="Workflow steps waiting for human approval appear here." /></Card>}
    <ConfirmDialog open={!!target} onOpenChange={open => { if (!open) { setTarget(null); setComment(''); } }} title={target?.decision === 'approve' ? 'Approve this step?' : 'Reject this step?'} description="The workflow continues along the matching decision branch. This decision cannot be undone." confirmLabel={target?.decision === 'approve' ? 'Approve step' : 'Reject step'} tone={target?.decision === 'reject' ? 'danger' : 'neutral'} pending={pending} onConfirm={() => void decide()}><Field label="Comment (optional)" hint="Only authorised readers can access this encrypted comment."><Textarea maxLength={2000} value={comment} onChange={event => setComment(event.target.value)} /></Field>{error ? <ErrorState compact error={error} /> : null}</ConfirmDialog>
  </div>;
}
