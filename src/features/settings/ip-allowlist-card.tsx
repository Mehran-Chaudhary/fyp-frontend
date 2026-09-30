import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleCheck, Globe, Network, Plus, ShieldAlert, Trash2, TriangleAlert } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
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
import { hasCode, isApiError } from '@/lib/api/errors';
import type { IpRule, Organization } from '@/lib/api/types';
import { applyServerErrors, messageFor } from '@/lib/errors';
import { ipRulesQuery, queryKeys, sessionsQuery } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast, toastError } from '@/lib/toast';
import { cn, formatDate } from '@/lib/utils';
import { invalidateIpRules } from '@/lib/workspace/cache';
import { hostRuleFor, isValidCidr, matchingRule, wouldLockMeOut } from '@/lib/workspace/ip';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';

const I_UNDERSTAND = 'I understand';

type Block =
  | { kind: 'no-rules' }
  | { kind: 'self'; ip: string; message?: string }
  | { kind: 'server'; message: string };

/**
 * IP allowlist (spec §5.8.3, E33–E36). Enabling enforcement with rules that
 * exclude your own address would lock everyone out, you included, so every
 * change that could do that is checked here first; the server refuses it too
 * (IP_ALLOWLIST_SELF_LOCKOUT).
 */
export function IpAllowlistCard({ organization }: { organization: Organization }) {
  const workspace = useWorkspace();
  const can = useCan();
  const canEdit = can('security:update');
  const enabled = organization.ipAllowlistEnabled;

  const rules = useQuery(ipRulesQuery(workspace.id));
  // Your address as the server sees it: refetched whenever this page opens.
  const sessions = useQuery({ ...sessionsQuery, refetchOnMount: 'always' });
  const currentIp = sessions.data?.find((session) => session.isCurrent)?.ipAddress ?? null;
  const ruleList = rules.data ?? [];
  const cidrs = ruleList.map((rule) => rule.cidr);
  const match = matchingRule(currentIp, ruleList);

  const [block, setBlock] = useState<Block | null>(null);
  const [enableOpen, setEnableOpen] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);
  const deleteDialog = useDialogTarget<IpRule>();

  const storeOrganization = (updated: Organization) => {
    queryClient.setQueryData(queryKeys.details(workspace.id), updated);
    void invalidateIpRules(workspace.id);
  };

  const lockoutFrom = (error: unknown): Block | null => {
    if (!isApiError(error) || error.code !== 'IP_ALLOWLIST_SELF_LOCKOUT') return null;
    const ip = typeof error.details?.ip === 'string' ? error.details.ip : currentIp;
    return ip ? { kind: 'self', ip, message: error.message } : { kind: 'server', message: error.message };
  };

  const enforcement = useMutation({
    mutationFn: (next: boolean) => workspaceApi.setIpEnforcement(workspace.id, next),
    onSuccess: (updated, next) => {
      storeOrganization(updated);
      setEnableOpen(false);
      setBlock(null);
      toast.success(next ? 'IP restriction is on' : 'IP restriction is off', {
        description: next
          ? 'Only the networks on the allowlist can reach this workspace, from the next request.'
          : 'Any network can reach this workspace again.',
      });
    },
    onError: (error, next) => {
      const lockout = lockoutFrom(error);
      if (lockout) {
        setEnableOpen(false);
        setBlock(lockout);
      } else if (next && enableOpen) {
        setEnableError(messageFor(error));
      } else {
        toastError(error, "Couldn't change IP restriction");
      }
      void invalidateIpRules(workspace.id);
    },
  });

  const addMine = useMutation({
    mutationFn: (ip: string) => workspaceApi.addIpRule(workspace.id, { cidr: hostRuleFor(ip), label: 'My address' }),
    onSuccess: (rule) => {
      toast.success('Your address is on the allowlist', { description: rule.cidr });
      setBlock(null);
    },
    onError: (error) => {
      if (hasCode(error, 'RESOURCE_CONFLICT')) toast.info('Your address is already on the allowlist');
      else toastError(error, "Couldn't add your address");
    },
    onSettled: () => void invalidateIpRules(workspace.id),
  });

  const requestEnable = () => {
    setBlock(null);
    setEnableError(null);
    if (cidrs.length === 0) {
      setBlock({ kind: 'no-rules' });
      return;
    }
    const lock = wouldLockMeOut(currentIp, cidrs);
    if (lock === true && currentIp) {
      setBlock({ kind: 'self', ip: currentIp });
      return;
    }
    setEnableOpen(true);
  };

  const onToggle = (next: boolean) => {
    if (next) requestEnable();
    else enforcement.mutate(false);
  };

  // No current-session row (or not loaded yet): we can't check for a lockout.
  const ipUnknown = !currentIp;
  const switchId = useId();

  return (
    <Card>
      <CardHeader
        icon={<Network />}
        title="IP allowlist"
        description="Only let people and API keys reach this workspace from approved networks."
        actions={
          <div className="flex items-center gap-2.5">
            <label htmlFor={switchId} className="text-[13px] text-ink-soft">
              IP restriction is <span className={cn('font-semibold', enabled ? 'text-brand-700' : 'text-ink')}>{enabled ? 'on' : 'off'}</span>
            </label>
            <Switch
              id={switchId}
              checked={enabled}
              onCheckedChange={onToggle}
              disabled={!canEdit || enforcement.isPending || rules.isPending}
              className={cn(enforcement.isPending && 'animate-pulse')}
            />
          </div>
        }
      />

      <div className="grid gap-4 border-t border-line px-5 py-4 sm:px-6">
        <YourAddress
          loading={sessions.isPending}
          ip={currentIp}
          match={match}
          enabled={enabled}
          canAdd={canEdit && !!currentIp && !match}
          adding={addMine.isPending}
          onAdd={() => currentIp && addMine.mutate(currentIp)}
        />

        {block ? (
          <BlockNotice
            block={block}
            canEdit={canEdit}
            adding={addMine.isPending}
            onAdd={(ip) => addMine.mutate(ip)}
            onDismiss={() => setBlock(null)}
          />
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
            description="Add an address or a range, then turn IP restriction on."
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Address or range</TH>
                <TH>Label</TH>
                <TH className="hidden md:table-cell">Added</TH>
                <TH className="hidden sm:table-cell">Last matched</TH>
                <TH className="w-12">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {ruleList.map((rule) => {
                const yours = match?.id === rule.id;
                return (
                  <TR key={rule.id}>
                    <TD>
                      <span className="inline-flex items-center gap-2">
                        <code className="font-mono text-[12.5px] text-ink">{rule.cidr}</code>
                        {yours ? (
                          <Tooltip content="Your current address is in this range">
                            <span tabIndex={0} className="rounded-sm">
                              <Badge tone="brand">You</Badge>
                            </span>
                          </Tooltip>
                        ) : null}
                      </span>
                    </TD>
                    <TD className="max-w-[14rem] truncate">{rule.label ?? <span className="text-faint">—</span>}</TD>
                    <TD className="hidden text-muted md:table-cell">{formatDate(rule.createdAt)}</TD>
                    <TD className="hidden text-muted sm:table-cell">
                      <RelativeTime value={rule.lastMatchedAt} />
                    </TD>
                    <TD className="text-right">
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-faint hover:text-danger-600"
                          onClick={() => deleteDialog.show(rule)}
                          aria-label={`Delete ${rule.cidr}`}
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

      {canEdit ? <AddRuleForm existing={cidrs} /> : null}

      <p className="rounded-b-xl border-t border-line bg-well/40 px-5 py-3 text-xs leading-relaxed text-muted sm:px-6">
        Changes take effect on the very next request. “Last matched” is recorded at most once a minute while restriction
        is on. API keys can also be limited to networks of their own.
      </p>

      <ConfirmDialog
        open={enableOpen}
        onOpenChange={setEnableOpen}
        icon={<ShieldAlert />}
        tone="warning"
        size="md"
        title="Turn on IP restriction?"
        description="From the next request, only the networks on the allowlist can reach this workspace, for every member and API key."
        confirmLabel="Turn on"
        pending={enforcement.isPending}
        error={enableError}
        typeToConfirm={ipUnknown ? I_UNDERSTAND : undefined}
        typeToConfirmLabel={
          ipUnknown ? (
            <>
              We can't tell your current address, so we can't check that you'd still get in. Type{' '}
              <span className="font-mono font-semibold text-ink">{I_UNDERSTAND}</span> to continue anyway.
            </>
          ) : undefined
        }
        onConfirm={() => enforcement.mutate(true)}
      >
        {currentIp && match ? (
          <Callout tone="success" icon={<CircleCheck className="size-4" />}>
            Your address <code className="font-mono">{currentIp}</code> matches “{match.label ?? match.cidr}”, so you'll
            keep access.
          </Callout>
        ) : null}
      </ConfirmDialog>

      <DeleteRuleDialog
        rule={deleteDialog.target}
        open={deleteDialog.open}
        onOpenChange={deleteDialog.onOpenChange}
        enforcing={enabled}
        rules={ruleList}
        currentIp={currentIp}
        onLockout={(lockout) => setBlock(lockout)}
        lockoutFrom={lockoutFrom}
      />
    </Card>
  );
}

function YourAddress({
  loading,
  ip,
  match,
  enabled,
  canAdd,
  adding,
  onAdd,
}: {
  loading: boolean;
  ip: string | null;
  match: IpRule | null;
  enabled: boolean;
  canAdd: boolean;
  adding: boolean;
  onAdd: () => void;
}) {
  if (loading) return <Skeleton className="h-5 w-72" />;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
      <span className="text-muted">Your address</span>
      {ip ? (
        <>
          <code className="rounded-md border border-line bg-well px-1.5 py-0.5 font-mono text-[12.5px] text-ink">{ip}</code>
          {match ? (
            <span className="inline-flex items-center gap-1.5 text-success-700">
              <CircleCheck className="size-3.5" aria-hidden />
              matches “{match.label ?? match.cidr}”
            </span>
          ) : (
            <span className={cn('inline-flex items-center gap-1.5', enabled ? 'text-danger-700' : 'text-muted')}>
              {enabled ? <TriangleAlert className="size-3.5" aria-hidden /> : null}
              doesn't match any rule
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
  );
}

function BlockNotice({
  block,
  canEdit,
  adding,
  onAdd,
  onDismiss,
}: {
  block: Block;
  canEdit: boolean;
  adding: boolean;
  onAdd: (ip: string) => void;
  onDismiss: () => void;
}) {
  let title: ReactNode;
  let body: ReactNode;
  let action: ReactNode = null;
  if (block.kind === 'no-rules') {
    title = 'Add a rule first';
    body = 'With no rules, turning restriction on would lock every member out. Add at least one network below.';
  } else if (block.kind === 'self') {
    title = 'This would lock you out';
    body = block.message ?? (
      <>
        Your current address (<code className="font-mono">{block.ip}</code>) isn't on the allowlist. Add it first, or
        you'll lose access along with everyone else outside these networks.
      </>
    );
    action = canEdit ? (
      <Button size="sm" variant="secondary" loading={adding} onClick={() => onAdd(block.ip)}>
        {adding ? null : <Plus />}
        Add my address ({block.ip})
      </Button>
    ) : null;
  } else {
    title = "That change wasn't made";
    body = block.message;
  }
  return (
    <Callout
      tone="danger"
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

// ── Adding a rule (E34) ─────────────────────────────────────────────────────

function AddRuleForm({ existing }: { existing: string[] }) {
  const workspace = useWorkspace();
  const schema = z.object({
    cidr: z
      .string()
      .trim()
      .min(1, 'Enter an address or a range.')
      .max(64, 'Use no more than 64 characters.')
      .refine(isValidCidr, 'Enter an IPv4 or IPv6 address, or a range such as 203.0.113.0/24.')
      .refine((value) => !existing.includes(value), 'That range is already on the allowlist.'),
    label: z.string().trim().max(120, 'Use no more than 120 characters.'),
  });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { cidr: '', label: '' } });
  const { errors } = form.formState;

  const add = useMutation({
    mutationFn: (values: { cidr: string; label: string }) =>
      workspaceApi.addIpRule(workspace.id, { cidr: values.cidr, ...(values.label ? { label: values.label } : {}) }),
    onSuccess: (rule) => {
      toast.success('Added to the allowlist', { description: rule.cidr });
      form.reset();
    },
    onError: (error) => {
      if (hasCode(error, 'BAD_REQUEST', 'RESOURCE_CONFLICT')) {
        form.setError('cidr', { message: messageFor(error) }, { shouldFocus: true });
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
      <Field label="Address or range" error={errors.cidr?.message}>
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

// ── Deleting a rule (E35) ───────────────────────────────────────────────────

function DeleteRuleDialog({
  rule,
  open,
  onOpenChange,
  enforcing,
  rules,
  currentIp,
  onLockout,
  lockoutFrom,
}: {
  rule: IpRule | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enforcing: boolean;
  rules: IpRule[];
  currentIp: string | null;
  onLockout: (block: Block) => void;
  lockoutFrom: (error: unknown) => Block | null;
}) {
  const workspace = useWorkspace();
  const [error, setError] = useState<string | null>(null);

  const remaining = rules.filter((candidate) => candidate.id !== rule?.id).map((candidate) => candidate.cidr);
  const lastRule = enforcing && remaining.length === 0;
  const lock = enforcing ? wouldLockMeOut(currentIp, remaining) : false;
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
    onError: (err) => {
      const lockout = lockoutFrom(err);
      if (lockout) {
        close();
        onLockout(lockout);
      } else if (hasCode(err, 'RESOURCE_NOT_FOUND')) {
        toast.info('That rule was already removed');
        close();
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
        blocked
          ? undefined
          : enforcing
            ? 'Connections from this network are refused from the next request.'
            : 'IP restriction is off, so nothing changes until it is turned on.'
      }
      confirmLabel="Remove rule"
      confirmDisabled={blocked}
      pending={remove.isPending}
      error={error}
      typeToConfirm={unknown ? I_UNDERSTAND : undefined}
      typeToConfirmLabel={
        unknown ? (
          <>
            We can't tell your current address, so we can't check that you'd keep access. Type{' '}
            <span className="font-mono font-semibold text-ink">{I_UNDERSTAND}</span> to continue.
          </>
        ) : undefined
      }
      onConfirm={() => rule && remove.mutate(rule)}
    >
      {lastRule ? (
        <Callout tone="warning">
          It's the last rule and IP restriction is on, so removing it would lock every member out. Turn restriction off
          first, or add another rule.
        </Callout>
      ) : lock === true ? (
        <Callout tone="warning">
          Your current address (<code className="font-mono">{currentIp}</code>) isn't covered by the other rules, so
          removing this one would lock you out. Add a rule that includes your address first.
        </Callout>
      ) : null}
    </ConfirmDialog>
  );
}
