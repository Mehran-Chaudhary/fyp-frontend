import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Callout } from '@/components/ui/callout';
import { ErrorState } from '@/components/feedback/states';
import { RateLimitNotice } from '@/components/feedback/global-states';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { call, workspacePath } from '@/lib/api/client';
import { isApiError } from '@/lib/api/errors';
import { runsApi, runKeys } from '@/lib/api/runs';
import { parseRunInput } from '@/lib/runs/state';

interface Props { workflowId: string; publishedVersion: number | null; latestVersion: number; open: boolean; onOpenChange: (open: boolean) => void }
export function RunStartDialog(props: Props) {
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}><DialogContent size="lg">{props.open && <RunForm {...props} />}</DialogContent></Dialog>;
}
function RunForm({ workflowId, publishedVersion, latestVersion, onOpenChange }: Props) {
  const ws = useWorkspace(); const can = useCan(); const navigate = useNavigate(); const client = useQueryClient();
  const [test, setTest] = useState(publishedVersion === null);
  const [version, setVersion] = useState(latestVersion);
  const [input, setInput] = useState('{}'); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const [until, setUntil] = useState<number | null>(null); const [uncertain, setUncertain] = useState(false);
  const submission = useRef<{ body: string; key: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const selected = test ? version : publishedVersion;
  const definition = useQuery({ queryKey: ['ws', ws.id, 'workflow', workflowId, 'run-schema', selected], enabled: !!selected && can('workflow:read'),
    queryFn: ({ signal }) => { const [path, ctx] = workspacePath(ws.id, `/workflows/${workflowId}/versions/${selected}`); return call<{ graph: { nodes: Array<{ type: string; data: { inputSchema?: Record<string, unknown> } }> } }>(path, { ...ctx, signal }); } });
  const schema = definition.data?.graph.nodes.find(node => node.type === 'trigger')?.data.inputSchema;
  const submit = async () => {
    if (busy) return;
    setError(null);
    try {
      const parsed = parseRunInput(input);
      const body = JSON.stringify({ input: parsed, ...(test ? { version } : {}) });
      if (!submission.current || submission.current.body !== body) submission.current = { body, key: crypto.randomUUID() };
      setBusy(true);
      const controller = new AbortController(); abort.current = controller;
      const run = await runsApi.start(ws.id, workflowId, { input: parsed, idempotencyKey: submission.current.key, ...(test ? { version } : {}) }, controller.signal);
      if (controller.signal.aborted) return;
      await client.invalidateQueries({ queryKey: runKeys.list(ws.id) });
      void client.invalidateQueries({ queryKey: ['ws', ws.id, 'workflow', workflowId] });
      void client.invalidateQueries({ queryKey: ['ws', ws.id, 'workflows'] });
      onOpenChange(false); navigate(`/w/${ws.slug}/runs/${run.id}`);
    } catch (cause) {
      if (abort.current?.signal.aborted) return;
      setError(cause);
      if (isApiError(cause)) {
        if (cause.status === 429) setUntil(cause.retryDeadline());
        setUncertain(['NETWORK_ERROR', 'NETWORK_TIMEOUT'].includes(cause.code));
      }
    } finally { setBusy(false); }
  };
  return <><DialogHeader icon={<Play />} title="Run workflow" description="Each run uses a saved version and your current workspace permissions." />
    <DialogBody className="grid gap-4">
      {can('workflow:update') && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={test} disabled={busy || uncertain} onChange={event => setTest(event.target.checked)} />Test a saved version</label>}
      {test ? <Field label="Version" hint="Test runs can use draft and archived definitions."><Input type="number" min={1} max={latestVersion} value={version} disabled={busy || uncertain} onChange={event => setVersion(Number(event.target.value))} /></Field> : <p className="text-sm text-muted">Published version {publishedVersion ?? '—'}</p>}
      {schema && <details className="rounded-lg border border-line bg-well p-3"><summary className="cursor-pointer text-sm font-medium">Trigger input schema</summary><pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(schema, null, 2)}</pre></details>}
      <Field label="Run input (JSON)" hint="An object matching the trigger schema. Defaults are applied by the workflow."><Textarea rows={8} className="font-mono text-xs" value={input} disabled={busy || uncertain} onChange={event => setInput(event.target.value)} spellCheck={false} /></Field>
      {uncertain && <Callout tone="warning" title="The start request may have succeeded">Retry sends the same submission key, so it cannot start a duplicate run. Keep this dialog open to recover the result.</Callout>}
      {error ? (error instanceof Error && !isApiError(error) ? <p role="alert" className="text-sm text-danger-700">{error.message}</p> : <ErrorState compact error={error} title="Could not start the run" />) : null}
      {isApiError(error) && error.details?.issues ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-well p-3 text-xs">{JSON.stringify(error.details.issues, null, 2)}</pre> : null}
      <RateLimitNotice until={until} onDone={() => setUntil(null)} />
    </DialogBody><DialogFooter><Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Close</Button><Button loading={busy} disabled={!!until || !can('workflow:execute') || (!test && !publishedVersion) || (test && (!can('workflow:update') || !Number.isInteger(version) || version < 1 || version > latestVersion))} onClick={() => void submit()}><Play />{uncertain ? 'Recover run' : test ? 'Start test run' : 'Start run'}</Button></DialogFooter></>;
}
