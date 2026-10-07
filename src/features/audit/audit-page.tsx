import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Download, Filter, Search, ShieldCheck, ShieldAlert, ListChecks, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { EmptyState, ErrorState, PageHeader } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Callout } from '@/components/ui/callout';
import { CodeBlock } from '@/components/ui/code-block';
import { Drawer, DrawerSection } from '@/components/ui/drawer';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Table, TableMessage, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { auditApi } from '@/lib/api/governance';
import type { AuditFilters, AuditLog } from '@/lib/api/governance-types';
import { useDocumentTitle } from '@/lib/hooks';
import { toast } from '@/lib/toast';
import { formatDateTime } from '@/lib/utils';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { saveGovernanceFile, validateWindow } from '@/features/governance/helpers';
import { DetailRows, MetricCard, SeverityBadge } from '@/features/governance/shared';

const textFilters = [
  ['action', 'Exact action', 'workflow.execution.completed'], ['actionPrefix', 'Action prefix', 'workflow.'],
  ['actorId', 'Actor user / key ID', 'UUID'], ['resourceType', 'Resource type', 'workflow_run'],
  ['resourceId', 'Resource ID', 'Resource identifier'], ['requestId', 'Request ID', 'Trace a request'],
  ['ipAddress', 'IP address', '127.0.0.1'],
] as const;

export function AuditPage() {
  const ws = useWorkspace(); const can = useCan(); useDocumentTitle('Audit log');
  if (!can('audit:read')) return <NoAccessState permissions={['audit:read']} workspaceName={ws.name} />;
  return <AuditContent key={ws.id} />;
}

