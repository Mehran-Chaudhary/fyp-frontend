import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock3, Gauge, History, LockKeyhole, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, Zap } from 'lucide-react';
import { useState } from 'react';
import { NoAccessState } from '@/components/feedback/no-access';
import { EmptyState, ErrorState, PageHeader } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer, DrawerSection } from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/misc';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { quotasApi } from '@/lib/api/governance';
import type { Quota } from '@/lib/api/governance-types';
import { messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { allAgentsQuery, apiKeysQuery, memberNamesQuery } from '@/lib/queries';
import { toast } from '@/lib/toast';
import { cn, formatDateTime } from '@/lib/utils';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { CircuitsPanel } from './circuits-panel';
import { quotaGauge } from './helpers';
import { QuotaEditor } from './quota-editor';
import { MetricCard } from './shared';

const SCOPE_LABEL = { ORGANIZATION: 'Workspace', MEMBER: 'Member', AGENT: 'Agent', API_KEY: 'API key' } as const;
const PERIOD_LABEL = { DAY: 'Daily budget', MONTH: 'Monthly budget', MINUTE: 'Per-minute rate' } as const;

export function GovernancePage() {
  const ws = useWorkspace(); const can = useCan(); useDocumentTitle('Governance');
  if (!can.any('usage:read', 'quota:manage', 'agent:read', 'llm:invoke', 'agent:execute')) return <NoAccessState permissions={['usage:read', 'quota:manage']} workspaceName={ws.name} />;
  return <div key={ws.id} className="grid gap-6"><PageHeader overline="Guardrails & control" title="Governance" description="Set token budgets, pace model calls and protect agents from runaway activity." />
    {can.any('usage:read', 'quota:manage') ? <QuotaDirectory /> : <MyQuotasPanel />}
    {can.any('usage:read', 'quota:manage', 'agent:read') ? <CircuitsPanel /> : null}
  </div>;
}

function QuotaDirectory() {
  const ws = useWorkspace(); const can = useCan(); const client = useQueryClient();
  const [filter, setFilter] = useState('all'); const [view, setView] = useState('workspace');
  const [editor, setEditor] = useState<Quota | 'new' | null>(null); const [history, setHistory] = useState<Quota | null>(null); const [removing, setRemoving] = useState<Quota | null>(null);
  const query = useQuery({ queryKey: ['ws', ws.id, 'quotas', 'list'], queryFn: ({ signal }) => quotasApi.list(ws.id, signal), refetchInterval: 30_000 });
  const agents = useQuery({ ...allAgentsQuery(ws.id), enabled: can('agent:read') });
  const members = useQuery({ ...memberNamesQuery(ws.id), enabled: can('member:read') });
  const keys = useQuery({ ...apiKeysQuery(ws.id), enabled: can('apikey:read') });
  const remove = useMutation({ mutationFn: (quota: Quota) => quotasApi.remove(ws.id, quota.id), onSuccess: () => { toast.success('Quota removed'); setRemoving(null); }, onSettled: () => void client.invalidateQueries({ queryKey: ['ws', ws.id, 'quotas'] }) });
  function subject(quota: Quota) {
    if (!quota.subjectId) return ws.name;
    if (quota.scope === 'MEMBER') return members.data?.get(quota.subjectId)?.name ?? (can('member:read') ? 'Deleted member' : `Member ${quota.subjectId.slice(0, 8)}`);
    if (quota.scope === 'AGENT') return agents.data?.items.find((agent) => agent.id === quota.subjectId)?.name ?? (can('agent:read') ? 'Deleted agent' : `Agent ${quota.subjectId.slice(0, 8)}`);
    return keys.data?.find((key) => key.id === quota.subjectId)?.name ?? (can('apikey:read') ? 'Deleted API key' : `API key ${quota.subjectId.slice(0, 8)}`);
  }
  const rows = [...(query.data ?? [])].sort((a, b) => Number(b.managedBy === 'PLATFORM') - Number(a.managedBy === 'PLATFORM'));
  const visible = rows.filter((quota) => filter === 'all' || (filter === 'rates' ? quota.period === 'MINUTE' : quota.period !== 'MINUTE'));
  return <>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Active controls" value={query.data ? rows.length : '—'} detail="Budgets and rate limits" icon={<ShieldCheck />} /><MetricCard label="Platform controls" value={query.data ? rows.filter((q) => q.managedBy === 'PLATFORM').length : '—'} detail="Set by your deployment and plan" icon={<LockKeyhole />} /><MetricCard label="Near budget limit" value={query.data ? rows.filter((q) => q.usage && q.usage.percent >= q.alertThreshold && q.usage.percent < 100).length : '—'} detail="At or above alert threshold" icon={<Gauge />} warning /><MetricCard label="Budgets exhausted" value={query.data ? rows.filter((q) => q.usage && q.usage.percent >= 100).length : '—'} detail="Hard limits refuse further calls" icon={<Zap />} warning /></div>
    <div className="flex flex-wrap items-center justify-between gap-3"><Segmented aria-label="Quota ownership" value={view} onValueChange={setView} options={[{ value: 'workspace', label: 'Workspace quotas' }, ...(can.any('usage:read', 'llm:invoke', 'agent:execute') ? [{ value: 'mine', label: 'My quotas' }] : [])]} /><div className="flex gap-2"><Button variant="secondary" size="sm" loading={query.isFetching} onClick={() => void client.invalidateQueries({ queryKey: ['ws', ws.id, 'quotas'] })}><RefreshCw />Refresh</Button>{can('quota:manage') ? <Button size="sm" onClick={() => setEditor('new')}><Plus />Create quota</Button> : null}</div></div>
    {view === 'mine' ? <MyQuotasPanel /> : <>
      <div className="flex flex-wrap items-center justify-between gap-3"><Segmented aria-label="Quota type" value={filter} onValueChange={setFilter} options={[{ value: 'all', label: 'All controls' }, { value: 'budgets', label: 'Budgets' }, { value: 'rates', label: 'Rates' }]} /><p className="text-xs text-muted">Consumption refreshes every 30 seconds.</p></div>
      {query.isError ? <Card><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Card> : query.isPending ? <div className="grid gap-4 md:grid-cols-2">{[1, 2].map((id) => <Skeleton key={id} className="h-56 rounded-xl" />)}</div> : !visible.length ? <Card><EmptyState icon={<Gauge />} title="No matching quotas" description="Create a token budget or a rate limit to control consumption." action={can('quota:manage') ? <Button onClick={() => setEditor('new')}><Plus />Create quota</Button> : undefined} /></Card> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visible.map((quota) => <QuotaCard key={quota.id} quota={quota} subject={subject(quota)} actions={<><Button aria-label={`History for ${quota.label ?? subject(quota)}`} size="icon-sm" variant="ghost" onClick={() => setHistory(quota)}><History /></Button>{can('quota:manage') && quota.managedBy !== 'PLATFORM' ? <><Button aria-label={`Edit ${quota.label ?? subject(quota)}`} size="icon-sm" variant="ghost" onClick={() => setEditor(quota)}><Pencil /></Button><Button aria-label={`Remove ${quota.label ?? subject(quota)}`} size="icon-sm" variant="ghost" className="text-danger-600" onClick={() => { remove.reset(); setRemoving(quota); }}><Trash2 /></Button></> : null}</>} />)}</div>}
    </>}
    <Callout tone="neutral" title="How budgets are enforced">Every applicable control is checked before a call starts, including the estimated prompt and maximum output. Daily and monthly budgets reset at UTC calendar boundaries. Minute limits refill continuously.</Callout>
    {editor ? <QuotaEditor key={editor === 'new' ? 'new' : editor.id} quota={editor === 'new' ? null : editor} onClose={() => setEditor(null)} /> : null}
    {history ? <QuotaHistory quota={history} onClose={() => setHistory(null)} /> : null}
    <ConfirmDialog open={Boolean(removing)} onOpenChange={(open) => { if (!open) setRemoving(null); }} title="Remove this quota?" description={`Removing “${removing?.label ?? (removing ? PERIOD_LABEL[removing.period] : 'quota')}” relaxes a control. Calls are still checked against other applicable quotas. This change is audited.`} icon={<Trash2 />} tone="danger" confirmLabel="Remove quota" pending={remove.isPending} confirmDisabled={!can('quota:manage')} error={remove.isError ? messageFor(remove.error) : null} onConfirm={() => { if (removing && can('quota:manage')) remove.mutate(removing); }} />
  </>;
}

