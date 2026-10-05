import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleCheck, Globe, Info, Network, Plus, RefreshCw, ShieldAlert, ShieldOff, Trash2, TriangleAlert } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { NoAccessState } from '@/components/feedback/no-access';
import { OutcomeUnknown } from '@/components/feedback/outcome-unknown';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { RelativeTime } from '@/components/ui/relative-time';
import { Switch } from '@/components/ui/switch';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { useDialogTarget } from '@/components/ui/use-dialog-target';
import { workspaceApi } from '@/lib/api/endpoints';
import { hasCode, isApiError, isOutcomeUnknown } from '@/lib/api/errors';
import type { IpRule } from '@/lib/api/types';
import { applyServerErrors, messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { ipRulesQuery, queryKeys, sessionsQuery, workspaceDetailsQuery } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast, toastError } from '@/lib/toast';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import { invalidateAfterPolicyChange, invalidateIpRules } from '@/lib/workspace/cache';
import { hostRuleFor, isValidCidr, matchingRule, wouldLockMeOut } from '@/lib/workspace/ip';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';

const I_UNDERSTAND = 'I understand';

/** Problems shown above the rules, each with its deliberate next step (spec §4, §9 "409"). */
type Block =
  | { kind: 'no-rules' }
  | { kind: 'self'; ip: string; source: 'server' | 'session'; message?: string }
  | { kind: 'last-rule'; rule: IpRule }
  | { kind: 'server'; message: string };

/** Settings → Networks (spec §4 `/settings/networks`, P2-API-04–07). */
export function NetworksSettingsPage() {
  const workspace = useWorkspace();
  const can = useCan();
  useDocumentTitle('Networks');
  if (!can('security:read')) {
    return (
      <Card>
        <NoAccessState permissions={['security:read']} workspaceName={workspace.name} />
      </Card>
    );
  }
  return <Networks />;
}

