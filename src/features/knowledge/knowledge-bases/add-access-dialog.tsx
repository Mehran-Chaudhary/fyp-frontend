import { useQuery } from '@tanstack/react-query';
import { Check, KeySquare, Search, ShieldAlert, UserPlus, UserRound, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Avatar, Skeleton } from '@/components/ui/misc';
import { RadioGroup } from '@/components/ui/radio-group';
import { Segmented } from '@/components/ui/segmented';
import { hasCode } from '@/lib/api/errors';
import type { AccessLevel, GrantSubjectType, KnowledgeBase, KnowledgeBaseGrant } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { ACCESS_LEVELS, atLeast, myLevelAfter } from '@/lib/knowledge/access';
import { apiKeyStatus } from '@/lib/workspace/status';
import { useDebouncedValue } from '@/lib/hooks';
import { apiKeysQuery, membersQuery, queryKeys, rolesQuery } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { RoleDot } from '@/features/team/member-bits';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { AccessLevelBadge } from '../shared/badges';
import { ACCESS_LEVEL_META } from '../shared/meta';
import { useKnowledgeAccess } from '../shared/use-knowledge-access';
import { useUpsertGrant } from './kb-mutations';

type Tab = 'roles' | 'members' | 'keys';

interface Subject {
  type: GrantSubjectType;
  /** A role id, a MEMBERSHIP id, or an API key id. */
  id: string;
  label: string;
}

const EXPLAIN: Readonly<Record<Tab, string>> = {
  roles: 'Everyone holding this role, now and later.',
  members: 'Only this person, whatever their roles.',
  keys: "Within its scopes, the key can list and read document details, upload, reindex and search. It can't read chunks or download, and never sees Restricted documents.",
};

/** "Add access" (§6.7): a subject from one of three lists, then a level. */
export function AddAccessDialog({
  open,
  onOpenChange,
  knowledgeBase,
  grants,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  knowledgeBase: KnowledgeBase;
  grants: readonly KnowledgeBaseGrant[];
  onChanged: () => void;
}) {
  const [session, setSession] = useState(0);
  const [busy, setBusy] = useState(false);
  const close = () => {
    onOpenChange(false);
    window.setTimeout(() => setSession((value) => value + 1), 200);
  };
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : !busy && close())}>
      <DialogContent size="xl">
        <Picker key={session} knowledgeBase={knowledgeBase} grants={grants} onClose={close} onBusyChange={setBusy} onChanged={onChanged} />
      </DialogContent>
    </Dialog>
  );
}

