import { useMutation, useQuery } from '@tanstack/react-query';
import { Ban, KeyRound, KeySquare, Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { useSearchParams } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { RelativeTime } from '@/components/ui/relative-time';
import { Switch } from '@/components/ui/switch';
import { Table, TableMessage, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { useDialogTarget } from '@/components/ui/use-dialog-target';
import { apiKeysApi } from '@/lib/api/endpoints';
import { hasCode } from '@/lib/api/errors';
import type { ApiKey, CreatedApiKey } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { apiKeysQuery, membersQuery, meQuery } from '@/lib/queries';
import { toast } from '@/lib/toast';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import { invalidateApiKeys } from '@/lib/workspace/cache';
import { apiKeyStatus, type ApiKeyStatus } from '@/lib/workspace/status';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { ApiKeySecretDialog } from './api-key-secret-dialog';
import { CreateApiKeyDialog } from './create-api-key-dialog';

const STATUS: Record<ApiKeyStatus, { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  active: { label: 'Active', tone: 'success' },
  expired: { label: 'Expired', tone: 'warning' },
  revoked: { label: 'Revoked', tone: 'neutral' },
};

const COLUMNS = 9;
const REASON_MAX = 255;

/** Settings → API keys (spec §5.9, E56–E59). */
export function ApiKeysPage() {
  const workspace = useWorkspace();
  const can = useCan();
  useDocumentTitle('API keys');

  if (!can('apikey:read')) {
    return (
      <Card>
        <NoAccessState permissions={['apikey:read']} workspaceName={workspace.name} />
      </Card>
    );
  }
  return <ApiKeys />;
}

function ApiKeys() {
  const workspace = useWorkspace();
  const can = useCan();
  const { data: me } = useQuery(meQuery);
  const [params, setParams] = useSearchParams();
  const showRevoked = params.get('revoked') === '1';
  const toggleId = useId();

  const keys = useQuery(apiKeysQuery(workspace.id));
  // Creator names: keys store a user id, so match it against members' userId.
  const members = useQuery({ ...membersQuery(workspace.id, { limit: 100 }), enabled: can('member:read') });

  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const revokeDialog = useDialogTarget<ApiKey>();

  const creatorName = (userId: string): string => {
    if (userId === me?.id) return 'You';
    const member = members.data?.items.find((candidate) => candidate.userId === userId);
    if (member) return member.displayName;
    return members.data ? 'Former member' : '—';
  };

  // Judged at fetch time (pure), refreshed with the list.
  const now = keys.dataUpdatedAt;
  const all = keys.data ?? [];
  const visible = showRevoked ? all : all.filter((key) => !key.revokedAt);
  const revokedCount = all.filter((key) => key.revokedAt).length;

  return (
    <div className="grid gap-6">
      <Card className="overflow-hidden">
        <CardHeader
          icon={<KeySquare />}
          title="API keys"
          description="API keys let services such as the AgentVault AI service call this workspace's API. A key acts only in this workspace, only with its scopes, and never with more than its creator could do."
          actions={
            can('apikey:create') ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus />
                Create key
              </Button>
            ) : null
          }
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-2.5 sm:px-6">
          <p className="text-xs text-muted">
            Keys go in the <code className="font-mono text-[11.5px] text-ink-soft">X-API-Key</code> header. Removing a
            member revokes the keys they created.
          </p>
          <div className="flex items-center gap-2">
            <Switch
              id={toggleId}
              checked={showRevoked}
              onCheckedChange={(next) =>
                setParams(
                  (previous) => {
                    const updated = new URLSearchParams(previous);
                    if (next) updated.set('revoked', '1');
                    else updated.delete('revoked');
                    return updated;
                  },
                  { replace: true, preventScrollReset: true },
                )
              }
            />
            <label htmlFor={toggleId} className="cursor-pointer text-[13px] text-ink-soft select-none">
              Show revoked keys{revokedCount ? <span className="text-muted tabular"> ({revokedCount})</span> : null}
            </label>
          </div>
        </div>

        <Table className="border-t border-line">
          <THead>
            <tr>
              <TH>Name</TH>
              <TH>Key</TH>
              <TH className="hidden lg:table-cell">Scopes</TH>
              <TH>Status</TH>
              <TH className="hidden md:table-cell">Expires</TH>
              <TH className="hidden md:table-cell">Last used</TH>
              <TH className="hidden xl:table-cell text-right">Uses</TH>
              <TH className="hidden xl:table-cell">Created by</TH>
              <TH className="w-12">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {keys.isPending ? (
              Array.from({ length: 3 }, (_, index) => (
                <tr key={index}>
                  {Array.from({ length: COLUMNS }, (_, cell) => (
                    <TD key={cell} className={cn(cell >= 2 && cell !== 3 && cell !== 8 && 'hidden md:table-cell')}>
                      {cell === 8 ? null : <Skeleton className="h-3.5 w-20" />}
                    </TD>
                  ))}
                </tr>
              ))
            ) : keys.isError ? (
              <TableMessage colSpan={COLUMNS}>
                <ErrorState error={keys.error} title="We couldn't load the API keys" onRetry={() => void keys.refetch()} retrying={keys.isFetching} />
              </TableMessage>
            ) : visible.length === 0 ? (
              <TableMessage colSpan={COLUMNS}>
                <EmptyState
                  icon={<KeyRound />}
                  title={all.length ? 'No active keys' : 'No API keys yet'}
                  description={
                    all.length
                      ? 'Every key here has been revoked. Turn on "Show revoked keys" to see them.'
                      : 'Create a key for the AI service or an integration. Give it only the scopes it needs.'
                  }
                  action={
                    can('apikey:create') ? (
                      <Button size="sm" onClick={() => setCreateOpen(true)}>
                        <Plus />
                        Create key
                      </Button>
                    ) : null
                  }
                />
              </TableMessage>
            ) : (
              visible.map((key) => {
                const status = apiKeyStatus(key, now);
                const revoked = status === 'revoked';
                return (
                  <TR key={key.id} className={cn(revoked && 'text-muted')}>
                    <TD className="max-w-[14rem]">
                      <span className={cn('block truncate font-medium', revoked ? 'text-muted line-through decoration-line-strong' : 'text-ink')}>
                        {key.name}
                      </span>
                      {key.description ? <span className="block truncate text-xs text-muted">{key.description}</span> : null}
                      {key.allowedIps.length ? (
                        <Tooltip content={`Only accepted from ${key.allowedIps.join(', ')}`}>
                          <span tabIndex={0} className="mt-0.5 inline-block rounded-sm text-[11px] text-info-700">
                            Restricted to {key.allowedIps.length === 1 ? key.allowedIps[0] : `${key.allowedIps.length} networks`}
                          </span>
                        </Tooltip>
                      ) : null}
                    </TD>
                    <TD>
                      <code className="rounded-md bg-well px-1.5 py-0.5 font-mono text-[11.5px] whitespace-nowrap text-ink-soft">
                        {key.prefix}…
                      </code>
                    </TD>
                    <TD className="hidden max-w-[16rem] lg:table-cell">
                      <ScopeChips scopes={key.scopes} />
                    </TD>
                    <TD>
                      <Badge tone={STATUS[status].tone} dot>
                        {STATUS[status].label}
                      </Badge>
                    </TD>
                    <TD className="hidden text-muted md:table-cell">
                      {revoked && key.revokedAt ? (
                        <Tooltip content={`Revoked ${formatDateTime(key.revokedAt)}`}>
                          <span tabIndex={0} className="rounded-sm whitespace-nowrap">
                            Revoked {formatDate(key.revokedAt)}
                          </span>
                        </Tooltip>
                      ) : key.expiresAt ? (
                        <Tooltip content={formatDateTime(key.expiresAt)}>
                          <span tabIndex={0} className={cn('rounded-sm whitespace-nowrap', status === 'expired' && 'text-warning-700')}>
                            {formatDate(key.expiresAt)}
                          </span>
                        </Tooltip>
                      ) : (
                        'Never'
                      )}
                    </TD>
                    <TD className="hidden text-muted md:table-cell">
                      {key.lastUsedAt ? (
                        <span className="grid">
                          <RelativeTime value={key.lastUsedAt} />
                          {key.lastUsedIp ? <span className="font-mono text-[11px] text-faint">{key.lastUsedIp}</span> : null}
                        </span>
                      ) : (
                        <span className="text-faint">Never</span>
                      )}
                    </TD>
                    <TD className="hidden text-right font-mono text-[12.5px] xl:table-cell tabular">{formatCount(key.usageCount)}</TD>
                    <TD className="hidden max-w-[10rem] truncate xl:table-cell">{creatorName(key.createdById)}</TD>
                    <TD className="text-right">
                      {!revoked && can('apikey:revoke') ? (
                        <Tooltip content="Revoke">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-faint hover:text-danger-600"
                            onClick={() => revokeDialog.show(key)}
                            aria-label={`Revoke ${key.name}`}
                          >
                            <Ban />
                          </Button>
                        </Tooltip>
                      ) : null}
                    </TD>
                  </TR>
                );
              })
            )}
          </TBody>
        </Table>
      </Card>

      <CreateApiKeyDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={setCreated} />
      <ApiKeySecretDialog created={created} onDone={() => setCreated(null)} />
      <RevokeKeyDialog apiKey={revokeDialog.target} open={revokeDialog.open} onOpenChange={revokeDialog.onOpenChange} />
    </div>
  );
}

/** usageCount is a 64-bit counter sent as a string: format it without converting to a number. */
function formatCount(value: string): string {
  return /^\d+$/.test(value) ? value.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : value;
}

function ScopeChips({ scopes }: { scopes: string[] }) {
  const shown = scopes.slice(0, 3);
  const rest = scopes.slice(3);
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((scope) => (
        <code key={scope} className="rounded border border-line bg-surface px-1 font-mono text-[11px] leading-[18px] text-ink-soft">
          {scope}
        </code>
      ))}
      {rest.length ? (
        <Tooltip content={<span className="font-mono">{rest.join(', ')}</span>}>
          <span tabIndex={0} className="rounded border border-line bg-well px-1 text-[11px] leading-[18px] font-medium text-muted">
            +{rest.length}
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}

/** Revoke (E59): immediate and idempotent. The reason is recorded but not returned. */
function RevokeKeyDialog({
  apiKey,
  open,
  onOpenChange,
}: {
  apiKey: ApiKey | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const workspace = useWorkspace();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    onOpenChange(false);
    window.setTimeout(() => {
      setReason('');
      setError(null);
    }, 200);
  };

  const revoke = useMutation({
    mutationFn: (target: ApiKey) => apiKeysApi.revoke(workspace.id, target.id, reason.trim() || undefined),
    onSuccess: (key) => {
      toast.success(`Revoked ${key.name}`, { description: 'Requests with this key are refused from now on.' });
      close();
    },
    onError: (err) => {
      if (hasCode(err, 'API_KEY_NOT_FOUND')) {
        toast.info('That key no longer exists', { description: 'The list has been refreshed.' });
        close();
        return;
      }
      setError(messageFor(err));
    },
    onSettled: () => void invalidateApiKeys(workspace.id),
  });

  const tooLong = reason.length > REASON_MAX;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      icon={<Ban />}
      tone="danger"
      size="md"
      title={`Revoke ${apiKey?.name ?? 'this key'}?`}
      description={
        <>
          Anything using <code className="font-mono text-[12px]">{apiKey?.prefix}…</code> stops working immediately. This
          can't be undone; create a new key if you need one.
        </>
      }
      confirmLabel="Revoke key"
      pending={revoke.isPending}
      confirmDisabled={tooLong}
      error={error}
      onConfirm={() => apiKey && revoke.mutate(apiKey)}
    >
      <Field
        label="Reason"
        optional
        error={tooLong ? `Use no more than ${REASON_MAX} characters.` : undefined}
        hint="Kept in the audit log."
      >
        <Textarea
          rows={2}
          className="min-h-16"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Rotated"
          disabled={revoke.isPending}
        />
      </Field>
    </ConfirmDialog>
  );
}
