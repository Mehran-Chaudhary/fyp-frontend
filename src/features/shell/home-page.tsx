import { useQuery } from '@tanstack/react-query';
import {
  Bot,
  Check,
  ChevronDown,
  Crown,
  Database,
  GitBranch,
  MailCheck,
  ShieldCheck,
  TriangleAlert,
  UserPlus,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ErrorState } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { authApi } from '@/lib/api/endpoints';
import { hasCode } from '@/lib/api/errors';
import type { PermissionDefinition } from '@/lib/api/types';
import { formatBytes, sumBytes } from '@/lib/knowledge/files';
import { useDocumentTitle } from '@/lib/hooks';
import { meQuery, mfaQuery, permissionCatalogueQuery, workspaceDetailsQuery } from '@/lib/queries';
import { toast, toastError } from '@/lib/toast';
import { cn, formatDate, formatRelative, pluralize } from '@/lib/utils';
import { useKnowledgeBases } from '@/features/knowledge/shared/use-knowledge-access';
import { primaryRoleLabel, useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { PERMISSION_CATEGORY_LABELS } from './nav';

/** Workspace home for Phase 1: welcome, getting started, membership, access (spec §7.10). */
export function HomePage() {
  const workspace = useWorkspace();
  const { data: me } = useQuery(meQuery);
  useDocumentTitle(workspace.name);

  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Working late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="grid gap-8">
      <header className="animate-rise">
        <p className="text-[13px] text-muted">
          {greeting} · {workspace.name} · <span className="text-ink-soft">{primaryRoleLabel(workspace.membership)}</span>
        </p>
        <h1 className="mt-2 font-display text-[40px] leading-[1.05] tracking-[-0.01em] text-ink sm:text-[46px]">
          Welcome, {me?.displayName ?? workspace.membership.displayName}.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          This is your workspace's command center. Your team, roles, security policy and document vault are ready to set up;
          agents and workflows arrive in the coming phases.
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <GettingStarted />
        <div className="grid gap-6">
          <VaultCard />
          <MembershipCard />
          <WorkspaceCard />
        </div>
      </div>

      <AccessCard />
    </div>
  );
}

// ── Getting started ─────────────────────────────────────────────────────────

interface ChecklistItem {
  key: string;
  icon: ReactNode;
  title: string;
  description: string;
  state: 'done' | 'todo' | 'soon' | 'loading';
  action?: ReactNode;
  phase?: number;
}