function Networks() {
  const workspace = useWorkspace();
  const can = useCan();
  const canEdit = can('security:update');
  const canReadWorkspace = can('workspace:read');

  const details = useQuery({ ...workspaceDetailsQuery(workspace.id), enabled: canReadWorkspace });
  const rules = useQuery(ipRulesQuery(workspace.id));
  // The address the API recorded for this session: refreshed whenever the page opens.
  const sessions = useQuery({ ...sessionsQuery, refetchOnMount: 'always' });
  const sessionIp = sessions.data?.find((session) => session.isCurrent)?.ipAddress ?? null;
  // An address the server itself reported in a refusal is better evidence than the session record.
  const [observedIp, setObservedIp] = useState<string | null>(null);
  const currentIp = observedIp ?? sessionIp;
  const ipSource: 'server' | 'session' = observedIp ? 'server' : 'session';

  const ruleList = rules.data ?? [];
  const activeRules = ruleList.filter((rule) => rule.isActive);
  const activeCidrs = activeRules.map((rule) => rule.cidr);
  const match = matchingRule(currentIp, activeRules);
  const enabled = details.data?.ipAllowlistEnabled;

  const [block, setBlock] = useState<Block | null>(null);
  const [uncertain, setUncertain] = useState<unknown>(null);
  const [enforceDialog, setEnforceDialog] = useState<'enable' | 'disable' | null>(null);
  const [enforceError, setEnforceError] = useState<string | null>(null);
  const deleteDialog = useDialogTarget<IpRule>();

  const lockoutFrom = (error: unknown): Block | null => {
    if (!isApiError(error) || error.code !== 'IP_ALLOWLIST_SELF_LOCKOUT') return null;
    const ip = typeof error.details?.ip === 'string' ? error.details.ip : null;
    if (ip) setObservedIp(ip);
    const address = ip ?? currentIp;
    return address
      ? { kind: 'self', ip: address, source: ip ? 'server' : ipSource, message: error.message }
      : { kind: 'server', message: error.message };
  };

  const refresh = () => {
    void invalidateIpRules(workspace.id);
    void invalidateAfterPolicyChange(workspace.id);
  };

  const enforcement = useMutation({
    mutationFn: (next: boolean) => workspaceApi.setIpEnforcement(workspace.id, next),
    onSuccess: (updated, next) => {
      queryClient.setQueryData(queryKeys.details(workspace.id), updated);
      setEnforceDialog(null);
      setBlock(null);
      toast.success(next ? 'IP enforcement is on' : 'IP enforcement is off', {
        description: next
          ? 'From the next request, only networks on the active rules can reach this workspace.'
          : 'The rules are kept but no longer applied.',
      });
    },
    onError: (error) => {
      const lockout = lockoutFrom(error);
      if (lockout) {
        setEnforceDialog(null);
        setBlock(lockout);
      } else if (isOutcomeUnknown(error)) {
        setEnforceDialog(null);
        setUncertain(error);
      } else if (hasCode(error, 'BAD_REQUEST')) {
        setEnforceDialog(null);
        setBlock({ kind: 'no-rules' });
      } else {
        setEnforceError(messageFor(error));
      }
    },
    onSettled: refresh,
  });

  const addMine = useMutation({
    mutationFn: (ip: string) => workspaceApi.addIpRule(workspace.id, { cidr: hostRuleFor(ip), label: 'My address' }),
    onSuccess: (rule) => {
      toast.success('Your address is on the allowlist', { description: rule.cidr });
      setBlock(null);
    },
    onError: (error) => {
      if (hasCode(error, 'RESOURCE_CONFLICT')) toast.info('That exact entry is already on the allowlist');
      else if (isOutcomeUnknown(error)) setUncertain(error);
      else toastError(error, "Couldn't add your address");
    },
    onSettled: () => void invalidateIpRules(workspace.id),
  });

  const requestEnable = () => {
    setBlock(null);
    setEnforceError(null);
    if (activeCidrs.length === 0) {
      setBlock({ kind: 'no-rules' });
      return;
    }
    if (currentIp && wouldLockMeOut(currentIp, activeCidrs) === true) {
      setBlock({ kind: 'self', ip: currentIp, source: ipSource });
      return;
    }
    setEnforceDialog('enable');
  };

  const switchId = useId();

  return (
    <div className="grid grid-cols-1 gap-6">
      <Card>
        <CardHeader
          icon={<Network />}
          title="IP allowlist"
          description="Only let people and API keys reach this workspace from approved networks."
          actions={
            canReadWorkspace ? (
              <div className="flex items-center gap-2.5">
                <label htmlFor={switchId} className="text-[13px] text-ink-soft">
                  Enforcement{' '}
                  {enabled === undefined ? (
                    <span className="text-muted">…</span>
                  ) : (
                    <span className={cn('font-semibold', enabled ? 'text-brand-700' : 'text-ink')}>{enabled ? 'on' : 'off'}</span>
                  )}
                </label>
                <Switch
                  id={switchId}
                  checked={!!enabled}
                  onCheckedChange={(next) => {
                    setEnforceError(null);
                    if (next) requestEnable();
                    else setEnforceDialog('disable');
                  }}
                  disabled={!canEdit || enabled === undefined || enforcement.isPending || rules.isPending}
                  className={cn(enforcement.isPending && 'animate-pulse')}
                />
              </div>
            ) : null
          }
        />

        <div className="grid gap-4 border-t border-line px-5 py-4 sm:px-6">
          {!canReadWorkspace ? (
            <Callout tone="neutral" icon={<Info className="size-4" />}>
              Whether enforcement is on is part of the workspace detail, which needs{' '}
              <code className="font-mono text-[12px]">workspace:read</code>. You can still see the rules.
            </Callout>
          ) : details.isError ? (
            <ErrorState compact error={details.error} title="We couldn't read the enforcement state" onRetry={() => void details.refetch()} />
          ) : null}

          <YourAddress
            loading={sessions.isPending}
            ip={currentIp}
            source={ipSource}
            match={match}
            enabled={!!enabled}
            canAdd={canEdit && !!currentIp && !match}
            adding={addMine.isPending}
            onAdd={() => currentIp && addMine.mutate(currentIp)}
          />

          {block ? (
            <BlockNotice
              block={block}
              canEdit={canEdit}
              enabled={!!enabled}
              adding={addMine.isPending}
              onAdd={(ip) => addMine.mutate(ip)}
              onDisable={() => {
                setBlock(null);
                setEnforceDialog('disable');
              }}
              onDismiss={() => setBlock(null)}
            />
          ) : null}

          {uncertain ? (
            <OutcomeUnknown
              error={uncertain}
              action={
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => {
                    setUncertain(null);
                    refresh();
                  }}
                >
                  <RefreshCw />
                  Re-check rules and enforcement
                </Button>
              }
            >
              The change may have been applied. Review the rules and the switch as the server reports them before trying
              again.
            </OutcomeUnknown>
          ) : null}
        </div>

        <div className="border-t border-line">
          {rules.isPending ? (
            <div className="grid gap-3 px-5 py-4 sm:px-6">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ) : rules.isError ? (
            <ErrorState compact error={rules.error} title="We couldn't load the allowlist" onRetry={() => void rules.refetch()} retrying={rules.isFetching} />
          ) : ruleList.length === 0 ? (
            <EmptyState
              className="py-10"
              icon={<Globe />}
              title="No networks on the allowlist"
              description={
                canEdit
                  ? 'Add an address or range that covers your own network first, then turn enforcement on.'
                  : 'No rules have been added.'
              }
            />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Address or range</TH>
                  <TH>Label</TH>
                  <TH className="hidden md:table-cell">Added</TH>
                  <TH className="hidden sm:table-cell">Last match</TH>
                  <TH className="w-12">
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {ruleList.map((rule) => {
                  const yours = match?.id === rule.id;
                  return (
                    <TR key={rule.id} className={cn(!rule.isActive && 'text-muted')}>
                      <TD>
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <code className="font-mono text-[12.5px] text-ink">{rule.cidr}</code>
                          {yours ? <Badge tone="brand">Covers you</Badge> : null}
                          {!rule.isActive ? <Badge tone="neutral">Inactive</Badge> : null}
                        </span>
                      </TD>
                      <TD className="max-w-[14rem] truncate">{rule.label ?? <span className="text-faint">—</span>}</TD>
                      <TD className="hidden text-muted md:table-cell">
                        <Tooltip content={formatDateTime(rule.createdAt)}>
                          <span tabIndex={0} className="rounded-sm">
                            {formatDate(rule.createdAt)}
                          </span>
                        </Tooltip>
                      </TD>
                      <TD className="hidden text-muted sm:table-cell">
                        <RelativeTime value={rule.lastMatchedAt} fallback="None recorded" />
                      </TD>
                      <TD className="text-right">
                        {canEdit ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-faint hover:text-danger-600"
                            onClick={() => deleteDialog.show(rule)}
                            aria-label={`Remove ${rule.cidr}${rule.label ? ` (${rule.label})` : ''}`}
                          >
                            <Trash2 />
                          </Button>
                        ) : null}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </div>

        {canEdit ? <AddRuleForm existing={ruleList.map((rule) => rule.cidr)} onUncertain={setUncertain} /> : null}

        <p className="rounded-b-xl border-t border-line bg-well/40 px-5 py-3 text-xs leading-relaxed text-muted sm:px-6">
          Rules can't be edited: add the replacement, then remove the old one. “Last match” is recorded at most about
          once a minute while enforcement is on, so an empty value doesn't prove a rule was never used. API keys can
          also be pinned to networks of their own.
        </p>
      </Card>

      <Callout tone="neutral" icon={<ShieldOff className="size-4" />} title="What the switch does and doesn't prove">
        The switch stores this workspace's policy. A deployment can turn IP checks off globally, and the server lets
        requests through if it can't read the rules, so "on" here isn't proof of network protection. If you're ever
        locked out, a deployment operator has to turn enforcement off for you: this page can't be reached from a
        blocked network.
      </Callout>

      <EnforcementDialog
        mode={enforceDialog}
        onClose={() => setEnforceDialog(null)}
        pending={enforcement.isPending}
        error={enforceError}
        currentIp={currentIp}
        ipSource={ipSource}
        match={match}
        activeCount={activeRules.length}
        onConfirm={(next) => enforcement.mutate(next)}
      />

      <DeleteRuleDialog
        rule={deleteDialog.target}
        open={deleteDialog.open}
        onOpenChange={deleteDialog.onOpenChange}
        enforcing={!!enabled}
        activeRules={activeRules}
        currentIp={currentIp}
        onBlock={setBlock}
        onUncertain={setUncertain}
        lockoutFrom={lockoutFrom}
      />
    </div>
  );
}

function YourAddress({
  loading,
  ip,
  source,
  match,
  enabled,
  canAdd,
  adding,
  onAdd,
}: {
  loading: boolean;
  ip: string | null;
  source: 'server' | 'session';
  match: IpRule | null;
  enabled: boolean;
  canAdd: boolean;
  adding: boolean;
  onAdd: () => void;
}) {
  if (loading) return <Skeleton className="h-5 w-72" />;
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
        <span className="text-muted">Your address</span>
        {ip ? (
          <>
            <code className="rounded-md border border-line bg-well px-1.5 py-0.5 font-mono text-[12.5px] text-ink">{ip}</code>
            {match ? (
              <span className="inline-flex items-center gap-1.5 text-success-700">
                <CircleCheck className="size-3.5" aria-hidden />
                covered by “{match.label ?? match.cidr}”
              </span>
            ) : (
              <span className={cn('inline-flex items-center gap-1.5', enabled ? 'text-danger-700' : 'text-muted')}>
                {enabled ? <TriangleAlert className="size-3.5" aria-hidden /> : null}
                not covered by any active rule
              </span>
            )}
            {canAdd ? (
              <Button variant="secondary" size="xs" loading={adding} onClick={onAdd}>
                {adding ? null : <Plus />}
                Add my address
              </Button>
            ) : null}
          </>
        ) : (
          <span className="text-muted">unknown (this device has no current session record)</span>
        )}
      </div>
      {ip ? (
        <p className="text-xs leading-relaxed text-faint">
          {source === 'server'
            ? 'As the server reported it when it refused a change.'
            : 'As the server recorded it for this session. If your network changed since you signed in, or a proxy rewrites addresses, the server may see another one; the server re-checks every change.'}
        </p>
      ) : null}
    </div>
  );
}

function BlockNotice({
  block,
  canEdit,
  enabled,
  adding,
  onAdd,
  onDisable,
  onDismiss,
}: {
  block: Block;
  canEdit: boolean;
  enabled: boolean;
  adding: boolean;
  onAdd: (ip: string) => void;
  onDisable: () => void;
  onDismiss: () => void;
}) {
  let title: ReactNode;
  let body: ReactNode;
  let action: ReactNode = null;
  switch (block.kind) {
    case 'no-rules':
      title = 'Add an active rule first';
      body = 'Enforcement needs at least one active rule, and one of them should cover your own network.';
      break;
    case 'self':
      title = 'This would lock you out';
      body = (
        <>
          {block.source === 'server' ? 'The server saw your request come from' : 'Your address'}{' '}
          <code className="font-mono">{block.ip}</code>, which the remaining active rules don't cover. Add a rule that
          includes it first.
        </>
      );
      action = canEdit ? (
        <Button size="sm" variant="secondary" loading={adding} onClick={() => onAdd(block.ip)}>
          {adding ? null : <Plus />}
          Add {block.ip}
        </Button>
      ) : null;
      break;
    case 'last-rule':
      title = `${block.rule.cidr} is the last active rule`;
      body =
        'Removing it while enforcement is on would leave no network allowed, so the server refused. Add a replacement rule first, or deliberately turn enforcement off.';
      action =
        canEdit && enabled ? (
          <Button size="sm" variant="secondary" onClick={onDisable}>
            Turn enforcement off…
          </Button>
        ) : null;
      break;
    case 'server':
      title = "That change wasn't made";
      body = block.message;
      break;
  }
  return (
    <Callout
      tone="danger"
      role="alert"
      title={title}
      action={
        <div className="flex flex-wrap gap-2">
          {action}
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      }
    >
      {body}
    </Callout>
  );
}

function EnforcementDialog({
  mode,
  onClose,
  pending,
  error,
  currentIp,
  ipSource,
  match,
  activeCount,
  onConfirm,
}: {
  mode: 'enable' | 'disable' | null;
  onClose: () => void;
  pending: boolean;
  error: string | null;
  currentIp: string | null;
  ipSource: 'server' | 'session';
  match: IpRule | null;
  activeCount: number;
  onConfirm: (next: boolean) => void;
}) {
  const enabling = mode === 'enable';
  const ipUnknown = enabling && !currentIp;
  return (
    <ConfirmDialog
      open={mode !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      icon={enabling ? <ShieldAlert /> : <ShieldOff />}
      tone="warning"
      size="md"
      title={enabling ? 'Turn IP enforcement on?' : 'Turn IP enforcement off?'}
      description={
        enabling
          ? `From the next request, only the ${activeCount === 1 ? 'network on the 1 active rule' : `networks on the ${activeCount} active rules`} can reach this workspace: every member and every API key.`
          : 'Every network can reach this workspace again. The rules are kept and apply again when you turn it back on.'
      }
      confirmLabel={enabling ? 'Turn on' : 'Turn off'}
      pending={pending}
      error={error}
      typeToConfirm={ipUnknown ? I_UNDERSTAND : undefined}
      typeToConfirmLabel={
        ipUnknown ? (
          <>
            We don't know your current address, so we can't check that you'd keep access. The server refuses a change
            that excludes you. Type <span className="font-mono font-semibold text-ink">{I_UNDERSTAND}</span> to continue.
          </>
        ) : undefined
      }
      onConfirm={() => mode && onConfirm(enabling)}
    >
      {enabling ? (
        <div className="grid gap-3">
          {currentIp && match ? (
            <Callout tone="success" icon={<CircleCheck className="size-4" />}>
              {ipSource === 'server' ? 'The address the server reported' : 'Your recorded address'}{' '}
              <code className="font-mono">{currentIp}</code> is covered by “{match.label ?? match.cidr}”.
            </Callout>
          ) : null}
          <p className="text-[13px] leading-relaxed text-muted">
            If a network change locks people out, they can't use this page to fix it: a deployment operator has to turn
            enforcement off.
          </p>
        </div>
      ) : null}
    </ConfirmDialog>
  );
}

// ── Adding a rule (P2-API-05) ───────────────────────────────────────────────

function AddRuleForm({ existing, onUncertain }: { existing: string[]; onUncertain: (error: unknown) => void }) {
  const workspace = useWorkspace();
  const schema = z.object({
    cidr: z
      .string()
      .trim()
      .min(1, 'Enter an address or a range.')
      .max(64, 'Use no more than 64 characters.')
      .refine(isValidCidr, 'Enter an IPv4 or IPv6 address, or a range such as 203.0.113.0/24.')
      // The server compares the exact text; equivalent ranges written differently aren't detected.
      .refine((value) => !existing.includes(value), 'That exact entry is already on the allowlist.'),
    label: z.string().trim().max(120, 'Use no more than 120 characters.'),
  });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { cidr: '', label: '' } });
  const { errors } = form.formState;

  const add = useMutation({
    mutationFn: (values: { cidr: string; label: string }) =>
      workspaceApi.addIpRule(workspace.id, { cidr: values.cidr, ...(values.label ? { label: values.label } : {}) }),
    onSuccess: (rule) => {
      toast.success('Added to the allowlist', { description: `${rule.cidr}. Enforcement is unchanged.` });
      form.reset();
    },
    onError: (error) => {
      if (isOutcomeUnknown(error)) {
        // The list is refreshed below: if the rule is there, it was added.
        onUncertain(error);
        return;
      }
      if (hasCode(error, 'BAD_REQUEST', 'RESOURCE_CONFLICT')) {
        form.setError('cidr', { message: hasCode(error, 'RESOURCE_CONFLICT') ? 'That exact entry is already on the allowlist.' : messageFor(error) }, { shouldFocus: true });
        return;
      }
      applyServerErrors(form, error, { fields: ['cidr', 'label'] });
    },
    onSettled: () => void invalidateIpRules(workspace.id),
  });

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => add.mutate(values))}
      className="grid gap-3 border-t border-line px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start sm:px-6"
    >
      <Field label="Address or range" error={errors.cidr?.message} hint="Your network's egress address, as the server sees it.">
        <Input placeholder="203.0.113.0/24" inputClassName="font-mono" autoComplete="off" spellCheck={false} maxLength={64} {...form.register('cidr')} />
      </Field>
      <Field label="Label" optional error={errors.label?.message}>
        <Input placeholder="Head office VPN" maxLength={120} {...form.register('label')} />
      </Field>
      <Button type="submit" variant="secondary" loading={add.isPending} className="sm:mt-[26px]">
        {add.isPending ? null : <Plus />}
        Add rule
      </Button>
      <FormError message={errors.root?.server?.message} className="sm:col-span-3" />
    </form>
  );
}

