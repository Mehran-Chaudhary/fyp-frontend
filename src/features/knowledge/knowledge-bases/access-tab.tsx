import { useQuery } from '@tanstack/react-query';
import { Info, KeyRound, KeySquare, Lock, ShieldAlert, ShieldCheck, UserPlus, UserRound, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/misc';
import { RelativeTime } from '@/components/ui/relative-time';
import { Select } from '@/components/ui/select';
import { Table, TableMessage, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { hasCode, isOutcomeUnknown } from '@/lib/api/errors';
import type { AccessLevel, KnowledgeBase, KnowledgeBaseGrant } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { ACCESS_LEVELS, affectsOwnAccess, atLeast, myLevelAfter } from '@/lib/knowledge/access';
import { knowledgeBaseGrantsQuery, queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast, toastError } from '@/lib/toast';
import { formatDateTime } from '@/lib/utils';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { AccessLevelBadge } from '../shared/badges';
import { ACCESS_LEVEL_META } from '../shared/meta';
import { useKnowledgeAccess } from '../shared/use-knowledge-access';
import { AddAccessDialog } from './add-access-dialog';
import { grantLabel, useRecheckOwnAccess } from './grant-helpers';
import { useKnowledgeBaseContext } from './kb-context';
import { useRevokeGrant, useUpsertGrant } from './kb-mutations';

/** The Access tab (spec §5 "Access tab", P3-API-06/07/08): who, besides the owner, can see a restricted base. */
export function KnowledgeBaseAccessTab() {
  const { knowledgeBase } = useKnowledgeBaseContext();
  const workspace = useWorkspace();
  const access = useKnowledgeAccess();

  if (access.lacks('viewGrants')) {
    return (
      <Card>
        <NoAccessState permissions={['knowledgebase:read']} workspaceName={workspace.name} />
      </Card>
    );
  }
  if (!access.can('viewGrants', knowledgeBase)) {
    return (
      <Card>
        <EmptyState
          icon={<ShieldCheck />}
          title="Only its managers can see who has access"
          description={`You have ${ACCESS_LEVEL_META[knowledgeBase.access].label} access to ${knowledgeBase.name}. Seeing and changing its grants needs Manage.`}
        />
      </Card>
    );
  }
  return <Grants knowledgeBase={knowledgeBase} />;
}

type Pending =
  | { kind: 'remove'; grant: KnowledgeBaseGrant; after: AccessLevel | null }
  | { kind: 'lower'; grant: KnowledgeBaseGrant; level: AccessLevel; after: AccessLevel | null };

function Grants({ knowledgeBase }: { knowledgeBase: KnowledgeBase }) {
  const workspace = useWorkspace();
  const access = useKnowledgeAccess();
  const navigate = useNavigate();
  const grants = useQuery(knowledgeBaseGrantsQuery(workspace.id, knowledgeBase.id));
  const upsert = useUpsertGrant(knowledgeBase.id);
  const revoke = useRevokeGrant(knowledgeBase.id);
  const recheck = useRecheckOwnAccess(knowledgeBase);
  const canManage = access.can('manageGrants', knowledgeBase);
  const restricted = knowledgeBase.accessMode === 'RESTRICTED';
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);

  const me = { membershipId: access.membershipId, roleIds: access.roleIds, isOwner: access.isOwner };
  const isMine = (grant: KnowledgeBaseGrant) => affectsOwnAccess(grant, { ...me, isOwner: false });
  // Only a restricted base can lock you out: an open one puts everyone at Manage (spec §3.2).
  const guards = (grant: KnowledgeBaseGrant) => restricted && affectsOwnAccess(grant, me);
  const list = grants.data ?? [];

  /** The refusals of spec §8 P3-API-06/07/08; some mean this page is stale. */
  const handle = (err: unknown, fallbackTitle: string) => {
    if (hasCode(err, 'KNOWLEDGE_BASE_NOT_FOUND')) {
      toast.info(`${knowledgeBase.name} doesn't exist or you don't have access to it any more`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBases(workspace.id) });
      void navigate(`/w/${workspace.slug}/knowledge-bases`);
      return;
    }
    if (hasCode(err, 'KNOWLEDGE_BASE_ACCESS_DENIED')) {
      toast.info(`You're no longer a manager of ${knowledgeBase.name}`, { description: 'The page has been refreshed.' });
      void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBaseDetail(workspace.id, knowledgeBase.id) });
      return;
    }
    if (hasCode(err, 'KNOWLEDGE_BASE_GRANT_NOT_FOUND')) {
      toast.info('That access was already removed', { description: 'The list has been refreshed.' });
      return;
    }
    if (isOutcomeUnknown(err)) {
      // Never replayed (spec §2): the list was re-read, so it shows what really happened.
      toast.warning("We couldn't confirm the change", { description: 'The list has been re-read. Check it before trying again.' });
      return;
    }
    toastError(err, fallbackTitle);
  };

  const applyLevel = (grant: KnowledgeBaseGrant, level: AccessLevel, done?: () => void) =>
    upsert.mutate(
      { subjectType: grant.subjectType, subjectId: grant.subjectId, accessLevel: level },
      {
        onSuccess: () => {
          toast.success(`${grantLabel(grant)} now has ${ACCESS_LEVEL_META[level].label} access`);
          done?.();
          if (guards(grant)) void recheck();
        },
        onError: (err) => {
          if (done && !hasCode(err, 'KNOWLEDGE_BASE_NOT_FOUND', 'KNOWLEDGE_BASE_ACCESS_DENIED') && !isOutcomeUnknown(err)) {
            setError(messageFor(err));
            return;
          }
          done?.();
          handle(err, "Couldn't change the access");
        },
      },
    );

  const setLevel = (grant: KnowledgeBaseGrant, level: AccessLevel) => {
    if (level === grant.accessLevel) return;
    // Self-lockout guard (spec §5, P3-G07): warn before lowering your own access below Manage.
    const after = myLevelAfter(list, me, { grantId: grant.id, accessLevel: level });
    if (guards(grant) && !atLeast(after, 'MANAGE')) {
      setError(null);
      setPending({ kind: 'lower', grant, level, after });
      return;
    }
    applyLevel(grant, level);
  };

  const askRemove = (grant: KnowledgeBaseGrant) => {
    setError(null);
    setPending({ kind: 'remove', grant, after: guards(grant) ? myLevelAfter(list, me, { removeGrantId: grant.id }) : 'MANAGE' });
  };

  const confirm = () => {
    if (!pending) return;
    const done = () => setPending(null);
    if (pending.kind === 'lower') {
      applyLevel(pending.grant, pending.level, done);
      return;
    }
    const grant = pending.grant;
    revoke.mutate(grant.id, {
      onSuccess: () => {
        toast.success(`Removed ${grantLabel(grant)}'s access`);
        done();
        if (guards(grant)) void recheck();
      },
      onError: (err) => {
        if (hasCode(err, 'KNOWLEDGE_BASE_GRANT_NOT_FOUND', 'KNOWLEDGE_BASE_NOT_FOUND', 'KNOWLEDGE_BASE_ACCESS_DENIED') || isOutcomeUnknown(err)) {
          done();
          handle(err, "Couldn't remove the access");
          return;
        }
        setError(messageFor(err));
      },
    });
  };

  const lockout = pending && pending.after !== 'MANAGE' ? lockoutWarning(knowledgeBase.name, pending.after) : null;

  return (
    <>
      {!restricted ? (
        <Callout
          tone="info"
          icon={<Info className="size-4" />}
          title="Grants take effect only while this base is Restricted"
          action={
            access.can('editKnowledgeBase', knowledgeBase) ? (
              <Button asChild variant="secondary" size="xs">
                <Link to={`/w/${workspace.slug}/knowledge-bases/${knowledgeBase.id}`}>
                  <Lock />
                  Change access mode
                </Link>
              </Button>
            ) : null
          }
        >
          {knowledgeBase.name} is open to everyone with document permissions, at Manage level. Grants added here are kept, and apply as
          soon as it's switched to Restricted, so you can prepare them in advance.
        </Callout>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader
          icon={<ShieldCheck />}
          title="Who can access this knowledge base"
          description={
            <>
              Grants admit roles, members or API keys at a level: Read, Write or Manage. Role permissions still decide what each of them
              may do, and clearance decides which documents they see.
              {access.isOwner ? ' As the owner, you see every knowledge base without a grant.' : null}
            </>
          }
          actions={
            canManage ? (
              <Button onClick={() => setAdding(true)}>
                <UserPlus />
                Add access
              </Button>
            ) : null
          }
        />
        <Table className="border-t border-line">
          <THead>
            <tr>
              <TH>Who</TH>
              <TH>Level</TH>
              <TH className="hidden md:table-cell">Granted</TH>
              <TH className="w-12">
                <span className="sr-only">Remove</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {grants.isPending ? (
              Array.from({ length: 3 }, (_, index) => (
                <tr key={index}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <Skeleton className="size-8 rounded-lg" />
                      <Skeleton className="h-3.5 w-40" />
                    </div>
                  </TD>
                  <TD>
                    <Skeleton className="h-8 w-28" />
                  </TD>
                  <TD className="hidden md:table-cell">
                    <Skeleton className="h-3 w-20" />
                  </TD>
                  <TD />
                </tr>
              ))
            ) : grants.isError ? (
              <TableMessage colSpan={4}>
                <ErrorState error={grants.error} title="We couldn't load who has access" onRetry={() => void grants.refetch()} retrying={grants.isFetching} />
              </TableMessage>
            ) : list.length === 0 ? (
              <TableMessage colSpan={4}>
                <EmptyState
                  icon={<Lock />}
                  title="Nobody has been granted access"
                  description={
                    restricted
                      ? 'Only the workspace owner can see this knowledge base until someone is granted access.'
                      : 'Add grants now if you plan to restrict this knowledge base later.'
                  }
                  action={
                    canManage ? (
                      <Button size="sm" onClick={() => setAdding(true)}>
                        <UserPlus />
                        Add access
                      </Button>
                    ) : null
                  }
                />
              </TableMessage>
            ) : (
              list.map((grant) => (
                <TR key={grant.id}>
                  <TD className="max-w-[20rem]">
                    <Subject grant={grant} mine={isMine(grant)} memberIsMe={grant.subjectType === 'MEMBER' && grant.subjectId === me.membershipId} />
                  </TD>
                  <TD>
                    {canManage ? (
                      <Select
                        size="sm"
                        aria-label={`Access level for ${grantLabel(grant)}`}
                        value={grant.accessLevel}
                        onValueChange={(level) => setLevel(grant, level)}
                        disabled={upsert.isPending && upsert.variables?.subjectId === grant.subjectId}
                        options={ACCESS_LEVELS.map((level) => ({
                          value: level,
                          label: ACCESS_LEVEL_META[level].label,
                          description: ACCESS_LEVEL_META[level].description,
                        }))}
                        className="w-32"
                        contentClassName="w-80"
                      />
                    ) : (
                      <AccessLevelBadge level={grant.accessLevel} />
                    )}
                  </TD>
                  <TD className="hidden text-muted md:table-cell">
                    <span title={formatDateTime(grant.createdAt)}>
                      <RelativeTime value={grant.createdAt} />
                    </span>
                  </TD>
                  <TD className="text-right">
                    {canManage ? (
                      <Tooltip content="Remove access">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-faint hover:text-danger-600"
                          onClick={() => askRemove(grant)}
                          aria-label={`Remove ${grantLabel(grant)}'s access`}
                        >
                          <X />
                        </Button>
                      </Tooltip>
                    ) : null}
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
        <p className="border-t border-line px-5 py-2.5 text-xs text-muted sm:px-6">
          Changes take effect on the next request. A grant whose role, member or key is gone stops working and leaves this list.
          {canManage ? ' Anyone with Manage can grant Manage, including to others.' : null}
        </p>
      </Card>

      {canManage ? (
        <AddAccessDialog
          open={adding}
          onOpenChange={setAdding}
          knowledgeBase={knowledgeBase}
          grants={list}
          onChanged={() => void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBaseGrants(workspace.id, knowledgeBase.id) })}
        />
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => (open ? undefined : setPending(null))}
        icon={lockout ? <ShieldAlert /> : <X />}
        tone={lockout ? 'warning' : 'danger'}
        size="md"
        title={
          pending?.kind === 'lower'
            ? `Lower ${grantLabel(pending.grant)} to ${ACCESS_LEVEL_META[pending.level].label}?`
            : `Remove ${pending ? grantLabel(pending.grant) : ''}'s access?`
        }
        description={
          pending?.kind === 'remove'
            ? restricted
              ? `${grantLabel(pending.grant)} loses access to ${knowledgeBase.name} on their next request${pending.grant.subjectType === 'ROLE' ? ', unless another grant admits them' : ''}.`
              : `The grant is removed. It had no effect while ${knowledgeBase.name} is open to the workspace.`
            : 'The new level applies on the next request.'
        }
        confirmLabel={pending?.kind === 'lower' ? 'Lower access' : 'Remove access'}
        confirmVariant={pending?.kind === 'lower' ? 'primary' : 'danger'}
        pending={upsert.isPending || revoke.isPending}
        error={error}
        onConfirm={confirm}
      >
        {lockout ? <Callout tone="warning">{lockout}</Callout> : null}
      </ConfirmDialog>
    </>
  );
}

/** Spec §5's self-lockout warning: "You will lose {level} access to this base immediately." */
function lockoutWarning(name: string, after: AccessLevel | null): ReactNode {
  if (after === null) {
    return <>You will lose all access to {name} immediately. Only the workspace owner or another manager can give it back.</>;
  }
  return (
    <>
      You will lose Manage access to {name} immediately and keep only {ACCESS_LEVEL_META[after].label}. Only the workspace owner or
      another manager can give it back.
    </>
  );
}

const SUBJECT = {
  ROLE: { icon: KeyRound, caption: 'Role · everyone holding it' },
  MEMBER: { icon: UserRound, caption: 'Member' },
  API_KEY: { icon: KeySquare, caption: 'API key' },
} as const;

function Subject({ grant, mine, memberIsMe }: { grant: KnowledgeBaseGrant; mine: boolean; memberIsMe: boolean }) {
  const { icon: Icon, caption } = SUBJECT[grant.subjectType];
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-well text-ink-soft">
        <Icon className="size-4" aria-hidden />
        <span className="sr-only">{caption}</span>
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium text-ink">{grantLabel(grant)}</span>
          {mine ? (
            <span className="shrink-0 rounded border border-line bg-well px-1 text-[10.5px] leading-4 font-medium text-muted">
              {memberIsMe ? 'You' : 'Your role'}
            </span>
          ) : null}
        </span>
        <span className="block truncate text-xs text-muted">{caption}</span>
      </span>
    </span>
  );
}