function Picker({
  knowledgeBase,
  grants,
  onClose,
  onBusyChange,
  onChanged,
}: {
  knowledgeBase: KnowledgeBase;
  grants: readonly KnowledgeBaseGrant[];
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onChanged: () => void;
}) {
  const workspace = useWorkspace();
  const can = useCan();
  const access = useKnowledgeAccess();
  const upsert = useUpsertGrant(knowledgeBase.id);

  const tabs: Array<{ value: Tab; label: string }> = [];
  if (can('role:read')) tabs.push({ value: 'roles', label: 'Roles' });
  if (can('member:read')) tabs.push({ value: 'members', label: 'Members' });
  if (can('apikey:read')) tabs.push({ value: 'keys', label: 'API keys' });

  const [tab, setTab] = useState<Tab>(tabs[0]?.value ?? 'roles');
  const [search, setSearch] = useState('');
  const [subject, setSubject] = useState<Subject | null>(null);
  const [level, setLevel] = useState<AccessLevel>('READ');
  const [error, setError] = useState<string | null>(null);

  const existing = subject ? grants.find((grant) => grant.subjectType === subject.type && grant.subjectId === subject.id) : undefined;
  const grantOf = (type: GrantSubjectType, id: string) => grants.find((grant) => grant.subjectType === type && grant.subjectId === id);

  const choose = (next: Subject) => {
    setSubject(next);
    setError(null);
    setLevel(grantOf(next.type, next.id)?.accessLevel ?? 'READ');
  };

  // The same self-lockout guard as the list, for your own member or role grant (§6.7).
  const mine =
    !!subject &&
    ((subject.type === 'MEMBER' && subject.id === access.membershipId) || (subject.type === 'ROLE' && access.roleIds.includes(subject.id)));
  const levelAfter =
    existing && mine && !access.isOwner
      ? myLevelAfter(grants, { membershipId: access.membershipId, roleIds: access.roleIds }, { grantId: existing.id, accessLevel: level })
      : 'MANAGE';
  const losesManage = !atLeast(levelAfter, 'MANAGE');

  const submit = () => {
    if (!subject) return;
    if (existing && existing.accessLevel === level) return onClose();
    setError(null);
    onBusyChange(true);
    upsert.mutate(
      { subjectType: subject.type, subjectId: subject.id, accessLevel: level },
      {
        onSuccess: () => {
          toast.success(
            existing
              ? `${subject.label} now has ${ACCESS_LEVEL_META[level].label} access`
              : `Granted ${subject.label} ${ACCESS_LEVEL_META[level].label} access`,
          );
          onChanged();
          onBusyChange(false);
          onClose();
        },
        onError: (err) => {
          onBusyChange(false);
          if (hasCode(err, 'RESOURCE_NOT_FOUND')) {
            // The role, member or key is gone (§6.7): say so and refresh the list it came from.
            setError(err.message || messageFor(err));
            setSubject(null);
            void queryClient.invalidateQueries({ queryKey: queryKeys.roles(workspace.id) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.members(workspace.id) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys(workspace.id) });
            return;
          }
          setError(messageFor(err));
        },
      },
    );
  };

  return (
    <form
      noValidate
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <DialogHeader
        icon={<UserPlus />}
        title={`Add access to ${knowledgeBase.name}`}
        description="Admit a role, a member or an API key. What they can do there still depends on their role permissions and clearance."
      />
      <DialogBody className="grid gap-4">
        {tabs.length === 0 ? (
          <Callout tone="neutral">
            Your role can't list roles, members or API keys, so there's nobody to pick from. Ask an administrator.
          </Callout>
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {tabs.length > 1 ? (
                <Segmented
                  aria-label="Grant to"
                  value={tab}
                  onValueChange={(next) => {
                    setTab(next);
                    setSearch('');
                  }}
                  options={tabs}
                />
              ) : null}
              <Input
                className="flex-1"
                leading={<Search />}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={tab === 'roles' ? 'Search roles' : tab === 'members' ? 'Search name or email' : 'Search keys'}
                aria-label="Search"
                inputClassName="h-9"
                trailing={
                  search ? (
                    <Button variant="ghost" size="icon-xs" className="text-faint" onClick={() => setSearch('')} aria-label="Clear search">
                      <X />
                    </Button>
                  ) : null
                }
              />
            </div>
            <p className="-mt-1 text-xs text-muted">{EXPLAIN[tab]}</p>
            <div className="scrollbar-thin max-h-64 overflow-y-auto rounded-lg border border-line" role="listbox" aria-label="Choose who to admit">
              {tab === 'roles' ? (
                <RoleList search={search} selected={subject} onChoose={choose} grantOf={grantOf} />
              ) : tab === 'members' ? (
                <MemberList search={search} selected={subject} onChoose={choose} grantOf={grantOf} myMembershipId={access.membershipId} />
              ) : (
                <KeyList search={search} selected={subject} onChoose={choose} grantOf={grantOf} />
              )}
            </div>
          </>
        )}

        {subject ? (
          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-[13px] font-medium text-ink-soft">
              {existing ? `Change ${subject.label}'s level` : `Level for ${subject.label}`}
            </legend>
            <RadioGroup
              aria-label="Access level"
              value={level}
              onValueChange={setLevel}
              variant="cards"
              options={ACCESS_LEVELS.map((value) => ({
                value,
                label: ACCESS_LEVEL_META[value].label,
                description: ACCESS_LEVEL_META[value].description,
              }))}
            />
          </fieldset>
        ) : null}

        {subject && losesManage ? (
          <Callout tone="warning" icon={<ShieldAlert className="size-4" />}>
            {levelAfter === null
              ? `You'll lose access to ${knowledgeBase.name} completely.`
              : `You'll lose the ability to manage ${knowledgeBase.name}.`}{' '}
            Only the workspace owner or another manager can give it back.
          </Callout>
        ) : null}
        <FormError message={error ?? undefined} />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={upsert.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={!subject} loading={upsert.isPending}>
          {existing ? (losesManage ? 'Change anyway' : 'Change level') : 'Grant access'}
        </Button>
      </DialogFooter>
    </form>
  );
}

interface ListProps {
  search: string;
  selected: Subject | null;
  onChoose: (subject: Subject) => void;
  grantOf: (type: GrantSubjectType, id: string) => KnowledgeBaseGrant | undefined;
}

function RoleList({ search, selected, onChoose, grantOf }: ListProps) {
  const workspace = useWorkspace();
  const roles = useQuery(rolesQuery(workspace.id));
  if (roles.isPending) return <ListSkeleton />;
  if (roles.isError) return <ErrorState compact error={roles.error} onRetry={() => void roles.refetch()} retrying={roles.isFetching} />;
  const term = search.trim().toLowerCase();
  // The owner sees every knowledge base anyway: a grant to the Owner role would do nothing.
  const shown = roles.data.filter((role) => role.slug !== 'owner' && (!term || role.name.toLowerCase().includes(term)));
  if (shown.length === 0) return <ListEmpty>No roles match.</ListEmpty>;
  return (
    <ul className="divide-y divide-line/70">
      {shown.map((role) => (
        <Row
          key={role.id}
          selected={selected?.type === 'ROLE' && selected.id === role.id}
          grant={grantOf('ROLE', role.id)}
          onClick={() => onChoose({ type: 'ROLE', id: role.id, label: role.name })}
          leading={
            <span className="inline-flex size-8 items-center justify-center rounded-lg border border-line bg-well">
              <RoleDot color={role.color} className="size-2.5" />
            </span>
          }
          title={role.name}
          detail={role.description ?? (role.isSystem ? 'Built-in role' : 'Custom role')}
        />
      ))}
    </ul>
  );
}

function MemberList({ search, selected, onChoose, grantOf, myMembershipId }: ListProps & { myMembershipId: string }) {
  const workspace = useWorkspace();
  const term = useDebouncedValue(search.trim(), 300);
  // Active members only; the grant takes the MEMBERSHIP id, never the user id (§3.2).
  const members = useQuery(membersQuery(workspace.id, { status: 'ACTIVE', limit: 50, ...(term ? { search: term } : {}), sortBy: 'name', sortDirection: 'ASC' }));
  if (members.isPending) return <ListSkeleton avatar />;
  if (members.isError) return <ErrorState compact error={members.error} onRetry={() => void members.refetch()} retrying={members.isFetching} />;
  if (members.data.items.length === 0) return <ListEmpty>{term ? 'Nobody matches.' : 'No active members.'}</ListEmpty>;
  return (
    <ul className={cn('divide-y divide-line/70', members.isPlaceholderData && 'opacity-60')}>
      {members.data.items.map((member) => (
        <Row
          key={member.id}
          selected={selected?.type === 'MEMBER' && selected.id === member.id}
          grant={grantOf('MEMBER', member.id)}
          onClick={() => onChoose({ type: 'MEMBER', id: member.id, label: member.displayName })}
          leading={<Avatar name={member.displayName} src={member.avatarUrl} size="md" />}
          title={
            <>
              {member.displayName}
              {member.id === myMembershipId ? (
                <span className="ml-1.5 rounded border border-line bg-well px-1 text-[10.5px] leading-4 font-medium text-muted">You</span>
              ) : null}
            </>
          }
          detail={member.email}
        />
      ))}
      {members.data.pagination.hasNextPage ? (
        <li className="px-3.5 py-2 text-xs text-muted">Showing the first 50. Search to find someone else.</li>
      ) : null}
    </ul>
  );
}

function KeyList({ search, selected, onChoose, grantOf }: ListProps) {
  const workspace = useWorkspace();
  const keys = useQuery(apiKeysQuery(workspace.id));
  if (keys.isPending) return <ListSkeleton />;
  if (keys.isError) return <ErrorState compact error={keys.error} onRetry={() => void keys.refetch()} retrying={keys.isFetching} />;
  const term = search.trim().toLowerCase();
  // Active keys only: a revoked or expired key can't use a grant (§6.7).
  const shown = keys.data.filter(
    (key) => apiKeyStatus(key, keys.dataUpdatedAt) === 'active' && (!term || key.name.toLowerCase().includes(term) || key.prefix.toLowerCase().includes(term)),
  );
  if (shown.length === 0) return <ListEmpty>{term ? 'No active keys match.' : 'No active API keys.'}</ListEmpty>;
  return (
    <ul className="divide-y divide-line/70">
      {shown.map((key) => (
        <Row
          key={key.id}
          selected={selected?.type === 'API_KEY' && selected.id === key.id}
          grant={grantOf('API_KEY', key.id)}
          onClick={() => onChoose({ type: 'API_KEY', id: key.id, label: `${key.name} (${key.prefix})` })}
          leading={
            <span className="inline-flex size-8 items-center justify-center rounded-lg border border-line bg-well text-ink-soft">
              <KeySquare className="size-4" aria-hidden />
            </span>
          }
          title={key.name}
          detail={
            <>
              <code className="font-mono text-[11px]">{key.prefix}…</code> · {key.scopes.length} scope{key.scopes.length === 1 ? '' : 's'}
            </>
          }
        />
      ))}
    </ul>
  );
}

function Row({
  selected,
  grant,
  onClick,
  leading,
  title,
  detail,
}: {
  selected: boolean;
  grant: KnowledgeBaseGrant | undefined;
  onClick: () => void;
  leading: ReactNode;
  title: ReactNode;
  detail: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={selected}
        onClick={onClick}
        className={cn(
          'flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors',
          selected ? 'bg-brand-50' : 'hover:bg-well/60',
        )}
      >
        {leading}
        <span className="min-w-0 flex-1">
          <span className="flex items-center truncate text-[13px] font-medium text-ink">{title}</span>
          <span className="block truncate text-xs text-muted">{detail}</span>
        </span>
        {grant ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
            Has <AccessLevelBadge level={grant.accessLevel} />
          </span>
        ) : null}
        <span
          className={cn(
            'inline-flex size-5 shrink-0 items-center justify-center rounded-full border',
            selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong bg-surface text-transparent',
          )}
          aria-hidden
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
      </button>
    </li>
  );
}

function ListSkeleton({ avatar }: { avatar?: boolean }) {
  return (
    <div className="divide-y divide-line/70">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="flex items-center gap-3 px-3.5 py-2.5">
          <Skeleton className={avatar ? 'size-8 rounded-full' : 'size-8 rounded-lg'} />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3 w-52" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ListEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 px-3.5 py-6 text-[13px] text-muted">
      <UserRound className="size-4 text-faint" aria-hidden />
      {children}
    </p>
  );
}
