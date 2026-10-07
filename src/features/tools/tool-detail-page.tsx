import { useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { NoAccessState } from '@/components/feedback/no-access';
import { ErrorState, PageHeader } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/misc';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { toolsApi } from '@/lib/api/tools';
import { useDocumentTitle } from '@/lib/hooks';
import { toolKeys, toolQuery } from '@/lib/tools/queries';
import { JsonView, PolicyBadges, ToolBadges, ToolsBack } from './shared';
import { useToolCan } from './use-tool-can';
import { ToolTestConsole } from './tool-test-console';

export function ToolDetailPage() {
  const can = useToolCan();
  const ws = useWorkspace();
  return can.read ? <Detail /> : <Card><NoAccessState permissions={['tool:read']} workspaceName={ws.name} /></Card>;
}
function Detail() {
  const ws = useWorkspace();
  const can = useToolCan();
  const { toolId = '' } = useParams();
  const query = useQuery(toolQuery(ws.id, toolId));
  const client = useQueryClient();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  useDocumentTitle(query.data?.displayName ?? 'Tool');
  const remove = async () => {
    if (pending) return;
    setPending(true); setError(undefined);
    try {
      await toolsApi.delete(ws.id, toolId);
      client.removeQueries({ queryKey: toolKeys.detail(ws.id, toolId) });
      await client.invalidateQueries({ queryKey: toolKeys.lists(ws.id) });
      await client.invalidateQueries({ queryKey: ['ws', ws.id, 'agent-tools'] });
      toast.success('Tool deleted');
      navigate(`/w/${ws.slug}/tools`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete the tool.'); }
    finally { setPending(false); }
  };
  if (query.isPending) return <Skeleton className="h-96 rounded-xl" />;
  if (query.isError) return <Card><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Card>;
  const tool = query.data;
  const base = `/w/${ws.slug}/tools`;
  return <div className="grid gap-5"><ToolsBack /><PageHeader overline={<span className="font-mono">{tool.name}</span>} title={tool.displayName} description={tool.description} actions={<>{can.ledger && <Button asChild variant="secondary"><Link to={`${base}/executions?toolId=${tool.id}`}><History />Ledger</Link></Button>}{tool.kind === 'HTTP' && can.update && <Button asChild><Link to={`${base}/${tool.id}/edit`}><Pencil />Edit</Link></Button>}{tool.kind === 'HTTP' && can.delete && <Button variant="ghost" aria-label="Delete tool" onClick={() => setDeleting(true)}><Trash2 /></Button>}</>} />
    <ToolBadges tool={tool} /><PolicyBadges tool={tool} />
    {!tool.available && <Callout tone="warning" title="Not available on this deployment">A required service or HTTP egress allowlist is not configured. Ask the platform operator to enable it.</Callout>}
    {tool.http && tool.http.auth.type !== 'none' && !tool.hasSecret && <Callout tone="warning" title="Credential missing">Every call will fail until a credential is configured in the editor.</Callout>}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,1fr)]"><div className="grid min-w-0 gap-5">
      <Card><CardHeader title="Definition" /><CardBody><dl className="divide-y divide-line"><DetailRow label="Kind">{tool.kind === 'BUILTIN' ? 'Platform built-in · read-only' : 'HTTP integration'}</DetailRow><DetailRow label="Timeout">{tool.timeoutMs.toLocaleString()} ms</DetailRow><DetailRow label="Result integrity">{tool.resultIntegrity}</DetailRow><DetailRow label="Minimum context integrity">{tool.dataPolicy.minIntegrity}</DetailRow><DetailRow label="Additional permissions">{tool.requiredPermissions.length ? tool.requiredPermissions.join(', ') : 'None'}</DetailRow><DetailRow label="Credential">{tool.http?.auth.type === 'none' || !tool.http ? 'Not required' : tool.hasSecret ? 'Configured · write-only' : 'Missing'}</DetailRow></dl><details className="mt-4"><summary className="cursor-pointer text-xs text-muted">Definition digest</summary><p className="mt-2 font-mono text-xs break-all text-muted">{tool.digest}</p></details></CardBody></Card>
      {tool.http && <Card><CardHeader title={`${tool.http.method} request`} description="Readable by workspace members with tool:read. The credential is never returned." /><CardBody><JsonView value={tool.http} /></CardBody></Card>}
      <Card><CardHeader title="Parameters" description="Arguments accepted by this version of the tool." /><CardBody><JsonView value={tool.parameters} /></CardBody></Card>
    </div><div className="min-w-0">{can.test ? <ToolTestConsole key={`${ws.id}:${tool.id}:${tool.version}`} tool={tool} /> : <Card><NoAccessState permissions={['tool:update + tool:execute']} workspaceName={ws.name} title="Test console requires additional access" /></Card>}</div></div>
    <ConfirmDialog open={deleting} onOpenChange={setDeleting} title={`Delete ${tool.displayName}?`} description="Agents granted this tool stop being offered it at once; its credential is destroyed; history stays. Workflow versions that reference it become invalid at their next validation or publish." confirmLabel="Delete tool" tone="danger" pending={pending} error={error} onConfirm={() => void remove()} />
  </div>;
}
