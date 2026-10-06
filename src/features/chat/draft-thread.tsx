import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bot, PenLine } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { conversationsApi } from '@/lib/api/endpoints';
import { hasCode, isOutcomeUnknown } from '@/lib/api/errors';
import { afterAgentGone, afterConversationCreated } from '@/lib/agents/cache';
import { CONVERSATION_TITLE_MAX } from '@/lib/agents/limits';
import { messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { agentQuery, queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { isUuid } from '@/features/team/member-helpers';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { AgentAvatar } from '@/features/agents/shared/agent-bits';
import { useAgentCan } from '@/features/agents/shared/use-agent-can';
import { Composer } from './composer';
import { defaultComposerSettings, turnOptionsOf, type ComposerSettings } from './composer-settings';
import { handOffFirstQuestion } from './first-question';
import { GreetingBanner } from './thread-parts';

/**
 * /chat/new?agent=… (§5.6 "Start"): the agent's greeting and a composer. The
 * conversation is created (P4-API-13) only when the first question is sent, so
 * opening and leaving leaves nothing behind.
 */
export function DraftThread() {
  const workspace = useWorkspace();
  const can = useAgentCan();
  const [params] = useSearchParams();
  const agentId = params.get('agent') ?? '';
  useDocumentTitle('New chat');

  if (!can.chat) {
    return (
      <div className="p-6">
        <NoAccessState permissions={['agent:execute']} workspaceName={workspace.name} title="You can't start conversations" />
      </div>
    );
  }
  if (!isUuid(agentId)) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          icon={<Bot />}
          title="Choose an agent to talk to"
          action={
            <Button asChild size="sm">
              <Link to={`/w/${workspace.slug}/agents`}>Browse agents</Link>
            </Button>
          }
        />
      </div>
    );
  }
  return <Draft key={agentId} agentId={agentId} />;
}

function Draft({ agentId }: { agentId: string }) {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const agent = useQuery({ ...agentQuery(workspace.id, agentId), retry: false });
  const [draft, setDraft] = useState('');
  const [title, setTitle] = useState('');
  const [titling, setTitling] = useState(false);
  const [settings, setSettings] = useState<ComposerSettings>(defaultComposerSettings);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => conversationsApi.create(workspace.id, { agentId, ...(title.trim() ? { title: title.trim() } : {}) }),
  });

  const send = () => {
    const content = draft.trim();
    if (!content || create.isPending) return;
    const { options, error: optionsError } = turnOptionsOf(settings);
    if (!options) {
      setError(optionsError);
      return;
    }
    setError(null);
    create.mutate(undefined, {
      onSuccess: (conversation) => {
        void afterConversationCreated(workspace.id, conversation);
        handOffFirstQuestion(conversation.id, { content, options });
        navigate(`/w/${workspace.slug}/chat/${conversation.id}`, { replace: true });
      },
      onError: (failure) => {
        if (hasCode(failure, 'AGENT_NOT_FOUND', 'AGENT_UNAVAILABLE')) {
          void afterAgentGone(workspace.id, agentId);
          setError(messageFor(failure));
        } else if (isOutcomeUnknown(failure)) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.conversations(workspace.id) });
          setError(`${messageFor(failure)} The conversation may have been created: check your list before sending again.`);
        } else {
          setError(messageFor(failure));
        }
      },
    });
  };

  if (agent.isPending) {
    return (
      <div className="grid flex-1 content-center justify-items-center gap-3 p-6">
        <Skeleton className="size-11 rounded-full" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-16 w-80 max-w-full rounded-2xl" />
      </div>
    );
  }
  if (agent.isError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        {hasCode(agent.error, 'AGENT_NOT_FOUND') ? (
          <EmptyState
            icon={<Bot />}
            title="This agent doesn't exist or isn't available to you"
            action={
              <Button asChild size="sm" variant="secondary">
                <Link to={`/w/${workspace.slug}/agents`}>Browse agents</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState error={agent.error} onRetry={() => void agent.refetch()} retrying={agent.isFetching} />
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface/80 px-3 py-2.5 sm:px-5">
        <Button asChild variant="ghost" size="icon-sm" className="-ml-1 lg:hidden" aria-label="All conversations">
          <Link to={`/w/${workspace.slug}/chat`}>
            <ArrowLeft />
          </Link>
        </Button>
        <AgentAvatar agent={agent.data} size="md" />
        <div className="min-w-0 flex-1">
          {titling ? (
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={CONVERSATION_TITLE_MAX}
              placeholder="Title (optional)"
              aria-label="Conversation title"
              inputClassName="h-8 text-[13.5px]"
              autoFocus
            />
          ) : (
            <>
              <h2 className="truncate text-[14.5px] leading-5 font-semibold text-muted">New conversation</h2>
              <p className="truncate text-[12px] text-muted">{agent.data.name}</p>
            </>
          )}
        </div>
        {titling ? null : (
          <Button variant="ghost" size="xs" onClick={() => setTitling(true)}>
            <PenLine />
            Add a title
          </Button>
        )}
      </header>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-3xl gap-4 px-4 pt-10 pb-8 sm:px-6">
          <GreetingBanner agent={agent.data} name={agent.data.name} />
          {!title.trim() && titling ? <p className="text-center text-[12px] text-muted">Without a title, the first line of your question becomes the title.</p> : null}
        </div>
      </div>
      <div className="shrink-0 border-t border-line bg-canvas/80 px-4 pt-3 pb-4 sm:px-6">
        <div className="mx-auto grid w-full max-w-3xl gap-2">
          {error ? (
            <Callout tone="danger" role="alert">
              {error}
            </Callout>
          ) : null}
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={send}
            onStop={() => undefined}
            running={false}
            blocked={create.isPending ? 'Starting the conversation…' : null}
            settings={settings}
            onSettings={setSettings}
            agent={agent.data}
            placeholder={`Ask ${agent.data.name}…`}
            autoFocus
          />
        </div>
      </div>
    </div>
  );
}
