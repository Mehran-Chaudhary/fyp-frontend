import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bot,
  Eye,
  EyeOff,
  History,
  LayoutList,
  MessageSquareText,
  MoreHorizontal,
  ScanText,
  Send,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Outlet, useNavigate, useParams } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/misc';
import { TabNav, type TabNavItem } from '@/components/ui/tab-nav';
import { hasCode, isApiError } from '@/lib/api/errors';
import type { Agent } from '@/lib/api/types';
import { afterAgentGone } from '@/lib/agents/cache';
import { agentActions } from '@/lib/agents/capabilities';
import { messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { agentQuery } from '@/lib/queries';
import { toast } from '@/lib/toast';
import { formatDate } from '@/lib/utils';
import { isUuid } from '@/features/team/member-helpers';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { AgentAvatar, AgentStateBadges, AudienceLine } from '../shared/agent-bits';
import { useAgentCan } from '../shared/use-agent-can';
import type { AgentOutletContext } from './agent-context';
import { useAgentLifecycle } from './agent-mutations';

/** An agent: header, lifecycle actions, and the Overview / Configure / Versions / Prompt preview tabs (§5). */
export function AgentLayout() {
  const workspace = useWorkspace();
  const can = useAgentCan();
  const { agentId = '' } = useParams();
  if (!can.browseAgents) {
    return (
      <Card>
        <NoAccessState permissions={['agent:read']} workspaceName={workspace.name} title="You can't see agents" />
      </Card>
    );
  }
  return <Loaded key={agentId} agentId={agentId} />;
}

function Loaded({ agentId }: { agentId: string }) {
  const workspace = useWorkspace();
  const valid = isUuid(agentId);
  // Fresh on every visit: the editor must start from the server's copy (P4-G05).
  const query = useQuery({ ...agentQuery(workspace.id, agentId), enabled: valid, refetchOnMount: 'always' });
  const agent = query.data;
  useDocumentTitle(agent?.name ?? 'Agent');

  const gone = !valid || hasCode(query.error, 'AGENT_NOT_FOUND', 'BAD_REQUEST');
  useEffect(() => {
    if (gone && valid) void afterAgentGone(workspace.id, agentId);
  }, [gone, valid, workspace.id, agentId]);

  const back = (
    <Link to={`/w/${workspace.slug}/agents`} className="inline-flex w-fit items-center gap-1.5 rounded-md text-[13px] font-medium text-muted hover:text-ink">
      <ArrowLeft className="size-3.5" />
      AI agents
    </Link>
  );

  if (gone) {
    return (
      <div className="grid gap-6">
        {back}
        <Card>
          <EmptyState
            icon={<Bot />}
            title="This agent doesn't exist or isn't available to you"
            description="It may have been deleted or unpublished, its access may have changed, or the link is wrong."
            action={
              <Button asChild variant="secondary" size="sm">
                <Link to={`/w/${workspace.slug}/agents`}>Back to agents</Link>
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="grid gap-6">
        {back}
        {query.isError ? (
          <Card>
            <ErrorState error={query.error} title="We couldn't load this agent" onRetry={() => void query.refetch()} retrying={query.isFetching} />
          </Card>
        ) : (
          <div className="grid gap-4">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-9 w-96 max-w-full" />
            <Skeleton className="h-72 w-full rounded-xl" />
          </div>
        )}
      </div>
    );
  }

  return <AgentFrame agent={agent} refreshing={query.isFetching} back={back} />;
}

function AgentFrame({ agent, refreshing, back }: { agent: Agent; refreshing: boolean; back: ReactNode }) {
  const workspace = useWorkspace();
  const can = useAgentCan();
  const navigate = useNavigate();
  const actions = agentActions(agent, can);
  const lifecycle = useAgentLifecycle(agent.id);
  const [confirm, setConfirm] = useState<'publish' | 'unpublish' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const base = `/w/${workspace.slug}/agents/${agent.id}`;
  const tabs: TabNavItem[] = [{ to: base, label: 'Overview', icon: LayoutList, isActive: (path) => path === base }];
  if (actions.edit) tabs.push({ to: `${base}/edit`, label: 'Configure', icon: SlidersHorizontal });
  tabs.push({ to: `${base}/versions`, label: 'Versions', icon: History });
  if (actions.preview) tabs.push({ to: `${base}/preview`, label: 'Prompt preview', icon: ScanText });

  const close = () => {
    setConfirm(null);
    setError(null);
  };

  const run = (kind: 'publish' | 'unpublish' | 'delete') => {
    setError(null);
    const mutation = kind === 'delete' ? lifecycle.remove : kind === 'publish' ? lifecycle.publish : lifecycle.unpublish;
    mutation.mutate(undefined, {
      onSuccess: () => {
        setConfirm(null);
        if (kind === 'delete') {
          toast.success('Agent deleted', { description: `${agent.name} can't be used any more. Its conversations stay readable.` });
          navigate(`/w/${workspace.slug}/agents`, { replace: true });
          void afterAgentGone(workspace.id, agent.id);
        } else {
          toast.success(kind === 'publish' ? 'Agent published' : 'Agent unpublished', {
            description:
              kind === 'publish'
                ? agent.accessMode === 'RESTRICTED'
                  ? 'Members holding one of its roles can use it now.'
                  : 'Everyone who can use agents can find it now.'
                : 'It is a draft again. Members lost access at once.',
          });
        }
      },
      onError: (failure) => {
        if (hasCode(failure, 'AGENT_NOT_FOUND')) {
          setConfirm(null);
          return;
        }
        setError(
          isApiError(failure) && (failure.status === 0 || failure.status >= 500)
            ? `${messageFor(failure)} We're checking the agent's current state.`
            : messageFor(failure),
        );
      },
    });
  };

  const context: AgentOutletContext = { agent, refreshing, requestPublish: actions.publish ? () => setConfirm('publish') : null };
  const pending = lifecycle.publish.isPending || lifecycle.unpublish.isPending || lifecycle.remove.isPending;

  return (
    <div className="grid grid-cols-1 gap-6">
      {back}
      <header className="rounded-xl border border-line bg-surface px-5 py-5 shadow-card sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <AgentAvatar agent={agent} size="lg" className="mt-0.5" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.015em] break-words text-ink">{agent.name}</h1>
                <AgentStateBadges agent={agent} />
              </div>
              <p className="mt-1 text-sm text-muted">
                {agent.config.persona.role ? `You are ${agent.name}, ${agent.config.persona.role}.` : 'An assistant for this organisation.'}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted">
                <AudienceLine agent={agent} />
                <span>Version {agent.currentVersion}</span>
                {agent.publishedAt ? <span>Published {formatDate(agent.publishedAt)}</span> : null}
                <span>Created {formatDate(agent.createdAt)}</span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions.chat && can.readOwnConversations ? (
              <Button asChild>
                <Link to={`/w/${workspace.slug}/chat/new?agent=${agent.id}`}>
                  <MessageSquareText />
                  Start chat
                </Link>
              </Button>
            ) : null}
            {actions.publish ? (
              <Button variant="secondary" onClick={() => setConfirm('publish')}>
                <Send />
                Publish
              </Button>
            ) : null}
            {actions.unpublish || actions.delete ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="icon" aria-label="More actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {actions.unpublish ? (
                    <DropdownMenuItem onSelect={() => setConfirm('unpublish')}>
                      <EyeOff />
                      Unpublish
                    </DropdownMenuItem>
                  ) : null}
                  {actions.delete ? (
                    <DropdownMenuItem tone="danger" onSelect={() => setConfirm('delete')}>
                      <Trash2 />
                      Delete agent
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6">
        <TabNav items={tabs} aria-label="Agent sections" className="-mt-1" />
        <Outlet context={context} />
      </div>

      <ConfirmDialog
        open={confirm === 'publish'}
        onOpenChange={(open) => (open ? null : close())}
        icon={<Eye />}
        title={`Publish ${agent.name}?`}
        description={
          agent.accessMode === 'RESTRICTED'
            ? 'Members holding one of its allowed roles will be able to find it and chat with it. It doesn\'t create a version.'
            : "Everyone in this workspace who can use agents will be able to find it and chat with it. It doesn't create a version."
        }
        confirmLabel="Publish"
        onConfirm={() => run('publish')}
        pending={lifecycle.publish.isPending}
        error={error}
      />
      <ConfirmDialog
        open={confirm === 'unpublish'}
        onOpenChange={(open) => (open ? null : close())}
        icon={<EyeOff />}
        tone="warning"
        title={`Unpublish ${agent.name}?`}
        description="Members will lose access to this agent; their conversations stay readable. You and other agent managers can still use it."
        confirmLabel="Unpublish"
        onConfirm={() => run('unpublish')}
        pending={lifecycle.unpublish.isPending}
        error={error}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(open) => (open ? null : close())}
        icon={<TriangleAlert />}
        tone="danger"
        title={`Delete ${agent.name}?`}
        description="Members keep their conversation history, but no one can talk to this agent again. There's no undo, and its name becomes free for a new agent."
        confirmLabel="Delete agent"
        typeToConfirm={agent.name}
        onConfirm={() => run('delete')}
        pending={pending && confirm === 'delete'}
        error={error}
      />
    </div>
  );
}
