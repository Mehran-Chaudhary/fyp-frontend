import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { Gauge } from 'lucide-react';
import { RequestReference } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { quotasApi } from '@/lib/api/governance';
import { isApiError, isOutcomeUnknown } from '@/lib/api/errors';
import type { CreateQuotaInput, Quota, QuotaPeriod, QuotaScope } from '@/lib/api/governance-types';
import { messageFor } from '@/lib/errors';
import { activeMembersInfiniteQuery, allAgentsQuery, apiKeysQuery } from '@/lib/queries';
import { toast } from '@/lib/toast';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { quotaChangeWeakens } from './helpers';

export function QuotaEditor({ quota, onClose }: { quota: Quota | null; onClose: () => void }) {
  const ws = useWorkspace(); const can = useCan(); const client = useQueryClient();
  const [scope, setScope] = useState<QuotaScope>(quota?.scope ?? 'ORGANIZATION'); const [subjectId, setSubjectId] = useState(quota?.subjectId ?? '');
  const [period, setPeriod] = useState<QuotaPeriod>(quota?.period ?? 'MONTH'); const [limit, setLimit] = useState(String(quota?.tokenLimit ?? 100000));
  const [enforcement, setEnforcement] = useState<'HARD' | 'SOFT'>(quota?.enforcement ?? 'HARD'); const [threshold, setThreshold] = useState(String(quota?.alertThreshold ?? 80));
  const [label, setLabel] = useState(quota?.label ?? ''); const [errors, setErrors] = useState<Record<string, string>>({}); const [search, setSearch] = useState(''); const deferredSearch = useDeferredValue(search);
  const members = useInfiniteQuery({ ...activeMembersInfiniteQuery(ws.id, deferredSearch), enabled: !quota && scope === 'MEMBER' && can('member:read') });
  const agents = useQuery({ ...allAgentsQuery(ws.id), enabled: !quota && scope === 'AGENT' && can('agent:read') });
  const keys = useQuery({ ...apiKeysQuery(ws.id), enabled: !quota && scope === 'API_KEY' && can('apikey:read') });
  const save = useMutation({ mutationFn: async () => {
    const common = { tokenLimit: Number(limit), enforcement, alertThreshold: Number(threshold) };
    if (quota) return quotasApi.update(ws.id, quota.id, { ...common, label: label.trim() || null });
    const body: CreateQuotaInput = { ...common, scope, period, ...(scope === 'ORGANIZATION' ? {} : { subjectId }), ...(label.trim() ? { label: label.trim() } : {}) };
    return quotasApi.create(ws.id, body);
  }, onSuccess: () => { toast.success(quota ? 'Quota updated' : 'Quota created'); onClose(); }, onError: (error) => { if (isApiError(error)) setErrors(error.fieldErrors()); }, onSettled: () => void client.invalidateQueries({ queryKey: ['ws', ws.id, 'quotas'] }) });
  const subjectPermission = scope === 'MEMBER' ? 'member:read' : scope === 'AGENT' ? 'agent:read' : scope === 'API_KEY' ? 'apikey:read' : null;
  const subjectOptions = scope === 'MEMBER' ? members.data?.pages.flatMap((page) => page.items.map((member) => ({ value: member.userId, label: member.displayName, description: member.email }))) ?? [] : scope === 'AGENT' ? agents.data?.items.map((agent) => ({ value: agent.id, label: agent.name })) ?? [] : keys.data?.filter((key) => !key.revokedAt).map((key) => ({ value: key.id, label: key.name })) ?? [];
  const subjectsLoading = scope === 'MEMBER' ? members.isPending : scope === 'AGENT' ? agents.isPending : keys.isPending;
  const subjectsError = scope === 'MEMBER' ? members.error : scope === 'AGENT' ? agents.error : keys.error;
  const weakens = Boolean(quota && quotaChangeWeakens(quota, Number(limit), enforcement));
  function submit() {
    const next: Record<string, string> = {};
    if (!Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 1e12) next.tokenLimit = 'Enter a whole number from 1 to 1,000,000,000,000.';
    if (!Number.isInteger(Number(threshold)) || Number(threshold) < 1 || Number(threshold) > 100) next.alertThreshold = 'Enter a whole percentage from 1 to 100.';
    if (!quota && scope !== 'ORGANIZATION' && !subjectId) next.subjectId = 'Choose who this quota applies to.';
    if (label.length > 120) next.label = 'Use 120 characters or fewer.';
    setErrors(next); if (!Object.keys(next).length) save.mutate();
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }}><DialogContent size="xl" onInteractOutside={(e) => { if (save.isPending) e.preventDefault(); }} onEscapeKeyDown={(e) => { if (save.isPending) e.preventDefault(); }}><form className="contents" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
    <DialogHeader title={quota ? 'Edit quota' : 'Create quota'} description="Apply a budget or rate limit to the workspace, a member, an agent or an API key." icon={<Gauge />} />
    <DialogBody className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Scope" error={errors.scope}><Select value={scope} onValueChange={(value) => { setScope(value); setSubjectId(''); }} disabled={Boolean(quota) || save.isPending} options={[{ value: 'ORGANIZATION', label: 'Whole workspace' }, { value: 'MEMBER', label: 'Member' }, { value: 'AGENT', label: 'Agent' }, { value: 'API_KEY', label: 'API key' }]} /></Field><Field label="Period" error={errors.period}><Select value={period} onValueChange={setPeriod} disabled={Boolean(quota) || save.isPending} options={[{ value: 'MONTH', label: 'Monthly budget (UTC)' }, { value: 'DAY', label: 'Daily budget (UTC)' }, { value: 'MINUTE', label: 'Per-minute rate' }]} /></Field></div>
      {scope !== 'ORGANIZATION' && !quota ? <Field label={scope === 'MEMBER' ? 'Member' : scope === 'AGENT' ? 'Agent' : 'API key'} error={errors.subjectId} hint={subjectPermission && !can(subjectPermission) ? `Choosing this subject requires ${subjectPermission}.` : scope === 'MEMBER' ? 'The member’s user ID is used for this quota.' : undefined}>
        {scope === 'MEMBER' && can('member:read') ? <Input aria-label="Search members" placeholder="Search members…" value={search} onChange={(e) => setSearch(e.target.value)} disabled={save.isPending} /> : null}
        <Select value={subjectId || undefined} onValueChange={setSubjectId} placeholder={subjectsLoading && (!subjectPermission || can(subjectPermission)) ? 'Loading…' : 'Choose a subject'} disabled={save.isPending || Boolean(subjectPermission && !can(subjectPermission))} options={subjectOptions} />
        {subjectsError ? <FormError message={messageFor(subjectsError)} /> : null}
        {scope === 'MEMBER' && members.hasNextPage ? <Button size="sm" variant="ghost" loading={members.isFetchingNextPage} onClick={() => void members.fetchNextPage()}>Load more members</Button> : null}
        {scope === 'AGENT' && agents.data && !agents.data.complete ? <p className="text-xs text-warning-700">Showing the first 2,000 visible agents.</p> : null}
      </Field> : null}
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Token limit" error={errors.tokenLimit}><Input type="number" min={1} max={1e12} step={1} value={limit} onChange={(e) => setLimit(e.target.value)} disabled={save.isPending} /></Field><Field label="Alert threshold (%)" error={errors.alertThreshold}><Input type="number" min={1} max={100} step={1} value={threshold} onChange={(e) => setThreshold(e.target.value)} disabled={save.isPending} /></Field></div>
      <Field label="Enforcement" error={errors.enforcement}><Select value={enforcement} onValueChange={setEnforcement} disabled={save.isPending} options={[{ value: 'HARD', label: 'Hard — refuse calls above the limit', description: 'Reserve the estimated prompt plus maximum output before admitting a call.' }, { value: 'SOFT', label: 'Soft — alert and allow calls', description: 'Consumption can exceed the limit.' }]} /></Field>
      <Field label="Label" optional error={errors.label}><Input value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Research team monthly budget" disabled={save.isPending} /></Field>
      {!quota && period !== 'MINUTE' ? <Callout tone="info">A new budget includes tokens already spent in this period. A hard limit below that spend will refuse the next call.</Callout> : null}
      {weakens ? <Callout tone="warning" title="This relaxes a control; it is audited">The higher limit or softer enforcement applies immediately here and within 30 seconds on other servers.</Callout> : null}
      {save.isError ? <><FormError message={messageFor(save.error)} />{isApiError(save.error) ? <RequestReference requestId={save.error.requestId} /> : null}{isOutcomeUnknown(save.error) ? <Callout tone="warning">The response was lost. Check the quota list before saving again; the server may have applied this change.</Callout> : null}</> : null}
    </DialogBody><DialogFooter><Button variant="ghost" disabled={save.isPending} onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending} disabled={!can('quota:manage') || Boolean(quota?.managedBy === 'PLATFORM') || (!quota && Boolean(subjectPermission && !can(subjectPermission)))}>{quota ? 'Save quota' : 'Create quota'}</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}