function QuotaCard({ quota, subject, actions, compact }: { quota: Quota; subject: string; actions?: React.ReactNode; compact?: boolean }) {
  const gauge = quotaGauge(quota);
  const color = gauge.tone === 'danger' ? 'bg-danger-500' : gauge.tone === 'warning' ? 'bg-warning-500' : 'bg-brand-500';
  return <Card className={cn('overflow-hidden', quota.managedBy === 'PLATFORM' && 'bg-well/20')}>
    <div className={compact ? 'p-3' : 'p-5'}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{quota.label ?? `${subject} · ${PERIOD_LABEL[quota.period]}`}</p><p className="mt-1 text-xs text-muted">{SCOPE_LABEL[quota.scope]} · {subject}</p></div><div className="flex shrink-0 gap-1">{actions}</div></div>
      <div className="mt-3 flex flex-wrap gap-1.5"><Badge>{PERIOD_LABEL[quota.period]}</Badge><Badge tone={quota.enforcement === 'HARD' ? 'neutral' : 'warning'}>{quota.enforcement === 'HARD' ? 'Hard · enforced' : 'Soft · alerts only'}</Badge>{quota.managedBy === 'PLATFORM' ? <Badge><LockKeyhole className="mr-1 size-3" />Set by the platform</Badge> : null}</div>
      <p className="mt-5 text-[13px] font-medium tabular text-ink">{gauge.label}</p>
      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-well-strong" role="progressbar" aria-label={quota.period === 'MINUTE' ? 'Rate bucket consumed' : 'Budget consumed'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={gauge.percent === null ? undefined : Math.max(0, Math.min(100, gauge.percent))} aria-valuetext={gauge.label}>
        {gauge.percent === null ? <div className="h-full w-full bg-line-strong/50" /> : <div className={cn('h-full rounded-full transition-[width]', color)} style={{ width: `${Math.min(100, Math.max(0, gauge.percent))}%` }} />}
      </div><div className="mt-2 flex justify-between gap-2 text-xs text-muted"><span>{quota.period === 'MINUTE' ? 'Continuously refills' : `Alert at ${quota.alertThreshold}%`}</span><span className="font-mono tabular">{gauge.percent === null ? 'Unknown availability' : `${gauge.percent.toLocaleString()}% ${quota.period === 'MINUTE' ? 'consumed' : 'used'}`}</span></div>
      {quota.usage && !compact ? <div className="mt-4 border-t border-line pt-3 text-xs text-muted"><p>{quota.usage.reserved.toLocaleString()} tokens reserved by calls in flight · {quota.usage.remaining.toLocaleString()} remaining</p><p className="mt-1 flex items-center gap-1.5"><Clock3 className="size-3" />Resets {formatDateTime(quota.usage.resetsAt)}</p></div> : null}
    </div>
  </Card>;
}

