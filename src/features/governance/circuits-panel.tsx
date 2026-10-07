import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircuitBoard, RotateCcw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer, DrawerSection } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { FormError } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { circuitsApi } from '@/lib/api/governance';
import type { AgentCircuit } from '@/lib/api/governance-types';
import { messageFor } from '@/lib/errors';
import { allAgentsQuery } from '@/lib/queries';
import { toast } from '@/lib/toast';
import { formatCountdown, formatDateTime } from '@/lib/utils';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { DetailRows } from './shared';

const reasonText = (reason?: AgentCircuit['reason']) => reason === 'RUNAWAY_SPEND' ? 'Spent unusually many tokens' : reason === 'REPEATED_FAILURES' ? 'Failed repeatedly' : 'Automatic protection';

export function CircuitsPanel() {
  const ws = useWorkspace(); const can = useCan(); const client = useQueryClient();
  const [agent, setAgent] = useState(''); const [selected, setSelected] = useState<string | null>(null); const [resetting, setResetting] = useState<string | null>(null); const [inputError, setInputError] = useState('');
  const circuits = useQuery({ queryKey: ['ws', ws.id, 'circuits', 'list'], queryFn: ({ signal }) => circuitsApi.list(ws.id, signal), refetchInterval: 15_000 });
  const agents = useQuery({ ...allAgentsQuery(ws.id), enabled: can('agent:read') });
  const detail = useQuery({ queryKey: ['ws', ws.id, 'circuits', 'agent', selected], queryFn: ({ signal }) => circuitsApi.get(ws.id, selected!, signal), enabled: Boolean(selected), refetchInterval: 15_000 });
  const name = (id: string) => agents.data?.items.find((a) => a.id === id)?.name ?? (can('agent:read') ? 'Deleted agent' : `Agent ${id.slice(0, 8)}`);
  const canReset = can.any('quota:manage', 'agent:update');
  const reset = useMutation({ mutationFn: (id: string) => circuitsApi.reset(ws.id, id), onSuccess: (result) => { toast.success(result.wasOpen ? 'Circuit closed. The agent can run again.' : 'The circuit was already closed.'); setResetting(null); }, onSettled: () => { void client.invalidateQueries({ queryKey: ['ws', ws.id, 'circuits'] }); void client.invalidateQueries({ queryKey: ['ws', ws.id, 'analytics'] }); } });
  const askReset = (id: string) => { reset.reset(); setResetting(id); };
  return <Card><CardHeader title="Agent circuit breakers" icon={<CircuitBoard />} description="Agents pause automatically after unusual spending or repeated failures. Review the cause before closing a breaker." actions={<Button variant="secondary" size="sm" loading={circuits.isFetching} onClick={() => void circuits.refetch()}><RotateCcw />Refresh</Button>} /><CardBody className="grid gap-4">
    <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agent)) { setInputError('Choose an agent or enter a valid agent UUID.'); return; } setInputError(''); setSelected(agent); }}>
      {can('agent:read') ? <Select className="min-w-52 flex-1" aria-label="Agent to inspect" value={agent || undefined} placeholder={agents.isPending ? 'Loading agents…' : 'Inspect an agent…'} onValueChange={setAgent} options={agents.data?.items.map((item) => ({ value: item.id, label: item.name })) ?? []} /> : <Input className="flex-1" aria-label="Agent ID to inspect" placeholder="Agent UUID" value={agent} onChange={(e) => setAgent(e.target.value)} />}
      <Button type="submit" variant="secondary" disabled={!agent}><Search />Inspect circuit</Button><FormError message={inputError} />
    </form>
    {agents.isError && can('agent:read') ? <ErrorState compact error={agents.error} title="Agent names unavailable" onRetry={() => void agents.refetch()} /> : null}
    {circuits.isError ? <ErrorState error={circuits.error} onRetry={() => void circuits.refetch()} /> : circuits.isPending ? <Skeleton className="h-28" /> : !circuits.data.length ? <EmptyState icon={<CircleCheck />} title="All agent circuits are closed" description="No agents are currently paused by automatic protection." className="py-9" /> : <div className="grid gap-3">{circuits.data.map((circuit) => <div key={circuit.agentId} className="flex flex-wrap items-center gap-3 rounded-lg border border-warning-200 bg-warning-50/40 p-4"><CircuitBoard className="size-5 text-warning-600" /><div className="min-w-0 flex-1"><button onClick={() => setSelected(circuit.agentId)} className="text-sm font-semibold text-ink hover:underline">{name(circuit.agentId)}</button><p className="mt-1 text-xs text-muted">{reasonText(circuit.reason)} · opened {formatDateTime(circuit.openedAt)}</p><Countdown retryAt={circuit.retryAt} /></div><Badge tone="warning">Open</Badge>{canReset ? <Button size="sm" variant="secondary" onClick={() => askReset(circuit.agentId)}>Close now</Button> : null}</div>)}</div>}
    <Drawer open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }} title={selected ? name(selected) : 'Circuit detail'} description="Agent circuit breaker" footer={selected && detail.data?.state === 'open' && canReset ? <Button onClick={() => askReset(selected)}>Close now</Button> : undefined}>
      <DrawerSection title="Current state">{detail.isPending ? <Skeleton className="h-28" /> : detail.isError ? <ErrorState error={detail.error} onRetry={() => void detail.refetch()} /> : detail.data ? <><DetailRows rows={[
        ['Agent ID', detail.data.agentId], ['State', <Badge tone={detail.data.state === 'open' ? 'warning' : 'success'}>{detail.data.state}</Badge>], ['Reason', detail.data.reason ? reasonText(detail.data.reason) : 'No active incident'], ['Opened', formatDateTime(detail.data.openedAt)], ['Retry at', formatDateTime(detail.data.retryAt)],
      ]} />{detail.data.state === 'open' ? <Countdown retryAt={detail.data.retryAt} /> : null}</> : null}</DrawerSection>
    </Drawer>
    <ConfirmDialog open={Boolean(resetting)} onOpenChange={(open) => { if (!open) setResetting(null); }} title="Close this circuit now?" description={`“${resetting ? name(resetting) : 'This agent'}” will be allowed to make calls again immediately. Review its configuration and the cause of the pause first. This action is audited.`} icon={<CircuitBoard />} tone="warning" confirmLabel="Close circuit" pending={reset.isPending} confirmDisabled={!canReset} error={reset.isError ? messageFor(reset.error) : null} onConfirm={() => { if (resetting && canReset) reset.mutate(resetting); }} />
  </CardBody></Card>;
}

function Countdown({ retryAt }: { retryAt?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  if (!retryAt) return null;
  const remaining = Math.max(0, Math.ceil((Date.parse(retryAt) - now) / 1000));
  return <p className="mt-1 text-xs font-medium tabular text-warning-700">{remaining ? `Next attempt in ${formatCountdown(remaining)}` : 'Cooldown complete. The next call may probe recovery.'}</p>;
}