function AuditContent() {
  const ws = useWorkspace(); const can = useCan(); const client = useQueryClient(); const [params] = useSearchParams();
  const [draft, setDraft] = useState<Record<string, string>>({ requestId: params.get('requestId') ?? '' });
  const [filters, setFilters] = useState<AuditFilters>({ requestId: params.get('requestId') ?? undefined, page: 1, limit: 50 });
  const [filterError, setFilterError] = useState(''); const [expanded, setExpanded] = useState(Boolean(params.get('requestId')));
  const [selected, setSelected] = useState<AuditLog | null>(null); const [maximum, setMaximum] = useState('');
  const requestLifetime = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); requestLifetime.current = controller; return () => controller.abort(); }, []);
  const logs = useQuery({ queryKey: ['ws', ws.id, 'audit', 'records', filters], queryFn: ({ signal }) => auditApi.list(ws.id, filters, signal), placeholderData: keepPreviousData });
  const stats = useQuery({ queryKey: ['ws', ws.id, 'audit', 'statistics'], queryFn: ({ signal }) => auditApi.statistics(ws.id, signal) });
  const archives = useQuery({ queryKey: ['ws', ws.id, 'audit', 'archives'], queryFn: ({ signal }) => auditApi.archives(ws.id, signal) });
  const verify = useMutation({ mutationFn: () => auditApi.verify(ws.id, maximum ? Number(maximum) : undefined, requestLifetime.current?.signal), onSuccess: () => void client.invalidateQueries({ queryKey: ['ws', ws.id, 'audit', 'statistics'] }) });
  const exportFile = useMutation({ mutationFn: async (sequence?: string) => {
    const signal = requestLifetime.current?.signal;
    const file = sequence ? await auditApi.archive(ws.id, sequence, signal) : await auditApi.export(ws.id, { from: filters.from, to: filters.to }, signal);
    if (signal?.aborted) return;
    saveGovernanceFile(file, sequence ? `audit-archive-${sequence}.ndjson` : 'audit-log.ndjson');
  }, onSuccess: () => toast.success('Audit download ready') });
  function apply() {
    if (draft.from && draft.to) { const error = validateWindow(draft.from, draft.to, Number.MAX_SAFE_INTEGER); if (error) { setFilterError(error); return; } }
    if (draft.actorId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draft.actorId)) { setFilterError('Actor ID must be a valid UUID.'); return; }
    const next: Record<string, string | number> = { page: 1, limit: 50 };
    for (const [key, value] of Object.entries(draft)) if (value.trim() && value !== 'all') next[key] = key === 'from' || key === 'to' ? new Date(value).toISOString() : value.trim();
    setFilterError(''); setFilters(next);
  }
  return <div className="grid gap-6">
    <PageHeader overline="Governance & assurance" title="Audit log" description="A tamper-evident record of workspace activity. Follow an action from request to outcome." actions={<Button variant="secondary" loading={logs.isFetching} onClick={() => void client.invalidateQueries({ queryKey: ['ws', ws.id, 'audit'] })}><RefreshCw />Refresh</Button>} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Records retained" value={stats.data ? BigInt(stats.data.totalRecords).toLocaleString() : '—'} detail="All time · across this workspace" icon={<ListChecks />} />
      <MetricCard label="Chain head" value={stats.data ? `#${stats.data.headSequence}` : '—'} detail="Append-only sequence" icon={<ShieldCheck />} />
      <MetricCard label="Warnings" value={stats.data ? (stats.data.bySeverity.WARNING ?? 0).toLocaleString() : '—'} detail="All retained records" icon={<ShieldAlert />} warning />
      <MetricCard label="Critical events" value={stats.data ? (stats.data.bySeverity.CRITICAL ?? 0).toLocaleString() : '—'} detail="Review access and policy changes" icon={<ShieldAlert />} warning />
    </div>
    {stats.isError ? <ErrorState error={stats.error} title="Statistics unavailable" onRetry={() => void stats.refetch()} /> : null}
    <Card><CardHeader title="Chain integrity" icon={<ShieldCheck />} description="Verify stored records against the server’s cryptographic chain." /><CardBody className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3"><Field label="Maximum records" optional hint="Leave blank to verify the whole retained chain."><Input aria-label="Maximum records" type="number" min={1} step={1} value={maximum} onChange={(e) => setMaximum(e.target.value)} placeholder="All records" disabled={!can('audit:verify') || verify.isPending} /></Field><Button variant="secondary" loading={verify.isPending} disabled={!can('audit:verify') || Boolean(maximum && (!Number.isSafeInteger(Number(maximum)) || Number(maximum) < 1))} onClick={() => verify.mutate()}><ShieldCheck />{verify.isPending ? 'Verifying chain…' : 'Verify chain'}</Button></div>
      {!can('audit:verify') ? <p className="text-xs text-muted">Verification requires audit:verify permission.</p> : null}
      {verify.isPending ? <Callout role="status">Checking the chain. Large logs can take up to two minutes.</Callout> : null}
      {verify.isError ? <ErrorState error={verify.error} title="Verification could not finish" /> : null}
      {verify.data ? <Callout role={verify.data.valid ? 'status' : 'alert'} tone={verify.data.valid ? 'success' : 'danger'} title={verify.data.valid ? `Verified ${verify.data.recordsChecked.toLocaleString()} records` : `Chain broken at record ${verify.data.brokenAtSequence ?? 'unknown'}`}>
        {verify.data.valid ? `Integrity confirmed ${formatDateTime(verify.data.verifiedAt)}.` : verify.data.reason ?? 'The chain could not be validated. Review this incident with your administrator.'}
        {verify.data.prunedThroughSequence ? <p>Signed retention anchor through sequence {verify.data.prunedThroughSequence}.</p> : null}
      </Callout> : null}
    </CardBody></Card>
    <Card className="overflow-hidden"><CardHeader title="Activity trail" description="Newest records first. Filters apply to the table; export uses the applied time window." actions={<div className="flex gap-2"><Button variant="secondary" size="sm" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}><Filter />Filters</Button>{can('audit:export') ? <Button variant="secondary" size="sm" loading={exportFile.isPending} onClick={() => exportFile.mutate(undefined)}><Download />Export NDJSON</Button> : null}</div>} />
      {expanded ? <form className="grid gap-4 border-t border-b border-line bg-well/40 p-5 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(e) => { e.preventDefault(); apply(); }}>
        {textFilters.map(([key, label, placeholder]) => <Field key={key} label={label}><Input value={draft[key] ?? ''} placeholder={placeholder} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} /></Field>)}
        {([['severity', 'Severity', ['INFO', 'NOTICE', 'WARNING', 'CRITICAL']], ['status', 'Status', ['SUCCESS', 'FAILURE', 'DENIED']], ['actorType', 'Actor type', ['USER', 'API_KEY', 'SYSTEM']]] as const).map(([key, label, values]) => <Field key={key} label={label}><Select value={draft[key] || 'all'} onValueChange={(value) => setDraft({ ...draft, [key]: value })} options={[{ value: 'all', label: 'All' }, ...values.map((value) => ({ value, label: value }))]} /></Field>)}
        {(['from', 'to'] as const).map((key) => <Field key={key} label={key === 'from' ? 'From (local time)' : 'To (local time)'}><Input type="datetime-local" value={draft[key] ?? ''} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} /></Field>)}
        <div className="flex items-end gap-2"><Button type="submit"><Search />Apply filters</Button><Button variant="ghost" onClick={() => { setDraft({}); setFilters({ page: 1, limit: 50 }); setFilterError(''); }}>Clear</Button></div><FormError message={filterError} />
      </form> : null}
      {exportFile.isPending ? <div className="px-5 pb-4"><Callout role="status">Preparing a secure download. Large exports can take up to two minutes.</Callout></div> : null}
      {exportFile.isError ? <ErrorState compact title="Download unavailable" error={exportFile.error} /> : null}
      <Table><THead><tr><TH>Action</TH><TH>Severity</TH><TH>Outcome</TH><TH>Actor</TH><TH>Time</TH><TH>Sequence</TH></tr></THead><TBody>
        {logs.isPending ? <TableMessage colSpan={6}><Skeleton className="m-5 h-36" /></TableMessage> : logs.isError ? <TableMessage colSpan={6}><ErrorState error={logs.error} onRetry={() => void logs.refetch()} /></TableMessage> : !logs.data?.items.length ? <TableMessage colSpan={6}><EmptyState icon={<Search />} title="No matching audit records" description="Try a broader time window or clear a filter." /></TableMessage> : logs.data.items.map((row) => <TR key={row.id} interactive className={logs.isPlaceholderData ? 'opacity-50' : ''}><TD><button onClick={() => setSelected(row)} className="text-left font-medium text-ink hover:text-brand-700 underline-offset-4 hover:underline">{row.action}</button><p className="mt-1 text-xs text-muted">{row.resourceLabel ?? row.resourceType ?? 'Workspace event'}</p></TD><TD><SeverityBadge severity={row.severity} /></TD><TD><Badge tone={row.status === 'SUCCESS' ? 'success' : row.status === 'DENIED' ? 'warning' : 'neutral'}>{row.status.toLowerCase()}</Badge></TD><TD>{row.actorLabel ?? row.actorType}</TD><TD className="whitespace-nowrap text-xs">{formatDateTime(row.createdAt)}</TD><TD className="font-mono text-xs">#{row.sequence}</TD></TR>)}
      </TBody></Table><Pagination pagination={logs.data?.pagination} busy={logs.isFetching} onPageChange={(page) => setFilters({ ...filters, page })} noun={['record', 'records']} className="border-t border-line px-5 py-4" />
    </Card>
    <div className="grid gap-6 lg:grid-cols-2"><Card><CardHeader title="Frequent actions" description="Across all retained records" /><CardBody><div className="grid gap-3">{stats.data?.topActions.slice(0, 8).map((row) => <div key={row.action} className="flex justify-between gap-3 text-[13px]"><button className="truncate text-ink-soft hover:text-brand-700" onClick={() => { setDraft({ action: row.action }); setFilters({ action: row.action, page: 1, limit: 50 }); }}>{row.action}</button><span className="font-mono tabular">{row.count.toLocaleString()}</span></div>)}</div></CardBody></Card>
      <Card><CardHeader title="Retention archives" icon={<Archive />} description="Historical records protected by signed retention anchors." /><CardBody>
        {archives.isError ? <ErrorState error={archives.error} onRetry={() => void archives.refetch()} /> : archives.isPending ? <Skeleton className="h-20" /> : !archives.data.length ? <p className="text-[13px] text-muted">No archived records. When retention archives are created, they appear here.</p> : <div className="grid gap-4">{archives.data.map((archive) => <div key={archive.sequence} className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">Records {archive.firstSequence}–{archive.sequence}</p><p className="text-xs text-muted">{archive.recordsPruned.toLocaleString()} records · {formatDateTime(archive.createdAt)}</p></div><Button aria-label={`Download archive ${archive.sequence}`} variant="secondary" size="icon-sm" disabled={!can('audit:export') || !archive.archived || exportFile.isPending} onClick={() => exportFile.mutate(archive.sequence)}><Download /></Button></div>)}</div>}
      </CardBody></Card></div>
    <Drawer open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }} title={selected?.action ?? 'Audit record'} description={selected ? `Record #${selected.sequence}` : undefined}>
      {selected ? <><DrawerSection title="Event"><DetailRows rows={[
        ['Time', formatDateTime(selected.createdAt)], ['Severity', <SeverityBadge severity={selected.severity} />], ['Status', selected.status], ['Actor', selected.actorLabel ?? selected.actorType], ['Actor ID', selected.actorId], ['Resource', selected.resourceLabel ?? selected.resourceType], ['Resource ID', selected.resourceId], ['IP address', selected.ipAddress], ['Request ID', selected.requestId], ['HTTP', selected.httpMethod ? `${selected.httpMethod} ${selected.httpPath ?? ''} · ${selected.httpStatus ?? '—'}` : null], ['Duration', selected.durationMs == null ? null : `${selected.durationMs} ms`], ['Error', selected.errorCode], ['Error detail', selected.errorMessage], ['User agent', selected.userAgent],
      ]} />{selected.requestId ? <Button className="mt-3" variant="secondary" size="sm" onClick={() => { setDraft({ requestId: selected.requestId! }); setFilters({ requestId: selected.requestId!, page: 1, limit: 50 }); setSelected(null); }}>Show this request’s trail</Button> : null}</DrawerSection><DrawerSection title="Redacted metadata" description="Secrets and content are excluded by the server."><CodeBlock label="Metadata" code={JSON.stringify(selected.metadata, null, 2)} /></DrawerSection></> : null}
    </Drawer>
  </div>;
}
