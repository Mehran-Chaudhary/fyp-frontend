import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { callPaginated, workspacePath } from '@/lib/api/client';
import { useDebouncedValue } from '@/lib/hooks';
import { conditionOperators, changeRuleOperator, numericOperator, templateSuggestions, unaryOperator } from '@/lib/workflows/graph';
import type { ConditionOperator, ConditionRule, GraphNode, NodeTypeDescriptor, WorkflowGraph } from '@/lib/workflows/types';

export type JsonDrafts = Record<string, string>;

export function JsonField({ name, value, drafts, onDraft, onChange, hint, array = false }: {
  name: string; value: unknown; drafts: JsonDrafts; onDraft: (key: string, text: string) => void; onChange: (value: unknown) => void; hint?: string; array?: boolean;
}) {
  const text = drafts[name] ?? JSON.stringify(value ?? (array ? [] : {}), null, 2);
  let error: string | undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || (array ? !Array.isArray(parsed) : Array.isArray(parsed))) error = array ? 'Enter a JSON array.' : 'Enter a JSON object.';
  } catch { error = 'Complete the JSON before saving. Your text stays in this editor.'; }
  return <Field label={name.split(':').at(-1)?.replace(/([A-Z])/g, ' $1')} hint={hint} error={error}><Textarea aria-label={name.split(':').at(-1)} className="min-h-32 font-mono text-xs" spellCheck={false} value={text} onChange={(event) => {
    onDraft(name, event.target.value);
    try { const parsed: unknown = JSON.parse(event.target.value); onChange(parsed); } catch { /* Keep incomplete JSON in memory; never save an older value silently. */ }
  }} /></Field>;
}

function ReferencePicker({ kind, value, onChange, multiple = false }: { kind: 'agents' | 'tools' | 'knowledge-bases'; value: unknown; onChange: (value: unknown) => void; multiple?: boolean }) {
  const workspace = useWorkspace();
  const can = useCan();
  const permission = kind === 'agents' ? 'agent:read' : kind === 'tools' ? 'tool:read' : 'knowledgebase:read';
  const allowed = can(permission);
  const [search, setSearch] = useState('');
  const queryText = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ['ws', workspace.id, 'workflow-references', kind, queryText, page], enabled: allowed, queryFn: ({ signal }) => {
    const [path, scope] = workspacePath(workspace.id, `/${kind}`);
    return callPaginated<{ id: string; name: string; displayName?: string; enabled?: boolean }>(path, { ...scope, query: { search: queryText || undefined, page, limit: 30 }, signal });
  } });
  const selected = multiple ? (Array.isArray(value) ? value as string[] : []) : typeof value === 'string' && value ? [value] : [];
  if (!allowed) return <p className="rounded-lg bg-well p-3 text-xs text-muted">Choosing {kind.replace('-', ' ')} needs {permission}. Existing references are kept.</p>;
  return <div className="space-y-2">
    <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={`Search ${kind.replace('-', ' ')}`} aria-label={`Search ${kind}`} inputClassName="h-8 text-xs" />
    {query.isPending ? <p className="text-xs text-muted">Loading available {kind}…</p> : query.isError ? <div className="text-xs text-danger-700">{query.error.message}<Button size="xs" variant="ghost" onClick={() => void query.refetch()}>Retry</Button></div> : <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-line p-1">
      {!query.data.items.length && <p className="p-2 text-xs text-muted">No matching {kind} available.</p>}
      {query.data.items.map((item) => <label key={item.id} className="flex cursor-pointer items-start gap-2 rounded-md p-2 text-xs hover:bg-well"><input className="mt-0.5 accent-brand-600" type={multiple ? 'checkbox' : 'radio'} name={`reference-${kind}`} checked={selected.includes(item.id)} disabled={item.enabled === false} onChange={(event) => onChange(multiple ? event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id) : item.id)} /><span>{item.displayName || item.name}{item.enabled === false ? ' (disabled)' : ''}</span></label>)}
    </div>}
    {query.data && query.data.pagination.totalPages > 1 && <div className="flex items-center justify-between"><Button size="xs" variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-xs text-muted">{page}/{query.data.pagination.totalPages}</span><Button size="xs" variant="ghost" disabled={!query.data.pagination.hasNextPage} onClick={() => setPage(page + 1)}>Next</Button></div>}
    {selected.length > 0 && <div className="space-y-1">{selected.map((id) => <div key={id} className="flex items-center gap-1 text-xs text-muted"><span className="min-w-0 flex-1 truncate" title={id}>{query.data?.items.find((item) => item.id === id)?.displayName || query.data?.items.find((item) => item.id === id)?.name || `Selected: ${id}`}</span><Button aria-label={`Remove ${id}`} size="icon-xs" variant="ghost" onClick={() => onChange(multiple ? selected.filter((selectedId) => selectedId !== id) : '')}><Trash2 /></Button></div>)}</div>}
    {multiple && !selected.length && <p className="text-xs text-muted">No restriction: search every knowledge base you can query.</p>}
  </div>;
}