function GettingStarted() {
  const workspace = useWorkspace();
  const can = useCan();
  const { data: me } = useQuery(meQuery);
  const mfa = useQuery(mfaQuery);
  const details = useQuery({ ...workspaceDetailsQuery(workspace.id), enabled: can('workspace:read') });
  const knowledgeBases = useKnowledgeBases();
  const [sending, setSending] = useState(false);
  const hasTeam = (details.data?.memberCount ?? 0) > 1;
  const canInvite = can('member:invite');
  const seesVault = can('knowledgebase:read');
  const hasDocuments = knowledgeBases.list.some((knowledgeBase) => knowledgeBase.stats.documents > 0);

  const resend = async () => {
    if (!me) return;
    setSending(true);
    try {
      await authApi.resendVerification(me.email);
      toast.success('Verification email sent', { description: `Check ${me.email}.` });
    } catch (error) {
      if (hasCode(error, 'RATE_LIMIT_EXCEEDED')) toast.warning('Too many emails', { description: 'Try again later.' });
      else toastError(error, "Couldn't send the email");
    } finally {
      setSending(false);
    }
  };

  const items: ChecklistItem[] = [
    {
      key: 'verify',
      icon: <MailCheck />,
      title: 'Verify your email address',
      description: 'Confirms the address is yours and activates your account.',
      state: me?.emailVerified ? 'done' : 'todo',
      action: me?.emailVerified ? null : (
        <Button variant="secondary" size="sm" loading={sending} onClick={() => void resend()}>
          Resend link
        </Button>
      ),
    },
    {
      key: 'mfa',
      icon: <ShieldCheck />,
      title: 'Turn on two-step verification',
      description: 'An authenticator code on top of your password. Some workspaces require it.',
      state: mfa.isPending ? 'loading' : mfa.data?.enabled ? 'done' : 'todo',
      action: mfa.data?.enabled ? null : (
        <Button asChild variant="secondary" size="sm">
          <Link to={`/account/security?next=${encodeURIComponent(`/w/${workspace.slug}`)}`}>Set up</Link>
        </Button>
      ),
    },
    ...(canInvite || hasTeam
      ? [
          {
            key: 'team',
            icon: <UserPlus />,
            title: 'Invite your team',
            description: 'Add colleagues by email and give each one a role.',
            state: hasTeam ? 'done' : details.isPending && can('workspace:read') ? 'loading' : 'todo',
            action: (
              <Button asChild variant="secondary" size="sm">
                <Link to={`/w/${workspace.slug}/team?invite=1`}>Invite</Link>
              </Button>
            ),
          } satisfies ChecklistItem,
        ]
      : []),
    ...(seesVault
      ? [
          {
            key: 'documents',
            icon: <Database />,
            title: 'Add documents to the vault',
            description: 'Upload policies and reports; PII is masked before any model sees them.',
            state: hasDocuments ? 'done' : knowledgeBases.isPending ? 'loading' : 'todo',
            action: (
              <Button asChild variant="secondary" size="sm">
                <Link to={`/w/${workspace.slug}/documents`}>Open vault</Link>
              </Button>
            ),
          } satisfies ChecklistItem,
        ]
      : []),
    {
      key: 'agent',
      icon: <Bot />,
      title: 'Build your first agent',
      description: 'A digital employee with its own persona, local model and knowledge.',
      state: 'soon',
      phase: 4,
    },
    {
      key: 'workflow',
      icon: <GitBranch />,
      title: 'Design a workflow',
      description: 'Chain agents and tools on a visual canvas.',
      state: 'soon',
      phase: 6,
    },
  ];

  const available = items.filter((item) => item.state !== 'soon');
  const done = available.filter((item) => item.state === 'done').length;

  return (
    <Card>
      <CardHeader
        title="Getting started"
        description={`${done} of ${available.length} available steps done`}
        actions={
          <div className="flex w-24 items-center gap-2" aria-hidden>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-well-strong">
              <div
                className="h-full rounded-full bg-brand-500 transition-[width] duration-500"
                style={{ width: `${available.length ? (done / available.length) * 100 : 0}%` }}
              />
            </div>
          </div>
        }
      />
      <ol className="border-t border-line">
        {items.map((item, index) => (
          <li
            key={item.key}
            className={cn('flex items-center gap-4 px-5 py-4 sm:px-6', index > 0 && 'border-t border-line/70')}
          >
            <StepMarker state={item.state} icon={item.icon} />
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  'text-[13.5px] font-medium',
                  item.state === 'done' ? 'text-muted line-through decoration-line-strong' : 'text-ink',
                  item.state === 'soon' && 'text-ink-soft',
                )}
              >
                {item.title}
              </p>
              <p className="mt-0.5 text-[13px] leading-snug text-muted">{item.description}</p>
            </div>
            <div className="shrink-0">
              {item.state === 'soon' ? (
                <Badge tone="outline">Phase {item.phase}</Badge>
              ) : item.state === 'done' ? (
                <Badge tone="brand">Done</Badge>
              ) : (
                item.action
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function StepMarker({ state, icon }: { state: ChecklistItem['state']; icon: ReactNode }) {
  if (state === 'done') {
    return (
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white">
        <Check className="size-4" strokeWidth={2.5} aria-label="Done" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full border [&_svg]:size-4',
        state === 'soon' ? 'border-dashed border-line-strong text-faint' : 'border-line-strong bg-surface text-ink-soft',
        state === 'loading' && 'animate-pulse',
      )}
    >
      {icon}
    </span>
  );
}

// ── Document vault (Phase 3) ────────────────────────────────────────────────

function VaultCard() {
  const workspace = useWorkspace();
  const can = useCan();
  const knowledgeBases = useKnowledgeBases();
  if (!can('knowledgebase:read')) return null;

  const list = knowledgeBases.list;
  const totals = list.reduce(
    (sum, knowledgeBase) => ({
      documents: sum.documents + knowledgeBase.stats.documents,
      ready: sum.ready + knowledgeBase.stats.ready,
      processing: sum.processing + knowledgeBase.stats.processing,
      failed: sum.failed + knowledgeBase.stats.failed,
    }),
    { documents: 0, ready: 0, processing: 0, failed: 0 },
  );

  return (
    <Card>
      <CardHeader
        title="Document vault"
        actions={
          <Button asChild variant="ghost" size="xs">
            <Link to={`/w/${workspace.slug}/documents`}>Open</Link>
          </Button>
        }
      />
      <CardBody>
        {knowledgeBases.isPending ? (
          <div className="grid gap-3">
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3.5 w-1/2" />
          </div>
        ) : knowledgeBases.isError ? (
          <ErrorState compact error={knowledgeBases.error} onRetry={() => void knowledgeBases.refetch()} retrying={knowledgeBases.isFetching} />
        ) : (
          <>
            <div className="flex h-1.5 overflow-hidden rounded-full bg-well-strong" aria-hidden>
              {totals.documents > 0 ? (
                <>
                  <span className="bg-success-500" style={{ width: `${(totals.ready / totals.documents) * 100}%` }} />
                  <span className="bg-info-500" style={{ width: `${(totals.processing / totals.documents) * 100}%` }} />
                  <span className="bg-danger-500" style={{ width: `${(totals.failed / totals.documents) * 100}%` }} />
                </>
              ) : null}
            </div>
            <dl className="mt-2 divide-y divide-line/70">
              <DetailRow label="Knowledge bases">{list.length.toLocaleString()}</DetailRow>
              <DetailRow label="Documents">
                <span className="tabular">
                  {totals.documents.toLocaleString()}
                  {totals.processing ? <span className="font-normal text-info-700"> · {totals.processing} processing</span> : null}
                  {totals.failed ? <span className="font-normal text-danger-700"> · {totals.failed} failed</span> : null}
                </span>
              </DetailRow>
              <DetailRow label="Storage you can access">
                <span className="font-mono tabular">{formatBytes(sumBytes(list.map((knowledgeBase) => knowledgeBase.stats.totalBytes)))}</span>
              </DetailRow>
            </dl>
          </>
        )}
      </CardBody>
    </Card>
  );
}

// ── Membership ──────────────────────────────────────────────────────────────

function MembershipCard() {
  const { membership } = useWorkspace();
  // The owner badge already says "Owner"; don't repeat the built-in owner role.
  const roles = [...membership.roles]
    .filter((role) => !(membership.isOwner && role.slug === 'owner'))
    .sort((a, b) => b.priority - a.priority);

  return (
    <Card>
      <CardHeader title="Your membership" />
      <CardBody>
        <div className="flex flex-wrap gap-1.5">
          {membership.isOwner ? (
            <Badge tone="brand">
              <Crown />
              Owner
            </Badge>
          ) : null}
          {roles.map((role) => (
            <Badge key={role.id} tone="outline">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: role.color ?? 'var(--color-faint)' }}
                aria-hidden
              />
              {role.name}
            </Badge>
          ))}
        </div>
        <dl className="mt-3 divide-y divide-line/70">
          {membership.title ? <DetailRow label="Title">{membership.title}</DetailRow> : null}
          <DetailRow label="Name in this workspace">{membership.displayName}</DetailRow>
          <DetailRow label="Joined">{formatDate(membership.joinedAt ?? membership.createdAt)}</DetailRow>
          <DetailRow label="Last active">{formatRelative(membership.lastActiveAt, 'Not recorded yet')}</DetailRow>
        </dl>
      </CardBody>
    </Card>
  );
}

// ── Workspace details ───────────────────────────────────────────────────────

function WorkspaceCard() {
  const workspace = useWorkspace();
  const can = useCan();
  const allowed = can('workspace:read');
  const details = useQuery({ ...workspaceDetailsQuery(workspace.id), enabled: allowed });

  return (
    <Card>
      <CardHeader
        title="Workspace"
        actions={
          allowed ? (
            <Button asChild variant="ghost" size="xs">
              <Link to={`/w/${workspace.slug}/settings`}>Settings</Link>
            </Button>
          ) : null
        }
      />
      <CardBody>
        {!allowed ? (
          <p className="text-[13px] leading-relaxed text-muted">
            Your role can't view this workspace's settings. Ask an admin for the{' '}
            <code className="rounded bg-well px-1 font-mono text-[12px]">workspace:read</code> permission.
          </p>
        ) : details.isPending ? (
          <div className="grid gap-3">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3.5 w-3/4" />
          </div>
        ) : details.isError ? (
          <ErrorState compact error={details.error} onRetry={() => void details.refetch()} retrying={details.isFetching} />
        ) : (
          <>
            {details.data.description ? (
              <p className="mb-2 text-[13px] leading-relaxed text-muted">{details.data.description}</p>
            ) : null}
            <dl className="divide-y divide-line/70">
              <DetailRow label="Members">{pluralize(details.data.memberCount, 'member')}</DetailRow>
              <DetailRow label="Plan">
                <Badge tone="neutral">{details.data.plan.charAt(0) + details.data.plan.slice(1).toLowerCase()}</Badge>
              </DetailRow>
              <DetailRow label="Two-step verification">
                {details.data.settings.requireMfa ? (
                  <Badge tone="brand">Required</Badge>
                ) : (
                  <span className="text-muted">Optional</span>
                )}
              </DetailRow>
              <DetailRow label="Network allowlist">
                {details.data.ipAllowlistEnabled ? <Badge tone="brand">On</Badge> : <span className="text-muted">Off</span>}
              </DetailRow>
              <DetailRow label="Created">{formatDate(details.data.createdAt)}</DetailRow>
            </dl>
          </>
        )}
      </CardBody>
    </Card>
  );
}

// ── Access (effective permissions) ──────────────────────────────────────────

function AccessCard() {
  const workspace = useWorkspace();
  const can = useCan();
  const catalogue = useQuery(permissionCatalogueQuery);
  const snapshot = workspace.permissions;

  const categories = catalogue.data
    ? Object.entries(
        catalogue.data.permissions.reduce<Record<string, PermissionDefinition[]>>((groups, permission) => {
          (groups[permission.category] ??= []).push(permission);
          return groups;
        }, {}),
      )
    : [];
  const grantedTotal = catalogue.data?.permissions.filter((permission) => can(permission.key)).length ?? 0;

  return (
    <Card>
      <CardHeader
        title="Your access"
        description={
          snapshot.keys === null
            ? 'Resolved by the server on every request.'
            : catalogue.data
              ? `${grantedTotal} of ${catalogue.data.permissions.length} permissions in this workspace, from your ${pluralize(workspace.membership.roles.length, 'role')}.`
              : 'What your roles allow in this workspace.'
        }
        actions={
          snapshot.source === 'server' ? (
            <Badge tone="info">From server</Badge>
          ) : snapshot.source === 'computed' ? (
            <Badge tone="neutral">Computed from roles</Badge>
          ) : null
        }
      />
      <CardBody>
        {snapshot.keys === null ? (
          <Callout tone="neutral" title="Your exact permissions can't be shown here">
            Your role can't read this workspace's role list, so AgentVault shows every section and lets the server decide
            on each request. Anything you're not allowed to do will say so.
          </Callout>
        ) : catalogue.isPending ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : catalogue.isError ? (
          <ErrorState compact error={catalogue.error} onRetry={() => void catalogue.refetch()} />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map(([category, permissions]) => (
              <CategoryRow key={category} category={category} permissions={permissions} can={can} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function CategoryRow({
  category,
  permissions,
  can,
}: {
  category: string;
  permissions: PermissionDefinition[];
  can: (key: string) => boolean;
}) {
  const granted = permissions.filter((permission) => can(permission.key)).length;
  const ratio = permissions.length ? granted / permissions.length : 0;

  return (
    <li>
      <details className="group rounded-lg border border-line bg-surface open:bg-well/30 [&_summary::-webkit-details-marker]:hidden">
        <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg px-3.5 py-3 hover:bg-well/50">
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="font-medium text-ink">{PERMISSION_CATEGORY_LABELS[category] ?? category}</span>
              <span className="text-xs text-muted tabular">
                {granted}/{permissions.length}
              </span>
            </p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-well-strong">
              <div
                className={cn('h-full rounded-full', ratio === 1 ? 'bg-brand-600' : ratio > 0 ? 'bg-brand-400' : 'bg-transparent')}
                style={{ width: `${ratio * 100}%` }}
              />
            </div>
          </div>
          <ChevronDown className="size-4 shrink-0 text-faint transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <ul className="grid gap-1.5 border-t border-line px-3.5 py-3">
          {permissions.map((permission) => {
            const has = can(permission.key);
            return (
              <li key={permission.key} className="flex items-start gap-2 text-xs leading-snug">
                {has ? (
                  <Check className="mt-px size-3.5 shrink-0 text-brand-600" strokeWidth={2.5} aria-label="Granted" />
                ) : (
                  <span className="mt-[7px] h-px w-2.5 shrink-0 bg-line-strong" aria-label="Not granted" />
                )}
                <span className={cn('min-w-0', has ? 'text-ink-soft' : 'text-faint')}>
                  <span className="font-mono text-[11px]">{permission.key}</span>
                  {permission.isDangerous ? (
                    <TriangleAlert className="ml-1 inline size-3 text-warning-500" aria-label="Sensitive" />
                  ) : null}
                  <span className="block text-[11.5px] text-muted">{permission.description}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </details>
    </li>
  );
}
