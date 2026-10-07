import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, History, Plus, Search, Wrench } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { EmptyState, ErrorState, PageHeader } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Pagination } from '@/components/ui/pagination';
import { Segmented } from '@/components/ui/segmented';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { useDebouncedValue, useDocumentTitle } from '@/lib/hooks';
import { toolsQuery } from '@/lib/tools/queries';
import { PolicyBadges, ToolBadges } from './shared';
import { useToolCan } from './use-tool-can';

export function ToolsPage() {
  const can = useToolCan();
  const ws = useWorkspace();
  useDocumentTitle('Tools');
  return can.read ? <ToolsDirectory /> : <Card><NoAccessState permissions={['tool:read']} workspaceName={ws.name} /></Card>;
}
function ToolsDirectory() {
  const ws = useWorkspace();
  const can = useToolCan();
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const debounced = useDebouncedValue(search);
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const rawKind = params.get('kind');
  const kind = rawKind === 'BUILTIN' || rawKind === 'HTTP' ? rawKind : 'all';
  const query = useQuery(toolsQuery(ws.id, { page, limit: 18, search: debounced, ...(kind === 'all' ? {} : { kind }) }));
  const write = (key: string, value: string) => setParams((old) => { const next = new URLSearchParams(old); if (value) next.set(key, value); else next.delete(key); if (key !== 'page') next.delete('page'); return next; }, { replace: true });
  const base = `/w/${ws.slug}/tools`;
  return <div className="grid gap-6">
    <PageHeader overline="CAPABILITIES / TOOLS" title="Tools" description="Give agents and workflows controlled ways to calculate, find knowledge and act. Every execution passes through your workspace’s data policy."
      actions={<>{can.ledger && <Button asChild variant="secondary"><Link to={`${base}/executions`}><History />Execution ledger</Link></Button>}{can.create && <Button asChild><Link to={`${base}/new`}><Plus />New HTTP tool</Link></Button>}</>} />
    <div className="flex flex-wrap items-center justify-between gap-3"><Input aria-label="Search tools" placeholder="Search name or display name" leading={<Search />} value={search} onChange={(e) => write('search', e.target.value)} className="w-full sm:max-w-sm" maxLength={200} /><Segmented value={kind} onValueChange={(value) => write('kind', value === 'all' ? '' : value)} aria-label="Tool kind" options={[{ value: 'all', label: 'All tools' }, { value: 'BUILTIN', label: 'Built-in' }, { value: 'HTTP', label: 'HTTP integrations' }]} /></div>
    {query.isPending ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((id) => <Skeleton key={id} className="h-56 rounded-xl" />)}</div> : query.isError ? <Card><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Card> : !query.data.items.length ? <Card><EmptyState icon={<Wrench />} title="No tools match" description="Change the search or kind filter, or define an HTTP integration." /></Card> :
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{query.data.items.map((tool) => <li key={tool.id}><Link to={`${base}/${tool.id}`} className={`group flex h-full flex-col gap-4 rounded-xl border border-line bg-surface p-5 shadow-card transition hover:border-brand-300 hover:shadow-md ${!tool.available ? 'opacity-65' : ''}`}>
        <div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-well text-brand-700"><Wrench className="size-5" /></span><div className="min-w-0 flex-1"><h2 className="truncate font-semibold text-ink">{tool.displayName}</h2><p className="truncate font-mono text-xs text-muted">{tool.name}</p></div><ArrowUpRight className="size-4 text-faint group-hover:text-brand-600" /></div>
        <ToolBadges tool={tool} /><p className="line-clamp-3 text-[13px] leading-relaxed text-muted">{tool.description}</p><div className="mt-auto"><PolicyBadges tool={tool} /></div>{!tool.available && <p className="text-xs text-muted">Not available on this deployment</p>}
      </Link></li>)}</ul>}
    {query.data && <Pagination pagination={query.data.pagination} onPageChange={(next) => write('page', String(next))} busy={query.isFetching} noun={['tool', 'tools']} />}
  </div>;
}