function TemplateField({ label, description, value, onChange, suggestions, required }: { label: string; description?: string; value: string; onChange: (value: string) => void; suggestions: string[]; required?: boolean }) {
  return <Field label={label} optional={!required} hint={description}><Textarea className="min-h-24 font-mono text-xs" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Type text or insert a reference below" /><details className="text-xs text-muted"><summary className="cursor-pointer py-1">Insert a data reference</summary><div className="mt-1 flex max-h-36 flex-wrap gap-1 overflow-auto">{suggestions.map((reference) => <button type="button" key={reference} title={`Insert ${reference}`} onClick={() => onChange(`${value}${reference}`)} className="break-all rounded border border-line bg-well px-1.5 py-1 text-left font-mono text-[10px] hover:border-brand-400">{reference}</button>)}</div><p className="mt-2 text-[11px]">Add ? before the closing braces for an optional value on the first loop iteration.</p></details></Field>;
}

function Conditions({ rules, onChange, suggestions }: { rules: ConditionRule[]; onChange: (rules: ConditionRule[]) => void; suggestions: string[] }) {
  const change = (index: number, patch: Partial<ConditionRule>) => onChange(rules.map((rule, i) => i === index ? { ...rule, ...patch } : rule));
  return <div className="space-y-3"><p className="text-xs text-muted">The first matching rule determines the outgoing path. Otherwise, the else path runs.</p>{rules.map((rule, index) => <div key={index} className="space-y-3 rounded-lg border border-line bg-well/30 p-3">
    <div className="flex items-end gap-2"><Field label="Rule / handle ID" className="flex-1" hint="Renaming a rule also renames its connected edge handles."><Input value={rule.id} pattern="[A-Za-z][A-Za-z0-9_-]*" maxLength={32} onChange={(event) => change(index, { id: event.target.value })} /></Field><Button size="icon-sm" variant="ghost" aria-label={`Remove rule ${index + 1}`} onClick={() => onChange(rules.filter((_, i) => i !== index))}><Trash2 /></Button></div>
    <TemplateField label="Value to check" value={rule.value} onChange={(value) => change(index, { value })} suggestions={suggestions} required />
    <Field label="Operator"><Select value={rule.operator} onValueChange={(operator) => onChange(rules.map((item, i) => i === index ? changeRuleOperator(item, operator as ConditionOperator) : item))} options={conditionOperators.map((operator) => ({ value: operator, label: operator.replaceAll('_', ' ') }))} /></Field>
    {!unaryOperator(rule.operator) && <Field label="Compare with" hint={numericOperator(rule.operator) ? 'Sent as a number, not text.' : undefined}>{numericOperator(rule.operator) ? <Input type="number" step="any" value={typeof rule.operand === 'number' ? rule.operand : 0} onChange={(event) => change(index, { operand: Number(event.target.value) })} /> : <><Select aria-label="Comparison value type" value={typeof rule.operand === 'boolean' ? 'boolean' : typeof rule.operand === 'number' ? 'number' : 'string'} onValueChange={(type) => change(index, { operand: type === 'boolean' ? true : type === 'number' ? 0 : '' })} options={[{ value: 'string', label: 'Text' }, { value: 'number', label: 'Number' }, { value: 'boolean', label: 'Boolean' }]} />{typeof rule.operand === 'boolean' ? <Select value={String(rule.operand)} onValueChange={(value) => change(index, { operand: value === 'true' })} options={[{ value: 'true', label: 'True' }, { value: 'false', label: 'False' }]} /> : <Input type={typeof rule.operand === 'number' ? 'number' : 'text'} value={rule.operand ?? ''} onChange={(event) => change(index, { operand: typeof rule.operand === 'number' ? Number(event.target.value) : event.target.value })} />}</>}</Field>}
    {!numericOperator(rule.operator) && !unaryOperator(rule.operator) && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={rule.caseSensitive ?? false} onChange={(event) => change(index, { caseSensitive: event.target.checked })} />Case-sensitive comparison</label>}
  </div>)}<Button variant="secondary" size="sm" className="w-full" onClick={() => { let number = rules.length + 1; while (rules.some((rule) => rule.id === `rule_${number}`)) number += 1; onChange([...rules, { id: `rule_${number}`, value: '{{input.input}}', operator: 'is_not_empty' }]); }}><Plus />Add condition</Button></div>;
}

