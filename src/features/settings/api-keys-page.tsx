import { useMutation, useQuery } from '@tanstack/react-query';
import { Ban, KeyRound, KeySquare, Plus, RefreshCw, Search, X } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { OutcomeUnknown } from '@/components/feedback/outcome-unknown';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { RelativeTime } from '@/components/ui/relative-time';
import { Segmented } from '@/components/ui/segmented';
import { Table, TableMessage, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { useDialogTarget } from '@/components/ui/use-dialog-target';
import { apiKeysApi } from '@/lib/api/endpoints';
import { hasCode, isOutcomeUnknown } from '@/lib/api/errors';
import type { ApiKey, CreatedApiKey } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { apiKeysQuery, memberNamesQuery, meQuery, queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast } from '@/lib/toast';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import { invalidateApiKeys } from '@/lib/workspace/cache';
import { apiKeyStatus, filterApiKeys, formatUsageCount, type ApiKeyStatus, type ApiKeyStatusFilter } from '@/lib/workspace/api-keys';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { ApiKeySecretDialog } from './api-key-secret-dialog';
import { CreateApiKeyDialog, type UncertainCreation } from './create-api-key-dialog';

const STATUS: Record<ApiKeyStatus, { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  active: { label: 'Active', tone: 'success' },
  expired: { label: 'Expired', tone: 'warning' },
  revoked: { label: 'Revoked', tone: 'neutral' },
};

const FILTERS: ApiKeyStatusFilter[] = ['all', 'active', 'expired', 'revoked'];
const COLUMNS = 9;
const REASON_MAX = 255;

/** Settings → API keys (spec §4 `/settings/api-keys`, P2-API-27–30). */
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
  const statusParam = params.get('status') as ApiKeyStatusFilter | null;
  const status: ApiKeyStatusFilter = statusParam && FILTERS.includes(statusParam) ? statusParam : 'all';
  const creator = params.get('creator');
  const [search, setSearch] = useState('');

  const keys = useQuery(apiKeysQuery(workspace.id));
  // Keys only carry the creator's user id; names come from the directory when you may read it.
  const names = useQuery({ ...memberNamesQuery(workspace.id), enabled: can('member:read') });

  const [createOpen, setCreateOpen] = useState(false);
  // The one-time secret: component state only, never a cache, store, URL or log (spec P2-API-29).
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [lost, setLost] = useState<UncertainCreation | null>(null);
  const revokeDialog = useDialogTarget<ApiKey>();

  const setParam = (key: string, value: string | null) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true, preventScrollReset: true },
    );

  const creatorLabel = (userId: string): { text: string; full?: string } => {
    if (userId === me?.id) return { text: 'You' };
    const known = names.data?.get(userId);
    if (known) return { text: known.removed ? `${known.name} (removed)` : known.name };
    return { text: `User ${userId.slice(0, 8)}`, full: userId };
  };

  // Judged at fetch time (pure), refreshed with the list.
  const now = keys.dataUpdatedAt;
  const all = keys.data ?? [];
  const visible = filterApiKeys(all, { status, creatorId: creator, search }, now);
  const counts = Object.fromEntries(FILTERS.map((filter) => [filter, filterApiKeys(all, { status: filter, creatorId: creator }, now).length]));
  const filtered = status !== 'all' || !!creator || !!search.trim();

  // Keys that could be the one whose creation answer was lost.
  const orphans = lost
    ? all.filter((key) => key.name === lost.name && !key.revokedAt && Date.parse(key.createdAt) >= lost.sentAt - 60_000)
    : [];

  return (
    <div className="grid gap-6">
      {lost ? (
        <OutcomeUnknown
          title={`We couldn't confirm whether “${lost.name}” was created`}
          error={lost.error}
          action={
            <div className="flex flex-wrap gap-2">
              <Button size="xs" variant="secondary" loading={keys.isFetching} onClick={() => void keys.refetch()}>
                {keys.isFetching ? null : <RefreshCw />}
                Check the list again
              </Button>
              {orphans.length && can('apikey:revoke') ? (
                <Button size="xs" variant="secondary" onClick={() => revokeDialog.show(orphans[0])}>
                  <Ban />
                  Revoke {orphans[0].prefix}…
                </Button>
              ) : null}
              <Button size="xs" variant="ghost" onClick={() => setLost(null)}>
                Dismiss
              </Button>
            </div>
          }
        >
          {orphans.length ? (
            <>
              A key named “{lost.name}” ({orphans.map((key) => `${key.prefix}…`).join(', ')}) was created, but its secret
              never reached this page and can't be shown again. Revoke it, then create a replacement. Nothing was retried
              automatically.
            </>
          ) : (
            <>
              No new key named “{lost.name}” is in the list, so it most likely wasn't created. Check again in a moment, then
              create it if it's still missing. Nothing was retried automatically.
            </>
          )}
        </OutcomeUnknown>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader
          icon={<KeySquare />}
          title="API keys"
          description="Keys let services call this workspace's API with a fixed set of scopes. A key is bound to this workspace, and can never do more than its scopes."
          actions={
            can('apikey:create') ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus />
                Create key
              </Button>
            ) : null
          }
        />
        <div className="flex flex-col gap-2.5 border-t border-line p-3 sm:px-4 lg:flex-row lg:items-center">
          <Input
            className="w-full lg:w-64"
            inputClassName="h-9"
            leading={<Search />}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, prefix or description"
            aria-label="Filter keys"
            trailing={
              search ? (
                <Button variant="ghost" size="icon-xs" className="text-faint" onClick={() => setSearch('')} aria-label="Clear filter">
                  <X />
                </Button>
              ) : null
            }
          />
          <Segmented
            aria-label="Status"
            value={status}
            onValueChange={(value) => setParam('status', value === 'all' ? null : value)}
            options={FILTERS.map((filter) => ({
              value: filter,
              label: filter === 'all' ? 'All' : STATUS[filter].label,
              count: counts[filter],
            }))}
          />
          {creator ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-line bg-well px-2 py-1 text-xs text-ink-soft">
              Created by {creatorLabel(creator).text}
              <button
                type="button"
                className="rounded-sm text-faint hover:text-ink"
                onClick={() => setParam('creator', null)}
                aria-label="Show keys from every creator"
              >
                <X className="size-3.5" />
              </button>
            </span>
          ) : null}
          <Tooltip content="Refresh">
            <Button variant="ghost" size="icon-sm" className="text-muted lg:ml-auto" onClick={() => void keys.refetch()} aria-label="Refresh the key list">
              <RefreshCw className={cn(keys.isFetching && !keys.isPending && 'animate-spin')} />
            </Button>
          </Tooltip>
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
            ) : keys.isError && !keys.data ? (
              <TableMessage colSpan={COLUMNS}>
                <ErrorState error={keys.error} title="We couldn't load the API keys" onRetry={() => void keys.refetch()} retrying={keys.isFetching} />
              </TableMessage>
            ) : visible.length === 0 ? (
              <TableMessage colSpan={COLUMNS}>
                {filtered && all.length ? (
                  <EmptyState
                    icon={<Search />}
                    title="No keys match"
                    description="Try another status or clear the filters."
                    action={
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setSearch('');
                          setParams(new URLSearchParams(), { replace: true, preventScrollReset: true });
                        }}
                      >
                        Clear filters
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    icon={<KeyRound />}
                    title="No API keys yet"
                    description={
                      can('apikey:create')
                        ? 'Create a key for a service or an integration. Give it only the scopes it needs.'
                        : 'Nobody has created a key in this workspace.'
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
                )}
              </TableMessage>
            ) : (
              visible.map((key) => {
                const keyStatus = apiKeyStatus(key, now);
                const revoked = keyStatus === 'revoked';
                const by = creatorLabel(key.createdById);
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
                            Pinned to {key.allowedIps.length === 1 ? key.allowedIps[0] : `${key.allowedIps.length} networks`}
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
                      <Badge tone={STATUS[keyStatus].tone} dot>
                        {STATUS[keyStatus].label}
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
                          <span tabIndex={0} className={cn('rounded-sm whitespace-nowrap', keyStatus === 'expired' && 'text-warning-700')}>
                            {formatDate(key.expiresAt)}
                          </span>
                        </Tooltip>
                      ) : (
                        'No expiry'
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
                    <TD className="hidden text-right font-mono text-[12.5px] xl:table-cell tabular">{formatUsageCount(key.usageCount)}</TD>
                    <TD className="hidden max-w-[10rem] truncate xl:table-cell">
                      {by.full ? (
                        <Tooltip content={<span className="font-mono">{by.full}</span>}>
                          <span tabIndex={0} className="rounded-sm font-mono text-xs">
                            {by.text}
                          </span>
                        </Tooltip>
                      ) : (
                        by.text
                      )}
                    </TD>
                    <TD className="text-right">
                      {!revoked && can('apikey:revoke') ? (
                        <Tooltip content="Revoke">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-faint hover:text-danger-600"
                            onClick={() => revokeDialog.show(key)}
                            aria-label={`Revoke ${key.name} (${key.prefix}…)`}
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
        <p className="border-t border-line bg-well/40 px-5 py-3 text-xs leading-relaxed text-muted sm:px-6">
          Filters apply in your browser to the complete list. Keys go in the{' '}
          <code className="font-mono text-[11.5px] text-ink-soft">X-API-Key</code> header. To rotate one: create a new key,
          switch the service over and check it works, then revoke the old key. Removing a member revokes the keys they
          created; suspending them or changing their roles does not.
        </p>
      </Card>

      <CreateApiKeyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(next) => {
          setLost(null);
          setCreated(next);
        }}
        onUncertain={(attempt) => {
          setLost(attempt);
          void invalidateApiKeys(workspace.id);
        }}
      />
      <ApiKeySecretDialog created={created} onDone={() => setCreated(null)} />
      <RevokeKeyDialog
        apiKey={revokeDialog.target}
        open={revokeDialog.open}
        onOpenChange={revokeDialog.onOpenChange}
        onRevoked={(key) => {
          if (lost && key.name === lost.name) setLost(null);
        }}
      />
    </div>
  );
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

/**
 * Revoke (P2-API-30): immediate, no undo, and repeating it is harmless. The
 * optional reason travels in the DELETE body and is not returned afterwards.
 */
function RevokeKeyDialog({
  apiKey,
  open,
  onOpenChange,
  onRevoked,
}: {
  apiKey: ApiKey | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRevoked: (key: ApiKey) => void;
}) {
  const workspace = useWorkspace();
  const workspaceId = workspace.id;
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
    mutationFn: (target: ApiKey) => apiKeysApi.revoke(workspaceId, target.id, reason.trim() || undefined),
    onSuccess: (key) => {
      // Metadata only: the server's copy replaces ours.
      queryClient.setQueryData<ApiKey[]>(queryKeys.apiKeys(workspaceId), (current) =>
        current?.map((candidate) => (candidate.id === key.id ? key : candidate)),
      );
      toast.success(`Revoked ${key.name}`, { description: `Requests with ${key.prefix}… are refused from now on.` });
      onRevoked(key);
      close();
    },
    onError: (err) => {
      if (hasCode(err, 'API_KEY_NOT_FOUND')) {
        toast.info('That key no longer exists', { description: 'The list has been refreshed.' });
        close();
        return;
      }
      if (isOutcomeUnknown(err)) {
        // Treat it as possibly applied: the refreshed list shows the truth, and revoking again is harmless.
        setError("We couldn't confirm the revocation. The list is being refreshed; if the key still shows as active, revoke it again.");
        return;
      }
      setError(messageFor(err));
    },
    onSettled: () => void invalidateApiKeys(workspaceId),
  });

  const tooLong = reason.length > REASON_MAX;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      icon={<Ban />}
      tone="danger"
      size="md"
      title={`Revoke “${apiKey?.name ?? 'this key'}”?`}
      description={
        <>
          Every service using <code className="font-mono text-[12px]">{apiKey?.prefix}…</code> is refused from its next
          request. There's no undo or reactivation: a replacement is a new key with a new secret.
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
        hint="Recorded in the audit log; not shown here afterwards."
      >
        <Textarea
          rows={2}
          className="min-h-16"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Rotated after deployment update"
          disabled={revoke.isPending}
        />
      </Field>
    </ConfirmDialog>
  );
}
