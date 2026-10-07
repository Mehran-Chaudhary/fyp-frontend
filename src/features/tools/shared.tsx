import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import type { Tool, ToolExecutionStatus } from '@/lib/tools/types';

export function ToolsBack({ children = 'Tools' }: { children?: ReactNode }) {
  const ws = useWorkspace();
  return <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit"><Link to={`/w/${ws.slug}/tools`}><ArrowLeft />{children}</Link></Button>;
}
export function ToolBadges({ tool }: { tool: Tool }) {
  return <div className="flex flex-wrap gap-1.5">
    <Badge tone={tool.kind === 'BUILTIN' ? 'info' : 'brand'}>{tool.kind === 'BUILTIN' ? 'Built-in' : 'HTTP'}</Badge>
    <Badge tone={tool.enabled ? 'success' : 'neutral'} dot>{tool.enabled ? 'Enabled' : 'Disabled'}</Badge>
    <Badge tone="outline">v{tool.version}</Badge>
    {!tool.available && <Badge tone="warning">Unavailable</Badge>}
    {tool.http && tool.http.auth.type !== 'none' && !tool.hasSecret && <Badge tone="danger">Credential missing</Badge>}
  </div>;
}
export function PolicyBadges({ tool }: { tool: Tool }) {
  return <div className="flex flex-wrap gap-1.5">
    <Badge><ShieldCheck />{tool.dataPolicy.maxClassification} ceiling</Badge>
    {tool.dataPolicy.piiArguments === 'unmask' && <Badge tone="warning">May receive personal data</Badge>}
    {tool.dataPolicy.sideEffects && <Badge tone="warning">Acts externally</Badge>}
    {tool.requiresApproval && <Badge tone="info">Needs approval</Badge>}
  </div>;
}
export function ExecutionBadge({ status }: { status: ToolExecutionStatus | 'ok' | 'error' | 'denied' }) {
  const tone = status === 'SUCCEEDED' || status === 'ok' ? 'success' : status === 'RUNNING' ? 'info' : status === 'DENIED' || status === 'denied' ? 'warning' : 'danger';
  return <Badge tone={tone} dot>{status === 'ok' ? 'Succeeded' : status === 'error' ? 'Failed' : status === 'denied' ? 'Denied' : status.replaceAll('_', ' ')}</Badge>;
}
export function JsonView({ value }: { value: unknown }) {
  return <pre className="scrollbar-thin max-h-[28rem] overflow-auto rounded-lg border border-line bg-well/60 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-ink-soft">{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>;
}
