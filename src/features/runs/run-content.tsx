import { useQuery } from '@tanstack/react-query';
import { Eye, EyeOff, Shield } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ErrorState } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Spinner } from '@/components/ui/spinner';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { runsApi } from '@/lib/api/runs';
import type { ContentView } from '@/lib/runs/types';

const reasons: Record<string, string> = { CLEARANCE: 'Your clearance does not allow this content.', COMPARTMENT: 'You do not have access to one of its sources.', SOURCE_DELETED: 'A source used by this step was deleted.', REDACTION_UNAVAILABLE: 'Content is protected while redaction is unavailable.', NOT_AVAILABLE: 'This content is not available yet.' };
export function RunContent({ runId, stepId }: { runId: string; stepId?: string }) {
  const ws = useWorkspace(); const can = useCan();
  const [revealed, setRevealed] = useState<ContentView | null>(null); const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const controller = useRef<AbortController | null>(null);
  const query = useQuery({ queryKey: ['ws', ws.id, 'run', runId, 'content', stepId ?? 'run'], queryFn: ({ signal }) => runsApi.content(ws.id, runId, stepId, false, signal), gcTime: 0, staleTime: 0 });
  useEffect(() => {
    const clear = () => { if (document.visibilityState !== 'visible') { controller.current?.abort(); setRevealed(null); } };
    document.addEventListener('visibilitychange', clear);
    const timer = window.setInterval(() => setRevealed(null), 60_000);
    return () => { controller.current?.abort(); document.removeEventListener('visibilitychange', clear); window.clearInterval(timer); };
  }, []);
  const reveal = async () => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort; setBusy(true); setError(null);
    try { const value = await runsApi.content(ws.id, runId, stepId, true, abort.signal); if (!abort.signal.aborted) { setRevealed(value); setConfirm(false); } }
    catch (cause) { if (!abort.signal.aborted) setError(cause); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  };
  const content = revealed ?? query.data;
  return <section className="grid gap-4" aria-label={stepId ? 'Step content' : 'Run content'}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-semibold"><Shield className="size-4" />{stepId ? 'Step content' : 'Run input & output'}</h3>{revealed ? <Button variant="secondary" size="sm" onClick={() => setRevealed(null)}><EyeOff />Hide personal data</Button> : can('pii:reveal') && content?.contentState === 'MASKED' ? <Button variant="secondary" size="sm" onClick={() => setConfirm(true)}><Eye />Reveal personal data</Button> : null}</div>
    {query.isError ? <ErrorState compact error={query.error} onRetry={() => void query.refetch()} /> : query.isPending ? <Spinner /> : content && <>
      <div className="flex gap-2"><Badge>{content.classification}</Badge><Badge tone={content.contentState === 'WITHHELD' ? 'warning' : 'neutral'}>{content.contentState}</Badge></div>
      {content.contentState === 'WITHHELD' ? <Callout tone="warning" title="Content withheld">{reasons[content.withheldReason ?? 'NOT_AVAILABLE'] ?? 'You cannot view this content.'}</Callout> : <>
        {content.contentState === 'MASKED' && <p className="text-xs text-muted">Personal data is masked for supervision. This access is audited.</p>}
        {revealed && <Callout tone="warning" title="Personal data is visible">This reveal was audited. Values are cleared when you leave, hide the tab, or after one minute.</Callout>}
        <div className="grid gap-4 xl:grid-cols-2">{(['input', 'output'] as const).map(key => <div key={key} className="min-w-0"><h4 className="mb-2 text-xs font-medium capitalize text-muted">{key}</h4><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-well p-4 font-mono text-xs leading-relaxed">{content[key] === null || content[key] === undefined ? 'Not available' : typeof content[key] === 'string' ? content[key] as string : JSON.stringify(content[key], null, 2)}</pre></div>)}</div>
      </>}
    </>}
    <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Reveal personal data?" description="The original values will be shown temporarily. A critical audit event records this access." confirmLabel="Reveal personal data" pending={busy} onConfirm={() => void reveal()}>{error ? <ErrorState compact error={error} /> : null}</ConfirmDialog>
  </section>;
}