export function NodeProperties({ node, descriptor, graph, onChange, drafts, onDraft }: { node: GraphNode; descriptor?: NodeTypeDescriptor; graph: WorkflowGraph; onChange: (node: GraphNode) => void; drafts: JsonDrafts; onDraft: (key: string, value: string) => void }) {
  const suggestions = templateSuggestions(graph, node.id);
  const update = (field: string, value: unknown) => {
    const data = { ...node.data };
    if (value === undefined || value === '') delete data[field]; else data[field] = value;
    onChange({ ...node, data });
  };
  const renderField = (field: NodeTypeDescriptor['fields'][number]) => {
    const value = node.data[field.name];
    const label = field.name.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
    if (field.name === 'agentId') return <Field label="Agent" hint={field.description} key={field.name}><ReferencePicker kind="agents" value={value} onChange={(id) => update(field.name, id)} /></Field>;
    if (field.name === 'toolId') return <Field label="Tool" hint={field.description} key={field.name}><ReferencePicker kind="tools" value={value} onChange={(id) => update(field.name, id)} /></Field>;
    if (field.name === 'knowledgeBaseIds') return <Field label="Knowledge bases" hint={field.description} key={field.name}><ReferencePicker kind="knowledge-bases" value={value} onChange={(ids) => update(field.name, ids)} multiple /></Field>;
    if (field.name === 'rules') return <Conditions key="rules" rules={(Array.isArray(value) ? value : []) as ConditionRule[]} onChange={(rules) => update('rules', rules)} suggestions={suggestions} />;
    if (field.name === 'retry') {
      const retry = value as { maxAttempts?: number; backoffMs?: number } | undefined;
      return <fieldset key="retry" className="space-y-3 rounded-lg border border-line p-3"><legend className="px-1 text-xs font-medium">Retry policy</legend><p className="text-xs text-muted">Only transient failures and timeouts retry. Policy denials never retry.</p>{(['maxAttempts', 'backoffMs'] as const).map((name) => <Field key={name} label={name === 'maxAttempts' ? 'Maximum attempts' : 'Backoff (milliseconds)'} optional><Input type="number" min={1} value={retry?.[name] ?? ''} placeholder="Platform default" onChange={(event) => { const next = { ...retry }; if (event.target.value) next[name] = Number(event.target.value); else delete next[name]; update('retry', Object.keys(next).length ? next : undefined); }} /></Field>)}</fieldset>;
    }
    if (field.name === 'output' && node.type === 'agent') {
      const output = value as { format?: string; schema?: unknown } | undefined;
      return <div key="output" className="space-y-3"><Field label="Output format"><Select value={output?.format ?? 'text'} onValueChange={(format) => update('output', format === 'json' ? { format, schema: { type: 'object', properties: {} } } : { format })} options={[{ value: 'text', label: 'Text' }, { value: 'json', label: 'Structured JSON' }]} /></Field>{output?.format === 'json' && <JsonField name={`${node.id}:outputSchema`} value={output.schema} drafts={drafts} onDraft={onDraft} onChange={(schema) => update('output', { format: 'json', schema })} hint="The model's answer must match this JSON schema." />}</div>;
    }
    if (field.type === 'boolean') return <label key={field.name} className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-3 text-xs"><input className="mt-0.5 accent-brand-600" type="checkbox" checked={value === true} onChange={(event) => update(field.name, event.target.checked)} /><span><span className="block font-medium">{label}</span><span className="mt-1 block text-muted">{field.description}</span></span></label>;
    if (field.type === 'enum') return <Field key={field.name} label={label} hint={field.description}><Select value={typeof value === 'string' ? value : undefined} placeholder="Choose an option" onValueChange={(next) => update(field.name, next)} options={(field.options ?? []).map((option) => ({ value: option, label: option.replaceAll('_', ' ') }))} /></Field>;
    if (field.type === 'integer') return <Field key={field.name} label={label} optional={!field.required} hint={field.description}><Input type="number" step={1} min={field.name === 'timeoutMs' && node.type === 'approval' ? 60000 : 1} max={field.name === 'timeoutMs' && node.type === 'approval' ? 2592000000 : undefined} value={typeof value === 'number' ? value : ''} placeholder="Platform default" onChange={(event) => update(field.name, event.target.value ? Number(event.target.value) : undefined)} /></Field>;
    if (field.type === 'object' || field.type === 'json-schema' || field.type === 'array') return <JsonField key={field.name} name={`${node.id}:${field.name}`} value={value} array={field.type === 'array'} drafts={drafts} onDraft={onDraft} onChange={(next) => update(field.name, next)} hint={field.description} />;
    if (field.type === 'template') return <TemplateField key={field.name} label={label} value={typeof value === 'string' ? value : ''} onChange={(next) => update(field.name, next)} suggestions={suggestions} description={field.description} required={field.required} />;
    return <Field key={field.name} label={label} hint={field.description} optional={!field.required}><Input value={typeof value === 'string' ? value : ''} onChange={(event) => update(field.name, event.target.value)} /></Field>;
  };
  return <div className="space-y-5"><div><h3 className="font-semibold">{descriptor?.label ?? node.type}</h3><p className="mt-1 text-xs leading-relaxed text-muted">{descriptor?.description}</p></div><Field label="Step label" optional><Input value={node.label ?? ''} onChange={(event) => onChange({ ...node, label: event.target.value })} placeholder={descriptor?.label} maxLength={200} /></Field><Field label="Reference ID" hint="Permanent identity used in templates and run history."><Input value={node.id} readOnly inputClassName="font-mono text-xs" /></Field>{descriptor?.fields.map(renderField)}{!descriptor && <p className="text-xs text-danger-700">This node type is unavailable in the current deployment. Its data is preserved; reload the node palette before editing.</p>}</div>;
}
