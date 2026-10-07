import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { useState } from 'react';
import { ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Spinner } from '@/components/ui/spinner';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { useDebouncedValue } from '@/lib/hooks';
import { toolsQuery } from '@/lib/tools/queries';
import { PolicyBadges, ToolBadges } from './shared';
import { useToolCan } from './use-tool-can';

/** Agent-grant picker: all catalogue pages, explicit selections and no inferred grants. */
export function ToolGrantPicker({ selected, onChange, disabled }: { selected: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const can = useToolCan();
  return can.read ? <Picker selected={selected} onChange={onChange} disabled={disabled} /> : <Callout tone="neutral">Choosing tools needs tool:read. Existing grants are preserved when you save.</Callout>;
}
function Picker({ selected, onChange, disabled }: { selected: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const ws = useWorkspace();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(search);
  const query = useQuery(toolsQuery(ws.id, { page, limit: 10, search: debounced }));
  return <div className="grid gap-3">
    <p className="text-[13px] text-muted">Grant up to 20 tools. Calls still check the person’s permissions and the context’s data labels each time.</p>
    {selected.length > 0 && <div className="flex flex-wrap gap-2" aria-label="Granted tools">{selected.map((id) => <span key={id} className="flex max-w-full items-center gap-1 rounded-md border border-line bg-well pl-2 text-xs text-ink-soft"><span className="truncate" title={id}>{query.data?.items.find((tool) => tool.id === id)?.displayName ?? id}</span><Button variant="ghost" size="icon-xs" disabled={disabled} aria-label={`Remove tool ${id}`} onClick={() => onChange(selected.filter((value) => value !== id))}><X /></Button></span>)}</div>}
    <Input leading={<Search />} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search tools to grant" aria-label="Search tools to grant" disabled={disabled} />
    {query.isPending ? <Spinner /> : query.isError ? <ErrorState compact error={query.error} onRetry={() => void query.refetch()} /> : <div className="divide-y divide-line rounded-lg border border-line">{query.data.items.length ? query.data.items.map((tool) => {
      const checked = selected.includes(tool.id);
      return <div key={tool.id} className="grid gap-2 p-3"><Checkbox checked={checked} onCheckedChange={(next) => onChange(next ? [...selected, tool.id] : selected.filter((id) => id !== tool.id))} disabled={disabled || (!checked && (!tool.enabled || !tool.available || selected.length >= 20))} label={tool.displayName} description={tool.description} /><div className="ml-7 grid gap-1.5"><ToolBadges tool={tool} /><PolicyBadges tool={tool} /></div></div>;
    }) : <p className="p-4 text-sm text-muted">No matching tools.</p>}</div>}
    {selected.length >= 20 && <Callout tone="neutral">All 20 grant slots are in use. Remove a tool before adding another.</Callout>}
    {query.data && query.data.pagination.totalPages > 1 && <Pagination pagination={query.data.pagination} onPageChange={setPage} busy={query.isFetching} noun={['tool', 'tools']} />}
  </div>;
}