export function MyQuotasPanel({ compact = false }: { compact?: boolean }) {
  const ws = useWorkspace(); const can = useCan(); const allowed = can.any('usage:read', 'llm:invoke', 'agent:execute');
  const query = useQuery({ queryKey: ['ws', ws.id, 'quotas', 'mine'], queryFn: ({ signal }) => quotasApi.mine(ws.id, signal), enabled: allowed, refetchInterval: 30_000 });
  if (!allowed) return null;
  return <section className="grid gap-3" aria-label="My quotas"><div><h3 className="text-sm font-semibold text-ink">My quotas</h3><p className="mt-1 text-xs text-muted">Workspace controls and personal limits that apply to you. Individual agents may have additional quotas.</p></div>{query.isError ? <ErrorState compact error={query.error} onRetry={() => void query.refetch()} /> : query.isPending ? <Skeleton className="h-28" /> : !query.data.length ? <p className="text-sm text-muted">No quotas apply to you.</p> : <div className={cn('grid gap-3', !compact && 'md:grid-cols-2 xl:grid-cols-3')}>{[...query.data].sort((a, b) => Number(b.managedBy === 'PLATFORM') - Number(a.managedBy === 'PLATFORM')).map((quota) => <QuotaCard key={quota.id} quota={quota} subject={quota.scope === 'ORGANIZATION' ? ws.name : 'You'} compact={compact} />)}</div>}</section>;
}

function QuotaHistory({ quota, onClose }: { quota: Quota; onClose: () => void }) {
  const ws = useWorkspace(); const [periods, setPeriods] = useState('12');
  const history = useQuery({ queryKey: ['ws', ws.id, 'quotas', quota.id, 'history', periods], queryFn: ({ signal }) => quotasApi.history(ws.id, quota.id, Number(periods), signal) });
  return <Drawer open onOpenChange={(open) => { if (!open) onClose(); }} title="Quota history" description={quota.label ?? PERIOD_LABEL[quota.period]} className="w-[min(44rem,100vw)]"><DrawerSection title="Past periods" actions={<Select aria-label="History periods" size="sm" value={periods} onValueChange={setPeriods} options={['3', '6', '12', '24', '36'].map((value) => ({ value, label: `${value} periods` }))} />}>
    {history.isError ? <ErrorState error={history.error} onRetry={() => void history.refetch()} /> : history.isPending ? <Skeleton className="h-36" /> : !history.data.length ? <EmptyState icon={<History />} title="No history yet" description={quota.period === 'MINUTE' ? 'Per-minute rates use a continuously refilling token bucket.' : 'Usage and enforcement events appear as calls are made.'} /> : <Table><THead><tr><TH>Period started</TH><TH>Tokens</TH><TH>Calls</TH><TH>Refusals</TH></tr></THead><TBody>{history.data.map((entry) => <TR key={entry.periodStart}><TD>{formatDateTime(entry.periodStart)}{entry.alertedAt ? <p className="mt-1 text-xs text-warning-700">Alerted {formatDateTime(entry.alertedAt)}</p> : null}{entry.exhaustedAt ? <p className="mt-1 text-xs text-danger-700">Exhausted {formatDateTime(entry.exhaustedAt)}</p> : null}</TD><TD className="font-mono tabular">{entry.tokensUsed.toLocaleString()}</TD><TD className="font-mono tabular">{entry.requests.toLocaleString()}</TD><TD className="font-mono tabular">{entry.rejected.toLocaleString()}</TD></TR>)}</TBody></Table>}
  </DrawerSection></Drawer>;
}
