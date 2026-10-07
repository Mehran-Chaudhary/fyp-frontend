import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Callout } from '@/components/ui/callout';
import { ErrorState } from '@/components/feedback/states';
import { RateLimitNotice } from '@/components/feedback/global-states';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { call, workspacePath } from '@/lib/api/client';
import { isApiError } from '@/lib/api/errors';
import { runsApi, runKeys } from '@/lib/api/runs';
import { parseRunInput } from '@/lib/runs/state';
import type { JsonSchema } from '@/lib/tools/types';

interface Props { workflowId: string; publishedVersion: number | null; latestVersion: number; open: boolean; onOpenChange: (open: boolean) => void }
export function RunStartDialog(props: Props) {
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}><DialogContent size="lg">{props.open && <RunForm {...props} />}</DialogContent></Dialog>;
}
function RunForm({ workflowId, publishedVersion, latestVersion, onOpenChange }: Props) {
  const ws = useWorkspace(); const can = useCan(); const navigate = useNavigate(); const client = useQueryClient();
  const [test, setTest] = useState(publishedVersion === null);
  const [version, setVersion] = useState(latestVersion);
  const [input, setInput] = useState('{}'); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [values, setValues] = useState<Record<string, string>>({});
  const [until, setUntil] = useState<number | null>(null); const [uncertain, setUncertain] = useState(false);
  const submission = useRef<{ body: string; key: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const selected = test ? version : publishedVersion;
  const definition = useQuery({ queryKey: ['ws', ws.id, 'workflow', workflowId, 'run-schema', selected], enabled: !!selected && can('workflow:read'),
    queryFn: ({ signal }) => { const [path, ctx] = workspacePath(ws.id, `/workflows/${workflowId}/versions/${selected}`); return call<{ graph: { nodes: Array<{ type: string; data: { inputSchema?: JsonSchema } }> } }>(path, { ...ctx, signal }); } });
  const schema = definition.data?.graph.nodes.find(node => node.type === 'trigger')?.data.inputSchema;
  const properties = Object.entries(schema?.properties ?? {});
  const formValue = () => Object.fromEntries(properties.filter(([name]) => values[name] !== undefined && values[name] !== '').map(([name, field]) => {
    const type = Array.isArray(field.type) ? field.type.find(value => value !== 'null') : field.type;
    if (type === 'number' || type === 'integer') {
      const value = Number(values[name]);
      if (!Number.isFinite(value) || (type === 'integer' && !Number.isInteger(value))) throw new Error(`Enter a valid ${type} for ${name}.`);
      return [name, value];
    }
    if (type === 'boolean' || type === 'object' || type === 'array') {
      try { return [name, JSON.parse(values[name])]; } catch { throw new Error(`Enter valid JSON for ${name}.`); }
    }
    return [name, values[name]];
  }));
  const changeMode = (next: 'form' | 'json') => {
    try {
      if (next === 'json') setInput(JSON.stringify(formValue(), null, 2));
      else setValues(Object.fromEntries(Object.entries(parseRunInput(input)).map(([name, value]) => [name, typeof value === 'string' ? value : JSON.stringify(value)])));
      setMode(next); setError(null);
    } catch (cause) { setError(cause); }
  };
  const issues = isApiError(error) && Array.isArray(error.details?.issues) ? error.details.issues as Array<{ path?: string; instancePath?: string; message?: string; params?: { missingProperty?: string } }> : [];
  const submit = async () => {
    if (busy) return;
    setError(null);
    try {
      const parsed = parseRunInput(mode === 'form' && properties.length ? JSON.stringify(formValue()) : input);
      const body = JSON.stringify({ input: parsed, ...(test ? { version } : {}) });
      if (!submission.current || submission.current.body !== body) submission.current = { body, key: crypto.randomUUID() };
      setBusy(true);
      const controller = new AbortController(); abort.current = controller;
      const run = await runsApi.start(ws.id, workflowId, { input: parsed, idempotencyKey: submission.current.key, ...(test ? { version } : {}) }, controller.signal);
      if (controller.signal.aborted) return;
      void client.invalidateQueries({ queryKey: runKeys.list(ws.id) });
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
      {properties.length > 0 && <Segmented aria-label="Run input mode" value={mode} onValueChange={changeMode} options={[{ value: 'form', label: 'Input fields' }, { value: 'json', label: 'JSON' }]} />}
      {mode === 'form' && properties.length > 0 ? <fieldset disabled={busy || uncertain} className="grid gap-4">{properties.map(([name, field]) => {
        const type = Array.isArray(field.type) ? field.type.find(value => value !== 'null') : field.type;
        const value = values[name] ?? '';
        const change = (value: string) => setValues(current => ({ ...current, [name]: value }));
        const issue = issues.find(issue => [issue.path, issue.instancePath, issue.params?.missingProperty].some(path => path === name || path === `/${name}` || path === `input.${name}`));
        return <Field key={name} label={field.title ?? name} optional={!schema?.required?.includes(name)} error={issue?.message} hint={[field.description, field.default !== undefined ? `Default: ${JSON.stringify(field.default)}` : undefined].filter(Boolean).join(' ')}>
          {type === 'boolean' ? <Select value={value || '__default__'} onValueChange={next => change(next === '__default__' ? '' : next)} options={[{ value: '__default__', label: 'Use default / omit' }, { value: 'true', label: 'True' }, { value: 'false', label: 'False' }]} /> : field.enum?.length ? <Select value={value || '__default__'} onValueChange={next => change(next === '__default__' ? '' : next)} options={[{ value: '__default__', label: 'Use default / omit' }, ...field.enum.map(value => ({ value: String(value), label: String(value) })).filter(option => option.value !== '')]} /> : type === 'array' || type === 'object' ? <Textarea value={value} onChange={event => change(event.target.value)} className="font-mono text-xs" placeholder={`JSON ${type}`} /> : <Input type={type === 'number' || type === 'integer' ? 'number' : 'text'} step={type === 'integer' ? 1 : 'any'} value={value} onChange={event => change(event.target.value)} />}
        </Field>;
      })}</fieldset> : <Field label="Run input (JSON)" hint="An object matching the trigger schema. Defaults are applied by the workflow."><Textarea rows={8} className="font-mono text-xs" value={input} disabled={busy || uncertain} onChange={event => setInput(event.target.value)} spellCheck={false} /></Field>}
      {definition.isError && <ErrorState compact error={definition.error} title="Input schema unavailable" onRetry={() => void definition.refetch()} />}
      {uncertain && <Callout tone="warning" title="The start request may have succeeded">Retry sends the same submission key, so it cannot start a duplicate run. Keep this dialog open to recover the result.</Callout>}
      {error ? (error instanceof Error && !isApiError(error) ? <p role="alert" className="text-sm text-danger-700">{error.message}</p> : <ErrorState compact error={error} title="Could not start the run" />) : null}
      {isApiError(error) && error.details?.issues ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-well p-3 text-xs">{JSON.stringify(error.details.issues, null, 2)}</pre> : null}
      <RateLimitNotice until={until} onDone={() => setUntil(null)} />
    </DialogBody><DialogFooter><Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Close</Button><Button loading={busy} disabled={!!until || !can('workflow:execute') || (!test && !publishedVersion) || (test && (!can('workflow:update') || !Number.isInteger(version) || version < 1 || version > latestVersion))} onClick={() => void submit()}><Play />{uncertain ? 'Recover run' : test ? 'Start test run' : 'Start run'}</Button></DialogFooter></>;
}
