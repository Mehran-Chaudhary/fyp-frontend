import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Activity, ArrowDown, Bot, CheckCheck, Database, Gauge, Layers, LockKeyhole, RefreshCw, ShieldAlert, ShieldCheck, Wrench, Zap } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { EmptyState, ErrorState, PageHeader } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { analyticsApi } from '@/lib/api/governance';
import type { AnalyticsOverview, SeriesMetric, Timeseries, TimeWindow, TopDimension } from '@/lib/api/governance-types';
import { useDocumentTitle } from '@/lib/hooks';
import { allAgentsQuery, apiKeysQuery, memberNamesQuery } from '@/lib/queries';
import { cn, formatDateTime } from '@/lib/utils';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { MetricCard, SeverityBadge } from '@/features/governance/shared';
import { seriesSegments, validateWindow, windowFromDays } from '@/features/governance/helpers';

const METRICS: Array<{ value: SeriesMetric; label: string }> = [
  { value: 'tokens', label: 'Tokens consumed' }, { value: 'invocations', label: 'Model calls' }, { value: 'throttled', label: 'Throttled calls' },
  { value: 'failures', label: 'Inference failures' }, { value: 'latency_p95', label: 'Answer latency · p95 (ms)' }, { value: 'ttft_p95', label: 'First token · p95 (ms)' },
  { value: 'redaction_p95', label: 'Masking latency · p95 (ms)' }, { value: 'entities_masked', label: 'Personal details masked' }, { value: 'workflow_runs', label: 'Workflow runs' },
  { value: 'workflow_failures', label: 'Workflow failures' }, { value: 'tool_calls', label: 'Tool calls' }, { value: 'tool_denials', label: 'Tool denials' },
  { value: 'security_events', label: 'Security events' }, { value: 'rag_queries', label: 'Retrieval queries' },
];
const number = (value: number) => value.toLocaleString();
const ms = (value: number | null) => value === null ? 'No data' : value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} s`;

export function AnalyticsPage() {
  const ws = useWorkspace(); const can = useCan(); useDocumentTitle('Command Centre');
  if (!can.any('usage:read', 'audit:read', 'security:read')) return <NoAccessState permissions={['usage:read']} workspaceName={ws.name} />;
  return <div className="grid gap-6" key={ws.id}>
    <PageHeader overline="Workspace intelligence" title="Command Centre" description="Understand performance, protection and spend across your agents and workflows. All views contain metadata only." />
    {can('usage:read') ? <AnalyticsContent /> : null}
    {can.any('audit:read', 'security:read') ? <SecurityFeed /> : null}
  </div>;
}

function AnalyticsContent() {
  const ws = useWorkspace(); const [preset, setPreset] = useState('30'); const [window, setWindow] = useState<TimeWindow>(() => windowFromDays(30));
  const [custom, setCustom] = useState({ from: '', to: '' }); const [error, setError] = useState('');
  const [metric, setMetric] = useState<SeriesMetric>('tokens'); const [interval, setInterval] = useState<'day' | 'hour'>('day');
  const hourlyAllowed = Date.parse(window.to) - Date.parse(window.from) <= 14 * 86_400_000;
  const actualInterval = hourlyAllowed ? interval : 'day';
  const overview = useQuery({ queryKey: ['ws', ws.id, 'analytics', 'overview', window], queryFn: ({ signal }) => analyticsApi.overview(ws.id, window, signal), placeholderData: keepPreviousData });
  const series = useQuery({ queryKey: ['ws', ws.id, 'analytics', 'timeseries', window, metric, actualInterval], queryFn: ({ signal }) => analyticsApi.timeseries(ws.id, window, metric, actualInterval, signal), placeholderData: keepPreviousData });
  function choose(value: string) { setPreset(value); setError(''); if (value !== 'custom') setWindow(windowFromDays(Number(value))); }
  return <>
    <div className="flex flex-wrap items-end gap-3">
      <Segmented aria-label="Analytics time window" value={preset} onValueChange={choose} options={[{ value: '1', label: '24 hours' }, { value: '7', label: '7 days' }, { value: '14', label: '14 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: 'custom', label: 'Custom' }]} />
      <Button className="ml-auto" size="sm" variant="secondary" loading={overview.isFetching || series.isFetching} onClick={() => { if (preset !== 'custom') setWindow(windowFromDays(Number(preset))); else { void overview.refetch(); void series.refetch(); } }}><RefreshCw />Refresh</Button>
    </div>
    {preset === 'custom' ? <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); const issue = validateWindow(custom.from, custom.to); setError(issue ?? ''); if (!issue) setWindow({ from: new Date(custom.from).toISOString(), to: new Date(custom.to).toISOString() }); }}>
      <Field label="From (local time)"><Input type="datetime-local" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></Field><Field label="To (local time)"><Input type="datetime-local" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></Field><Button type="submit" variant="secondary">Apply window</Button><FormError message={error} />
    </form> : null}
    <p className="-mt-3 text-xs text-muted">{formatDateTime(window.from)} — {formatDateTime(window.to)} · Chart buckets use UTC.</p>
    {overview.isError ? <Card><ErrorState error={overview.error} title="Overview unavailable" onRetry={() => void overview.refetch()} /></Card> : overview.isPending ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((id) => <Skeleton key={id} className="h-28 rounded-xl" />)}</div> : <div className={cn('grid gap-6', overview.isPlaceholderData && 'opacity-50')}><OverviewHighlights data={overview.data} /></div>}
    <Card><CardHeader title="Activity over time" icon={<Activity />} description="Every interval is included. Gaps mean no observations; zero means a measured count of zero." actions={<div className="flex flex-wrap gap-2"><Select aria-label="Chart metric" value={metric} onValueChange={setMetric} options={METRICS} size="sm" /><Select aria-label="Chart interval" value={actualInterval} onValueChange={setInterval} options={[{ value: 'day', label: 'Daily' }, { value: 'hour', label: 'Hourly', disabled: !hourlyAllowed, description: !hourlyAllowed ? 'Choose a window of 14 days or fewer' : undefined }]} size="sm" /></div>} />
      <CardBody>{series.isError ? <ErrorState error={series.error} onRetry={() => void series.refetch()} /> : series.isPending ? <Skeleton className="h-56" /> : <div className={series.isPlaceholderData ? 'opacity-50' : ''}><TrendChart data={series.data} /></div>}</CardBody>
    </Card>
    {overview.data && !overview.isError ? <OverviewSections data={overview.data} /> : null}
    <Rankings window={window} />
  </>;
}

function OverviewHighlights({ data }: { data: AnalyticsOverview }) {
  const { inference, workflows, privacy, governance } = data;
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <MetricCard label="Tokens consumed" value={number(inference.totals.promptTokens + inference.totals.completionTokens)} detail={`${number(inference.totals.invocations)} model calls`} icon={<Zap />} />
    <MetricCard label="Workflow runs" value={number(workflows.runs)} detail={`${number(workflows.completed)} completed · ${number(workflows.active)} active now`} icon={<Layers />} />
    <MetricCard label="Personal details protected" value={number(privacy.entitiesMasked)} detail={`${number(privacy.egressBlocked)} egress blocks`} icon={<LockKeyhole />} />
    <MetricCard label="Controls needing attention" value={number(governance.openCircuits + governance.budgetsNearLimit)} detail={`${governance.openCircuits} open circuits · ${governance.budgetsNearLimit} budgets near limit`} icon={<ShieldAlert />} warning={governance.openCircuits + governance.budgetsNearLimit > 0} />
  </div>;
}

function SummarySection({ title, icon, rows, detail }: { title: string; icon: ReactNode; rows: Array<[string, number | string]>; detail?: ReactNode }) {
  return <Card><CardHeader title={title} icon={icon} /><CardBody><dl className="grid gap-2.5">{rows.map(([label, value]) => <div key={label} className="flex justify-between gap-4 text-[13px]"><dt className="text-muted">{label}</dt><dd className="font-mono text-ink tabular">{typeof value === 'number' ? number(value) : value}</dd></div>)}</dl>{detail ? <div className="mt-4 border-t border-line pt-3 text-xs text-muted">{detail}</div> : null}</CardBody></Card>;
}

function OverviewSections({ data }: { data: AnalyticsOverview }) {
  const ws = useWorkspace(); const { inference: i, activity: a, workflows: w, tools: t, knowledge: k, privacy: p, governance: g, security: s } = data;
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
    <SummarySection title="Inference" icon={<Bot />} rows={[
      ['Calls completed', i.totals.completed], ['Failed / refused', `${i.totals.failed} / ${i.totals.refused}`], ['Cancelled / blocked', `${i.totals.cancelled} / ${i.totals.blocked}`], ['Median / p95 answer', `${ms(i.latencyMs.totalP50)} / ${ms(i.latencyMs.totalP95)}`], ['First token · p95', ms(i.latencyMs.timeToFirstTokenP95)],
    ]} detail={<Link className="text-brand-700 hover:underline" to={`/w/${ws.slug}/usage`}>Explore model usage →</Link>} />
    <SummarySection title="Activity" icon={<Activity />} rows={[
      ['Active members', a.activeMembers], ['Active API keys', a.activeApiKeys], ['Active agents', a.activeAgents], ['Conversations started', a.conversationsStarted], ['Conversation turns', a.turns],
    ]} />
    <SummarySection title="Orchestration" icon={<Layers />} rows={[
      ['Completed / failed', `${w.completed} / ${w.failed}`], ['Cancelled / timed out', `${w.cancelled} / ${w.timedOut}`], ['Active right now', w.active], ['Run duration · p95', ms(w.durationP95Ms)], ['Workflow tokens', w.tokens], ['Dead letters', w.deadLetters],
    ]} />
    <SummarySection title="Tools" icon={<Wrench />} rows={[
      ['Calls', t.calls], ['Succeeded', t.succeeded], ['Failed / timed out', `${t.failed} / ${t.timedOut}`], ['Denied', t.denied], ...Object.entries(t.denialsByReason).map(([key, value]): [string, number] => [key.replaceAll('_', ' ').toLowerCase(), value]),
    ]} />
    <SummarySection title="Knowledge" icon={<Database />} rows={[
      ['Stored', `${(k.storedBytes / 1024 / 1024).toFixed(1)} MB`], ['Retrieval queries', k.retrievalQueries], ['Withheld events', k.withheldEvents], ...Object.entries(k.documentsByStatus).map(([key, value]): [string, number] => [`Documents · ${key.toLowerCase()}`, value]),
    ]} />
    <SummarySection title="Privacy" icon={<LockKeyhole />} rows={[
      ['Details masked', p.entitiesMasked], ['Egress blocked', p.egressBlocked], ['Redaction refusals', p.refusedForRedaction], ['Degraded masking', p.degradedRedactions], ...Object.entries(p.entitiesByType).map(([key, value]): [string, number] => [key.replaceAll('_', ' ').toLowerCase(), value]),
    ]} />
    <SummarySection title="Governance" icon={<Gauge />} rows={[
      ['Throttled calls', g.throttledCalls], ['Budget exhaustions', g.budgetExhaustions], ['Rate-limit events', g.rateLimitEvents], ['Circuit breaks', g.circuitBreaks], ['Open circuits now', g.openCircuits], ['Budgets near limit', g.budgetsNearLimit],
    ]} detail={<Link className="text-brand-700 hover:underline" to={`/w/${ws.slug}/governance`}>Review controls →</Link>} />
    <SummarySection title="Security" icon={<ShieldCheck />} rows={[
      ['Failed sign-ins', s.failedSignIns], ['Access denials', s.accessDenials], ...Object.entries(s.bySeverity).map(([key, value]): [string, number] => [key.toLowerCase(), value]),
    ]} detail={s.topAlerts.length ? <ul className="grid gap-1">{s.topAlerts.slice(0, 3).map((alert) => <li key={alert.action}>{alert.action} · {number(alert.count)}</li>)}</ul> : 'No alerts in this window.'} />
  </div>;
}

function TrendChart({ data }: { data: Timeseries }) {
  const width = 880; const height = 170; const { segments, maximum } = seriesSegments(data.points, width, height);
  const label = METRICS.find((item) => item.value === data.metric)?.label ?? data.metric;
  return <div>
    <div className="flex items-center justify-between text-xs text-muted"><span>{label}</span><span>Peak {maximum === 1 && data.points.every((point) => !point.value) ? '0' : number(maximum)}</span></div>
    {!segments.length ? <EmptyState icon={<Activity />} title="No observations in this window" description="Percentiles appear after calls have completed." /> : <svg viewBox={`-5 -15 ${width + 10} ${height + 40}`} role="img" aria-label={`${label} over time. Detailed values in the data table below.`} className="mt-4 h-56 w-full overflow-visible">
      <title>{label}, {data.interval === 'day' ? 'daily' : 'hourly'} UTC buckets</title>
      {[0, 0.5, 1].map((fraction) => <line key={fraction} x1={0} x2={width} y1={height * fraction} y2={height * fraction} stroke="currentColor" className="text-line" strokeDasharray="4 5" />)}
      {segments.map((segment, index) => <g key={index}>
        {segment.length > 1 ? <><path d={`M ${segment.map((point) => `${point.x},${point.y}`).join(' L ')} L ${segment[segment.length - 1].x},${height} L ${segment[0].x},${height} Z`} fill="currentColor" className="text-brand-500/10" /><polyline points={segment.map((point) => `${point.x},${point.y}`).join(' ')} stroke="currentColor" strokeWidth={2.5} fill="none" className="text-brand-600" strokeLinejoin="round" strokeLinecap="round" /></> : null}
        {segment.map((point) => <circle key={point.at} cx={point.x} cy={point.y} r={data.points.length > 100 ? 2 : 3.5} fill="currentColor" className="text-brand-600"><title>{new Date(point.at).toUTCString()}: {number(point.value)}</title></circle>)}
      </g>)}
    </svg>}
    <div className="flex justify-between text-xs text-muted"><span>{data.points[0] ? new Date(data.points[0].at).toUTCString() : ''}</span><span>{data.points.at(-1) ? new Date(data.points.at(-1)!.at).toUTCString() : ''}</span></div>
    <details className="mt-4 border-t border-line pt-3"><summary className="cursor-pointer text-xs font-medium text-muted">View data table · {data.points.length} intervals</summary><div className="mt-3 max-h-64 overflow-auto"><Table><THead><tr><TH>Interval (UTC)</TH><TH>{label}</TH></tr></THead><TBody>{data.points.map((point) => <TR key={point.at}><TD>{new Date(point.at).toUTCString()}</TD><TD>{point.value === null ? 'No data' : number(point.value)}</TD></TR>)}</TBody></Table></div></details>
  </div>;
}

function Rankings({ window }: { window: TimeWindow }) {
  const ws = useWorkspace(); const can = useCan(); const [dimension, setDimension] = useState<TopDimension>('agents');
  const allowedDimension = (dimension === 'members' || dimension === 'api_keys') && !can('quota:manage') ? 'agents' : dimension;
  // Do not keep another dimension's rows: member/API-key rankings need stronger access.
  const ranks = useQuery({ queryKey: ['ws', ws.id, 'analytics', 'top', window, allowedDimension], queryFn: ({ signal }) => analyticsApi.top(ws.id, window, allowedDimension, signal) });
  const agents = useQuery({ ...allAgentsQuery(ws.id), enabled: can('agent:read') });
  const members = useQuery({ ...memberNamesQuery(ws.id), enabled: can('member:read') && can('quota:manage') });
  const keys = useQuery({ ...apiKeysQuery(ws.id), enabled: can('apikey:read') && can('quota:manage') });
  function name(id: string | null, label: string | null) {
    if (label) return label;
    if (id === null) return allowedDimension === 'agents' ? 'Direct chat' : 'Unknown';
    if (allowedDimension === 'agents') return agents.data?.items.find((agent) => agent.id === id)?.name ?? 'Deleted agent';
    if (allowedDimension === 'members') return members.data?.get(id)?.name ?? 'Deleted member';
    if (allowedDimension === 'api_keys') return keys.data?.find((key) => key.id === id)?.name ?? 'Deleted API key';
    return id;
  }
  const maximum = Math.max(1, ...(ranks.data?.map((entry) => entry.tokens) ?? []));
  return <Card className="overflow-hidden"><CardHeader title="Who uses what" description="Top 10 by tokens in the selected window." actions={<Select aria-label="Rank by" value={allowedDimension} onValueChange={setDimension} options={[{ value: 'agents', label: 'Agents' }, { value: 'models', label: 'Models' }, ...(can('quota:manage') ? [{ value: 'members' as const, label: 'Members' }, { value: 'api_keys' as const, label: 'API keys' }] : [])]} size="sm" />} />
    {ranks.isError ? <ErrorState error={ranks.error} onRetry={() => void ranks.refetch()} /> : ranks.isPending ? <Skeleton className="m-5 h-32" /> : !ranks.data.length ? <EmptyState icon={<Bot />} title="No activity to rank yet" description="Rankings appear as agents and models are used." /> : <Table><THead><tr><TH>{allowedDimension.replace('_', ' ')}</TH><TH>Tokens</TH><TH>Calls</TH><TH>Throttled</TH></tr></THead><TBody>{ranks.data.map((entry, index) => <TR key={entry.key ?? index} className={ranks.isPlaceholderData ? 'opacity-50' : ''}><TD><span className="mr-3 font-mono text-faint">{String(index + 1).padStart(2, '0')}</span>{name(entry.key, entry.label)}</TD><TD className="w-[40%]"><div className="flex items-center gap-4"><span className="w-20 shrink-0 text-right font-mono tabular">{number(entry.tokens)}</span><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-well-strong"><span className="block h-full bg-brand-500" style={{ width: `${entry.tokens / maximum * 100}%` }} /></span></div></TD><TD className="font-mono tabular">{number(entry.invocations)}</TD><TD className="font-mono tabular">{number(entry.throttled)}</TD></TR>)}</TBody></Table>}
  </Card>;
}

function SecurityFeed() {
  const ws = useWorkspace(); const can = useCan();
  const feed = useInfiniteQuery({ queryKey: ['ws', ws.id, 'analytics', 'security'], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam, signal }) => analyticsApi.security(ws.id, pageParam, signal), getNextPageParam: (page) => page.length === 50 ? page.at(-1)?.at : undefined });
  const records = [...new Map(feed.data?.pages.flat().map((entry) => [entry.id, entry])).values()];
  return <Card><CardHeader title="Security event feed" icon={<ShieldAlert />} description="Latest warnings and critical events, independent of the analytics time window." actions={<Button size="sm" variant="secondary" loading={feed.isRefetching} onClick={() => void feed.refetch()}><RefreshCw />Refresh feed</Button>} /><CardBody>
    {feed.isPending ? <Skeleton className="h-36" /> : feed.isError && !records.length ? <ErrorState error={feed.error} onRetry={() => void feed.refetch()} /> : !records.length ? <EmptyState icon={<CheckCheck />} title="No security alerts" description="Warnings and critical events will appear here." /> : <div className="grid divide-y divide-line">{records.map((event) => <article key={event.id} className="flex items-start gap-3 py-4 first:pt-0"><span className={cn('mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg', event.severity === 'CRITICAL' ? 'bg-danger-50 text-danger-600' : 'bg-warning-50 text-warning-600')}><ShieldAlert className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-[13px] font-medium text-ink">{event.action}</p><SeverityBadge severity={event.severity} /><Badge>{event.status.toLowerCase()}</Badge></div><p className="mt-1 text-xs text-muted">{event.actorLabel ?? event.actorType} · {formatDateTime(event.at)}{event.ipAddress ? ` · ${event.ipAddress}` : ''}</p>{event.errorCode ? <p className="mt-1 font-mono text-xs text-danger-700">{event.errorCode}</p> : null}{event.resourceId ? <p className="mt-1 truncate text-xs text-muted">{event.resourceType}: {event.resourceId}</p> : null}</div>{event.requestId && can('audit:read') ? <Link to={`/w/${ws.slug}/audit?requestId=${encodeURIComponent(event.requestId)}`} className="shrink-0 text-xs font-medium text-brand-700 hover:underline">View trail</Link> : null}</article>)}</div>}
    {feed.isFetchNextPageError ? <ErrorState error={feed.error} title="Older events unavailable" onRetry={() => void feed.fetchNextPage()} /> : null}
    {feed.hasNextPage ? <Button className="mt-4 w-full" variant="secondary" loading={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}><ArrowDown />Load older</Button> : null}
  </CardBody></Card>;
}
