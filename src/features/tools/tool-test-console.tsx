import { useQueryClient } from '@tanstack/react-query';
import { Eraser, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, FormError } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { RequestReference } from '@/components/feedback/states';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { isApiError } from '@/lib/api/errors';
import { toolsApi } from '@/lib/api/tools';
import { parseTestArguments } from '@/lib/tools/editor';
import { toolKeys } from '@/lib/tools/queries';
import type { JsonSchema, Tool, ToolTestResult } from '@/lib/tools/types';
import { ExecutionBadge, JsonView } from './shared';

/** Results and arguments intentionally live only in mounted component state. */
export function ToolTestConsole({ tool }: { tool: Tool }) {
  const ws = useWorkspace();
  const client = useQueryClient();
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [values, setValues] = useState<Record<string, string>>({});
  const [raw, setRaw] = useState('{}');
  const [result, setResult] = useState<ToolTestResult | null>(null);
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const properties = Object.entries(tool.parameters.properties ?? {});
  const formArguments = () => Object.fromEntries(properties.filter(([name]) => values[name] !== undefined && values[name] !== '').map(([name, schema]) => [name, argumentValue(values[name], schema)]));
  const run = async () => {
    if (pending) return;
    setError(undefined);
    setResult(null);
    let args: Record<string, unknown>;
    try { args = parseTestArguments(mode === 'json' ? raw : JSON.stringify(formArguments())); } catch (cause) { setError(cause); return; }
    const current = new AbortController();
    controller.current = current;
    setPending(true);
    try {
      const outcome = await toolsApi.test(ws.id, tool.id, args, current.signal);
      if (!current.signal.aborted) setResult(outcome);
    } catch (cause) { if (!current.signal.aborted) setError(cause); }
    finally {
      void client.invalidateQueries({ queryKey: toolKeys.ledger(ws.id) });
      if (!current.signal.aborted) setPending(false);
    }
  };
  const switchMode = (next: 'form' | 'json') => {
    if (next === 'json') {
      try { setRaw(JSON.stringify(formArguments(), null, 2)); setError(undefined); } catch (cause) { setError(cause); return; }
    } else {
      try {
        const parsed = parseTestArguments(raw);
        setValues(Object.fromEntries(Object.entries(parsed).map(([name, value]) => [name, typeof value === 'string' ? value : JSON.stringify(value)])));
        setError(undefined);
      } catch (cause) { setError(cause); return; }
    }
    setMode(next);
  };
  const action = tool.name === 'send_email' ? 'Send real email' : tool.dataPolicy.sideEffects ? 'Run real action' : 'Run test';
  return <Card><CardHeader title="Test console" description="Run once as yourself with PUBLIC, TRUSTED context. Approval is granted for this test. Every outcome is recorded in the ledger and audit." /><CardBody className="grid gap-4">
    {tool.dataPolicy.sideEffects && <Callout tone="warning" title={tool.name === 'send_email' ? 'This sends a real email' : 'This performs the real action'}>{tool.name === 'send_email' ? 'Recipients must be verified, active workspace members cleared for the context.' : 'The HTTP request can change external data. Review the arguments before running it.'}</Callout>}
    <Segmented aria-label="Argument input mode" value={mode} onValueChange={switchMode} options={[{ value: 'form', label: 'Argument fields' }, { value: 'json', label: 'JSON' }]} />
    <fieldset disabled={pending} className="grid min-w-0 gap-4">
      {mode === 'json' ? <Field label="Arguments (JSON object)" hint="At most 16 KB. Schema violations are reported as denied outcomes."><Textarea value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} className="min-h-40 font-mono text-xs" /></Field> : properties.length ? properties.map(([name, schema]) => <ArgumentField key={name} name={name} schema={schema} required={tool.parameters.required?.includes(name) ?? false} value={values[name] ?? ''} onChange={(value) => setValues((old) => ({ ...old, [name]: value }))} />) : <p className="text-sm text-muted">This tool takes no required arguments. Use JSON mode to send an object.</p>}
    </fieldset>
    <div className="flex flex-wrap items-center gap-3"><Button onClick={() => void run()} loading={pending} disabled={!tool.available}><Play />{pending ? 'Executing…' : action}</Button><Button variant="ghost" size="sm" disabled={pending} onClick={() => { setResult(null); setError(undefined); setValues({}); setRaw('{}'); }}><Eraser />Clear console</Button></div>
    {pending && <p role="status" className="text-xs text-muted">Waiting for the tool; the request budget is up to 75 seconds. Navigating away does not undo an external action.</p>}
    {error ? <div className="grid gap-2"><FormError message={error instanceof Error ? error.message : 'Could not run the tool.'} />{isApiError(error) && <RequestReference requestId={error.requestId} />}{isApiError(error) && error.source === 'client' && <Callout tone="warning">The outcome is unknown. Check the execution ledger before repeating a side-effecting action.</Callout>}</div> : null}
    {result && <div className="grid gap-3 rounded-lg border border-line p-4" role="status"><div className="flex flex-wrap items-center gap-3"><ExecutionBadge status={result.status} /><span className="text-xs text-muted">{result.durationMs.toLocaleString()} ms</span><span className="font-mono text-[11px] break-all text-faint">{result.executionId}</span></div>{result.status === 'ok' ? <>{result.truncated && <Callout tone="warning">The result was truncated to the platform’s output limit.</Callout>}<JsonView value={result.content} /></> : <><p className="font-mono text-xs text-ink-soft">{result.code}</p><p className="text-sm text-muted">{result.message}</p></>}<p className="text-xs text-muted">Result content is kept only on this screen and cleared when you leave.</p></div>}
  </CardBody></Card>;
}
function argumentValue(value: string, schema: JsonSchema): unknown {
  const type = Array.isArray(schema.type) ? schema.type.find((item) => item !== 'null') : schema.type;
  if (type === 'string' || !type) return value;
  if (type === 'number' || type === 'integer') { const number = Number(value); if (!Number.isFinite(number)) throw new Error('Numeric arguments must be finite numbers.'); return number; }
  try { return JSON.parse(value); } catch { throw new Error(`Enter valid JSON for the ${type} argument.`); }
}
function ArgumentField({ name, schema, value, onChange, required }: { name: string; schema: JsonSchema; value: string; onChange: (value: string) => void; required: boolean }) {
  const type = Array.isArray(schema.type) ? schema.type.find((item) => item !== 'null') : schema.type;
  const hint = [schema.description, schema.default !== undefined ? `Default: ${JSON.stringify(schema.default)}` : undefined, type === 'array' || type === 'object' ? `Enter a JSON ${type}.` : undefined].filter(Boolean).join(' ');
  const enumOptions = schema.enum?.map((item) => ({ value: typeof item === 'string' ? item : JSON.stringify(item), label: String(item) })).filter((item) => item.value !== '');
  return <Field label={schema.title ? `${schema.title} (${name})` : name} optional={!required} hint={hint || undefined}>
    {type === 'boolean' ? <Select value={value || '__omit__'} onValueChange={(next) => onChange(next === '__omit__' ? '' : next)} options={[{ value: '__omit__', label: 'Omit / use default' }, { value: 'true', label: 'True' }, { value: 'false', label: 'False' }]} /> : enumOptions?.length ? <Select value={value || '__omit__'} onValueChange={(next) => onChange(next === '__omit__' ? '' : next)} options={[{ value: '__omit__', label: 'Omit / use default' }, ...enumOptions]} /> : type === 'object' || type === 'array' || name === 'body' ? <Textarea value={value} onChange={(e) => onChange(e.target.value)} className={type === 'string' ? '' : 'font-mono text-xs'} /> : <Input value={value} onChange={(e) => onChange(e.target.value)} type={type === 'integer' || type === 'number' ? 'number' : 'text'} step={type === 'integer' ? 1 : 'any'} />}
  </Field>;
}
