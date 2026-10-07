import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { NoAccessState } from '@/components/feedback/no-access';
import { ErrorState, PageHeader, RequestReference } from '@/components/feedback/states';
import { UnsavedChangesDialog } from '@/components/feedback/unsaved-changes-dialog';
import { useUnsavedChanges } from '@/components/feedback/use-unsaved-changes';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, FormError } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { isApiError } from '@/lib/api/errors';
import { toolsApi } from '@/lib/api/tools';
import { useDocumentTitle } from '@/lib/hooks';
import { buildToolInput, CLASSIFICATIONS, defaultPolicy, definitionIssues, INTEGRITIES, policyWeakening, toolDraft, toolUpdate, type ToolDraft } from '@/lib/tools/editor';
import { toolKeys, toolQuery } from '@/lib/tools/queries';
import type { Tool, ToolHttpMethod } from '@/lib/tools/types';
import { ToolsBack } from './shared';
import { useToolCan } from './use-tool-can';

export function ToolCreatePage() {
  const ws = useWorkspace();
  const can = useToolCan();
  useDocumentTitle('New HTTP tool');
  return can.create ? <ToolEditor key={ws.id} /> : <Card><NoAccessState permissions={['tool:create']} workspaceName={ws.name} /></Card>;
}
export function ToolEditPage() {
  const can = useToolCan();
  const ws = useWorkspace();
  useDocumentTitle('Edit HTTP tool');
  return can.read && can.update ? <EditLoader /> : <Card><NoAccessState permissions={['tool:read + tool:update']} workspaceName={ws.name} /></Card>;
}
function EditLoader() {
  const ws = useWorkspace();
  const { toolId = '' } = useParams();
  const query = useQuery(toolQuery(ws.id, toolId));
  const [reload, setReload] = useState(0);
  if (query.isPending) return <Skeleton className="h-96 rounded-xl" />;
  if (query.isError) return <Card><ErrorState error={query.error} onRetry={() => void query.refetch()} /></Card>;
  if (query.data.kind === 'BUILTIN') return <div className="grid gap-4"><ToolsBack /><Callout title="Built-in tools are read-only">Their definitions are managed by the platform.</Callout></div>;
  // Do not key on version: a background refetch must never overwrite an unsaved draft.
  return <ToolEditor key={`${ws.id}:${toolId}:${reload}`} initial={query.data} onReload={async () => { const result = await query.refetch(); if (result.isSuccess) setReload((value) => value + 1); }} />;
}
function ToolEditor({ initial, onReload }: { initial?: Tool; onReload?: () => Promise<void> }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [base] = useState(initial);
  const [draft, setDraft] = useState(() => toolDraft(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const [confirmWeakening, setConfirmWeakening] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toolDraft(base));
  const { blocker, allowNavigation } = useUnsavedChanges(dirty && !pending);
  const baselinePolicy = base?.dataPolicy ?? defaultPolicy(draft.method);
  const weakenings = policyWeakening(baselinePolicy, draft.dataPolicy);
  const patch = <K extends keyof ToolDraft>(key: K, value: ToolDraft[K]) => setDraft((old) => ({ ...old, [key]: value }));
  const fieldError = (key: string) => Object.entries(errors).filter(([path]) => path === key || path.startsWith(`${key}.`)).map(([path, text]) => path === key ? text : `${path}: ${text}`).join('\n') || undefined;
  const save = async (confirmed = false) => {
    if (pending) return;
    const checked = buildToolInput(draft);
    setErrors(checked.errors);
    setError(undefined);
    if (!checked.body) return;
    if (weakenings.length && !confirmed) { setConfirmWeakening(true); return; }
    setPending(true);
    const current = new AbortController();
    controller.current = current;
    try {
      // Direct call: secrets never enter React Query's mutation cache or devtools.
      const saved = base ? await toolsApi.update(ws.id, base.id, toolUpdate(base, checked.body, draft.secretAction), current.signal) : await toolsApi.create(ws.id, checked.body, current.signal);
      if (current.signal.aborted) return;
      patch('secret', '');
      client.setQueryData(toolKeys.detail(ws.id, saved.id), saved);
      await client.invalidateQueries({ queryKey: toolKeys.lists(ws.id) });
      await client.invalidateQueries({ queryKey: ['ws', ws.id, 'agent-tools'] });
      setConfirmWeakening(false);
      allowNavigation();
      toast.success(base ? 'Tool updated' : 'HTTP tool created');
      navigate(`/w/${ws.slug}/tools/${saved.id}`);
    } catch (cause) {
      if (current.signal.aborted) return;
      setError(cause);
      setErrors(definitionIssues(cause));
      setConfirmWeakening(false);
    } finally { if (!current.signal.aborted) setPending(false); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void save(); };
  const conflict = isApiError(error) && error.code === 'RESOURCE_CONFLICT';
  return <div className="grid gap-5">
    <ToolsBack /><PageHeader title={base ? `Edit ${base.displayName}` : 'Define an HTTP tool'} description="A fixed destination, typed arguments and explicit data boundaries. The model uses your description to decide when this tool is useful." />
    <form onSubmit={submit} noValidate className="grid gap-5">
      <fieldset disabled={pending} className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
        <div className="grid min-w-0 content-start gap-5">
          <Card><CardHeader title="Identity" description="Clear names and descriptions help models make reliable choices." /><CardBody className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Tool name" error={fieldError('name')} hint="The model calls it by this name. Immutable after creation."><Input value={draft.name} onChange={(e) => patch('name', e.target.value)} readOnly={!!base} maxLength={48} placeholder="order_lookup" autoComplete="off" spellCheck={false} inputClassName="font-mono" /></Field><Field label="Display name" error={fieldError('displayName')}><Input value={draft.displayName} onChange={(e) => patch('displayName', e.target.value)} maxLength={80} placeholder="Order lookup" /></Field></div>
            <Field label="Description" hint="Explain when to call it and what it returns. The model reads this." error={fieldError('description')}><Textarea value={draft.description} onChange={(e) => patch('description', e.target.value)} maxLength={1000} placeholder="Find an order by its reference and return the delivery status." /></Field>
          </CardBody></Card>
          <Card><CardHeader title="HTTP request" description="Only operator-approved HTTPS hosts are allowed. Ask the platform operator to add your destination if creation is refused." /><CardBody className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-[110px_1fr]"><Field label="Method"><Select value={draft.method} options={(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as ToolHttpMethod[]).map((value) => ({ value, label: value }))} onValueChange={(value) => setDraft((old) => ({ ...old, method: value, dataPolicy: JSON.stringify(old.dataPolicy) === JSON.stringify(defaultPolicy(old.method)) && !base ? defaultPolicy(value) : old.dataPolicy }))} /></Field><Field label="URL" error={fieldError('http.url')} hint="Use {{parameter}} in the path, query and values. The scheme, host and port must stay fixed."><Input value={draft.url} onChange={(e) => patch('url', e.target.value)} placeholder="https://api.example.com/orders/{{order_id}}" spellCheck={false} autoComplete="off" /></Field></div>
            <KeyValueEditor title="Query parameters" rows={draft.query} onChange={(value) => patch('query', value)} error={fieldError('http.query')} />
            <KeyValueEditor title="Headers" rows={draft.headers} onChange={(value) => patch('headers', value)} error={fieldError('http.headers')} />
            <p className="text-xs text-muted">Credentials belong in Authentication below. Reserved transport headers such as Authorization, Cookie and Host are rejected.</p>
            {['POST', 'PUT', 'PATCH'].includes(draft.method) && <Field label="JSON body" optional error={fieldError('http.body')} hint={'String values may reference arguments, for example {"reference": "{{order_id}}"}.'}><Textarea value={draft.body} onChange={(e) => patch('body', e.target.value)} className="min-h-32 font-mono text-xs" spellCheck={false} placeholder="{}" /></Field>}
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Response path" optional error={fieldError('http.responsePath')} hint="A JSON pointer selecting the model’s result, up to 8 segments."><Input value={draft.responsePath} onChange={(e) => patch('responsePath', e.target.value)} placeholder="/data/items" inputClassName="font-mono" /></Field><Field label="Timeout (milliseconds)" error={fieldError('timeoutMs')} hint="500–60,000 ms; default 15,000 ms."><Input type="number" min={500} max={60_000} step={1} value={draft.timeoutMs} onChange={(e) => patch('timeoutMs', e.target.value)} /></Field></div>
          </CardBody></Card>
          <Card><CardHeader title="Argument schema" description="Supported JSON Schema only: types, properties, required, enum, defaults, bounds, format and arrays. References, patterns and composition are not supported." /><CardBody><Field label="Parameters (JSON Schema)" error={fieldError('parameters')} hint="The root must be an object. Nest up to 6 levels with at most 100 properties per object."><Textarea value={draft.parameters} onChange={(e) => patch('parameters', e.target.value)} className="min-h-64 font-mono text-xs" spellCheck={false} /></Field></CardBody></Card>
        </div>
        <div className="grid min-w-0 content-start gap-5">
          <Card><CardHeader title="Authentication" /><CardBody className="grid gap-4">
            <Field label="Auth type" error={fieldError('http.auth')}><Select value={draft.authType} onValueChange={(value) => patch('authType', value)} options={[{ value: 'none', label: 'None' }, { value: 'bearer', label: 'Bearer token' }, { value: 'header', label: 'Custom header' }, { value: 'basic', label: 'Basic authentication' }]} /></Field>
            {draft.authType === 'header' && <Field label="Credential header name" error={fieldError('http.auth.headerName')}><Input value={draft.headerName} onChange={(e) => patch('headerName', e.target.value)} placeholder="X-API-Key" /></Field>}
            {draft.authType === 'basic' && <Field label="Username" error={fieldError('http.auth.username')}><Input value={draft.username} onChange={(e) => patch('username', e.target.value)} autoComplete="off" /></Field>}
            {(draft.authType !== 'none' || base?.hasSecret) && <>
              <p className="text-[13px] text-muted">{base?.hasSecret ? 'Credential set. Its value is never returned.' : 'No credential is configured.'}</p>
              <Field label="Credential action"><Select value={draft.secretAction} onValueChange={(value) => setDraft((old) => ({ ...old, secretAction: value, secret: '' }))} options={[{ value: 'keep', label: base?.hasSecret ? 'Keep existing credential' : 'Leave unconfigured' }, { value: 'replace', label: base?.hasSecret ? 'Replace credential' : 'Set credential' }, ...(base ? [{ value: 'remove' as const, label: 'Remove credential' }] : [])]} /></Field>
              {draft.secretAction === 'replace' && <Field label={draft.authType === 'basic' ? 'Password' : 'Secret'} error={fieldError('secret')}><Input type="password" autoComplete="new-password" value={draft.secret} maxLength={4096} onChange={(e) => patch('secret', e.target.value)} /></Field>}
              {draft.authType !== 'none' && (draft.secretAction === 'remove' || (!base?.hasSecret && draft.secretAction === 'keep')) && <Callout tone="warning" title="Credential missing">Calls will fail until a credential is configured.</Callout>}
            </>}
          </CardBody></Card>
          <Card><CardHeader title="Data boundaries" icon={<ShieldCheck />} /><CardBody className="grid gap-4">
            <Field label="Classification ceiling" hint="The most sensitive context this destination may receive." error={fieldError('dataPolicy.maxClassification')}><Select value={draft.dataPolicy.maxClassification} options={CLASSIFICATIONS.map((value) => ({ value, label: value }))} onValueChange={(value) => patch('dataPolicy', { ...draft.dataPolicy, maxClassification: value })} /></Field>
            <Field label="Minimum context integrity" hint="Refuse action after reading content less trusted than this." error={fieldError('dataPolicy.minIntegrity')}><Select value={draft.dataPolicy.minIntegrity} options={INTEGRITIES.map((value) => ({ value, label: value }))} onValueChange={(value) => patch('dataPolicy', { ...draft.dataPolicy, minIntegrity: value })} /></Field>
            <Field label="Personal data in arguments" error={fieldError('dataPolicy.piiArguments')}><Select value={draft.dataPolicy.piiArguments} options={[{ value: 'deny', label: 'Deny personal data' }, { value: 'unmask', label: 'Allow real personal data' }]} onValueChange={(value) => patch('dataPolicy', { ...draft.dataPolicy, piiArguments: value })} /></Field>
            <Checkbox label="This tool has side effects" description="It sends messages, changes records or performs another external action." checked={draft.dataPolicy.sideEffects} onCheckedChange={(value) => patch('dataPolicy', { ...draft.dataPolicy, sideEffects: value })} />
            {weakenings.length > 0 && <Callout tone="warning" title="Data policy will be relaxed"><ul className="list-disc space-y-1 pl-4">{weakenings.map((warning) => <li key={warning}>{warning}</li>)}</ul></Callout>}
            <p className="text-xs text-muted">HTTP results always have EXTERNAL integrity. Policy weakening is recorded in the audit log.</p>
          </CardBody></Card>
          <Card><CardHeader title="Execution" /><CardBody className="grid gap-4"><Checkbox label="Enabled" checked={draft.enabled} onCheckedChange={(value) => patch('enabled', value)} description="Available to agents and workflow steps that grant this tool." /><Checkbox label="Require approval" checked={draft.requiresApproval} onCheckedChange={(value) => patch('requiresApproval', value)} description="Workflow calls must be behind an approval node. A manual test counts as approval." /></CardBody></Card>
        </div>
      </fieldset>
      {conflict ? <Callout tone="warning" title="A newer version was saved" action={<Button variant="secondary" size="sm" onClick={() => setConfirmReload(true)}>Reload latest version</Button>}>Your draft is kept here. Review the latest version before applying changes; saving never overwrites it silently.</Callout> : error ? <div className="grid gap-2"><FormError message={error instanceof Error ? error.message : 'The tool could not be saved.'} />{isApiError(error) && <RequestReference requestId={error.requestId} />}</div> : null}
      {Object.keys(errors).length > 0 && <Callout tone="danger" title="Review these fields before saving" role="alert"><ul className="list-disc space-y-1 pl-4">{Object.entries(errors).map(([path, message]) => <li key={path}><span className="font-mono text-xs">{path || 'Definition'}: </span><span className="whitespace-pre-wrap">{message}</span></li>)}</ul></Callout>}
      <footer className="sticky bottom-0 z-10 flex items-center justify-between gap-4 rounded-xl border border-line bg-surface/95 px-5 py-4 shadow-card backdrop-blur"><p className="text-xs text-muted">{base ? `Based on version ${base.version} · ${dirty ? 'Unsaved changes' : 'Up to date'}` : 'New integration · credentials are write-only'}</p><Button type="submit" loading={pending} disabled={!!base && !dirty}><Save />{base ? 'Save changes' : 'Create tool'}</Button></footer>
    </form>
    <ConfirmDialog open={confirmWeakening} onOpenChange={setConfirmWeakening} title="Relax this tool’s data policy?" description={`The request will go to ${(() => { try { return new URL(draft.url).host; } catch { return draft.url; } })()}. This change is audited.`} confirmLabel={base ? 'Save policy and tool' : 'Create with this policy'} tone="warning" pending={pending} onConfirm={() => void save(true)}><ul className="list-disc space-y-2 pl-4 text-sm text-ink-soft">{weakenings.map((warning) => <li key={warning}>{warning}</li>)}</ul></ConfirmDialog>
    <ConfirmDialog open={confirmReload} onOpenChange={setConfirmReload} title="Discard this draft and reload?" description="Your unsaved changes and any replacement credential will be cleared." confirmLabel="Discard and reload" tone="warning" onConfirm={() => { setConfirmReload(false); void onReload?.(); }} />
    <UnsavedChangesDialog blocker={blocker} />
  </div>;
}
function KeyValueEditor({ title, rows, onChange, error }: { title: string; rows: Array<[string, string]>; onChange: (rows: Array<[string, string]>) => void; error?: string }) {
  return <div className="grid gap-2"><div className="flex items-center justify-between"><h3 className="text-[13px] font-medium text-ink-soft">{title}</h3><Button size="xs" variant="ghost" onClick={() => onChange([...rows, ['', '']])}><Plus />Add row</Button></div>
    {rows.map(([key, value], index) => <div key={index} className="grid grid-cols-[minmax(80px,1fr)_minmax(100px,2fr)_32px] items-center gap-2"><Input aria-label={`${title} key ${index + 1}`} value={key} onChange={(e) => onChange(rows.map((row, i) => i === index ? [e.target.value, row[1]] : row))} placeholder="Key" /><Input aria-label={`${title} value ${index + 1}`} value={value} onChange={(e) => onChange(rows.map((row, i) => i === index ? [row[0], e.target.value] : row))} placeholder="Value or {{parameter}}" /><Button variant="ghost" size="icon-sm" aria-label={`Remove ${title.toLowerCase()} row ${index + 1}`} onClick={() => onChange(rows.filter((_, i) => i !== index))}><Trash2 /></Button></div>)}
    {!rows.length && <p className="rounded-lg border border-dashed border-line p-3 text-xs text-muted">No {title.toLowerCase()} configured.</p>}<FormError message={error} />
  </div>;
}