// ── Removing a rule (P2-API-06) ─────────────────────────────────────────────

function DeleteRuleDialog({
  rule,
  open,
  onOpenChange,
  enforcing,
  activeRules,
  currentIp,
  onBlock,
  onUncertain,
  lockoutFrom,
}: {
  rule: IpRule | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enforcing: boolean;
  activeRules: IpRule[];
  currentIp: string | null;
  onBlock: (block: Block) => void;
  onUncertain: (error: unknown) => void;
  lockoutFrom: (error: unknown) => Block | null;
}) {
  const workspace = useWorkspace();
  const [error, setError] = useState<string | null>(null);

  const remaining = activeRules.filter((candidate) => candidate.id !== rule?.id).map((candidate) => candidate.cidr);
  const lastRule = enforcing && !!rule?.isActive && remaining.length === 0;
  const lock = enforcing && rule?.isActive ? wouldLockMeOut(currentIp, remaining) : false;
  const blocked = lastRule || lock === true;
  const unknown = enforcing && !lastRule && lock === 'unknown';

  const close = () => {
    onOpenChange(false);
    window.setTimeout(() => setError(null), 200);
  };

  const remove = useMutation({
    mutationFn: (target: IpRule) => workspaceApi.removeIpRule(workspace.id, target.id),
    onSuccess: (_result, target) => {
      toast.success('Removed from the allowlist', { description: target.cidr });
      close();
    },
    onError: (err, target) => {
      const lockout = lockoutFrom(err);
      if (lockout) {
        close();
        onBlock(lockout);
      } else if (hasCode(err, 'RESOURCE_CONFLICT')) {
        close();
        onBlock({ kind: 'last-rule', rule: target });
      } else if (hasCode(err, 'RESOURCE_NOT_FOUND')) {
        toast.info('That rule was already removed', { description: 'The list has been refreshed.' });
        close();
      } else if (isOutcomeUnknown(err)) {
        close();
        onUncertain(err);
      } else {
        setError(messageFor(err));
      }
    },
    onSettled: () => void invalidateIpRules(workspace.id),
  });

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      icon={<Trash2 />}
      tone={blocked ? 'warning' : 'danger'}
      title={blocked ? "You can't remove this rule right now" : `Remove ${rule?.cidr ?? 'this rule'}?`}
      description={
        blocked ? undefined : (
          <>
            {rule?.label ? <>“{rule.label}”. </> : null}
            {enforcing
              ? 'Connections from this network are refused from the next request. Removal is permanent; add it again if you need it.'
              : 'Enforcement is off, so nothing changes until it is turned on. Removal is permanent.'}
          </>
        )
      }
      confirmLabel="Remove rule"
      confirmDisabled={blocked}
      pending={remove.isPending}
      error={error}
      typeToConfirm={unknown ? I_UNDERSTAND : undefined}
      typeToConfirmLabel={
        unknown ? (
          <>
            We don't know your current address, so we can't check that you'd keep access. The server refuses a removal
            that excludes you. Type <span className="font-mono font-semibold text-ink">{I_UNDERSTAND}</span> to continue.
          </>
        ) : undefined
      }
      onConfirm={() => rule && remove.mutate(rule)}
    >
      {lastRule ? (
        <Callout tone="warning">
          It's the last active rule and enforcement is on. Add a replacement rule first, or turn enforcement off on
          purpose: removing it isn't allowed while it's the only one.
        </Callout>
      ) : lock === true ? (
        <Callout tone="warning">
          Your address (<code className="font-mono">{currentIp}</code>) isn't covered by the other active rules, so
          removing this one would lock you out. Add a rule that includes your address first.
        </Callout>
      ) : null}
    </ConfirmDialog>
  );
}
