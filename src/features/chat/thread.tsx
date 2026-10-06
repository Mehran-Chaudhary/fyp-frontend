import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Square } from 'lucide-react';
import { useEffect, useEffectEvent, useMemo, useState, type ReactNode } from 'react';
import { useBlocker, useNavigate } from 'react-router';
import { ErrorState } from '@/components/feedback/states';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/misc';
import { hasCode } from '@/lib/api/errors';
import type { Conversation } from '@/lib/api/types';
import { flattenPages, lastSequence, latestSentence } from '@/lib/agents/messages';
import { onOtherTabTurn } from '@/lib/agents/stream';
import { messageFor } from '@/lib/errors';
import { useCountdown } from '@/lib/hooks';
import { agentQuery, conversationMessagesQuery, queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast } from '@/lib/toast';
import { timestamp } from '@/lib/utils';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { useAgentCan } from '@/features/agents/shared/use-agent-can';
import { Composer } from './composer';
import { defaultComposerSettings, turnOptionsOf, type ComposerSettings } from './composer-settings';
import { DeleteConversationDialog, RenameConversationDialog } from './conversation-dialogs';
import { peekFirstQuestion, takeFirstQuestion } from './first-question';
import { MessageList } from './message-list';
import { GreetingBanner, PendingTurn, ThreadHeader } from './thread-parts';
import { OTHER_TAB_TURN_MAX_MS, useTurn } from './use-turn';
import { useConversationActions } from './use-conversation-actions';

/**
 * Your own conversation (§5.6): history with cursor paging, the turn in progress,
 * and the composer. One turn at a time, here and across your tabs (§9.3).
 */
export function OwnerThread({ conversation }: { conversation: Conversation }) {
  const workspace = useWorkspace();
  const can = useAgentCan();
  const navigate = useNavigate();
  const { update } = useConversationActions();
  const [draft, setDraft] = useState('');
  const [settings, setSettings] = useState<ComposerSettings>(defaultComposerSettings);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [otherTabUntil, setOtherTabUntil] = useState<number | null>(null);
  const otherTabLeft = useCountdown(otherTabUntil, () => setOtherTabUntil(null));

  const turn = useTurn(workspace.id, conversation.id, {
    // Stopped before the server stored it: the text goes back, unless you've typed something new.
    onRestore: (content) => setDraft((current) => current || content),
  });
  const history = useInfiniteQuery(conversationMessagesQuery(workspace.id, conversation.id));
  const agent = useQuery({ ...agentQuery(workspace.id, conversation.agentId), enabled: can.browseAgents, retry: false });
  const messages = useMemo(() => flattenPages(history.data?.pages ?? []), [history.data]);
  const agentName = conversation.agentName ?? agent.data?.name ?? 'Agent';

  // ── The first question from the draft screen, sent once (StrictMode-safe: scheduled, not inline).
  const [handoff] = useState(() => peekFirstQuestion(conversation.id));
  const sendHandoff = useEffectEvent(() => {
    const question = takeFirstQuestion(conversation.id);
    if (question) turn.send(question.content, question.options, 0);
  });
  useEffect(() => {
    if (!handoff) return;
    const timer = window.setTimeout(sendHandoff, 0);
    return () => window.clearTimeout(timer);
  }, [handoff]);

  // ── Another tab of yours is answering in this conversation (§9.3).
  useEffect(
    () =>
      onOtherTabTurn((signal) => {
        if (signal.workspaceId !== workspace.id || signal.conversationId !== conversation.id) return;
        if (signal.type === 'started') {
          setOtherTabUntil(timestamp() + OTHER_TAB_TURN_MAX_MS);
        } else {
          setOtherTabUntil(null);
          void queryClient.invalidateQueries({ queryKey: queryKeys.conversationMessages(workspace.id, conversation.id) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.conversationDetail(workspace.id, conversation.id) });
        }
      }),
    [workspace.id, conversation.id],
  );

  // ── An agent that disappears from under an open chat (§3.7): re-read it to say so.
  const failedCode = turn.phase.kind === 'failed' ? turn.phase.failure.code : null;
  useEffect(() => {
    if (failedCode === 'AGENT_NOT_FOUND' || failedCode === 'AGENT_UNAVAILABLE') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agentDetail(workspace.id, conversation.agentId) });
    }
    if (failedCode === 'CONVERSATION_ARCHIVED') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationDetail(workspace.id, conversation.id) });
    }
  }, [failedCode, workspace.id, conversation.agentId, conversation.id]);

  const agentGone = hasCode(agent.error, 'AGENT_NOT_FOUND');
  const running = turn.phase.kind === 'running';

  const unarchive = (then?: () => void) =>
    update.mutate(
      { id: conversation.id, body: { status: 'ACTIVE' } },
      {
        onSuccess: () => then?.(),
        onError: (error) => toast.error("Couldn't unarchive it", { description: messageFor(error) }),
      },
    );

  let blocked: ReactNode = null;
  if (!can.chat) blocked = "Your role can read this conversation, but not send messages (it needs agent:execute).";
  else if (conversation.status === 'ARCHIVED')
    blocked = (
      <>
        This conversation is archived.{' '}
        <button type="button" className="font-medium text-brand-700 underline underline-offset-2" onClick={() => unarchive()}>
          Unarchive it
        </button>{' '}
        to continue.
      </>
    );
  else if (agentGone) blocked = "This agent isn't available to you any more: it was unpublished or deleted, or its access changed. The history stays readable.";
  else if (otherTabLeft > 0 && !turn.busy) blocked = 'Answering in another tab… This one catches up when it finishes.';

  const send = () => {
    const content = draft.trim();
    if (!content || turn.busy) return;
    const { options, error } = turnOptionsOf(settings);
    if (!options) {
      setSettingsError(error);
      return;
    }
    setSettingsError(null);
    turn.send(content, options, lastSequence(messages));
    setDraft('');
  };

  const editPending = () => {
    if (turn.phase.kind !== 'failed' && turn.phase.kind !== 'lost') return;
    setDraft(turn.phase.question.content);
    turn.dismiss();
  };

  const view = turn.phase.kind === 'idle' || turn.phase.kind === 'failed' || turn.phase.kind === 'lost' ? null : turn.phase.view;
  const questionStored = !!view?.meta && messages.some((message) => message.id === view.meta?.userMessageId);

  // Leaving mid-answer stops it (§9.3): say so first.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => running && currentLocation.pathname !== nextLocation.pathname);

  // A polite live region: whole sentences, not every token (§5 "Announce streaming politely").
  const announcement =
    turn.phase.kind === 'running'
      ? view?.text
        ? latestSentence(view.text)
        : `${agentName} is answering.`
      : turn.phase.kind === 'failed'
        ? 'The answer failed.'
        : turn.phase.kind === 'idle' && turn.results.size > 0
          ? 'Answer complete.'
          : '';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ThreadHeader
        conversation={conversation}
        agent={agent.data ?? null}
        onRename={() => setRenaming(true)}
        onArchive={(next) =>
          update.mutate(
            { id: conversation.id, body: { status: next } },
            {
              onSuccess: () => toast.success(next === 'ARCHIVED' ? 'Archived: it stays readable' : 'Unarchived'),
              onError: (error) => toast.error("Couldn't change it", { description: messageFor(error) }),
            },
          )
        }
        onDelete={can.deleteConversations ? () => setDeleting(true) : undefined}
      />

      {history.isPending ? (
        <div className="mx-auto grid w-full max-w-3xl flex-1 content-start gap-6 px-6 pt-8">
          <Skeleton className="ml-auto h-12 w-2/3 rounded-2xl" />
          <Skeleton className="h-24 w-5/6" />
          <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
        </div>
      ) : history.isError && !history.data ? (
        <div className="flex-1 p-6">
          <ErrorState error={history.error} title="We couldn't load this conversation's messages" onRetry={() => void history.refetch()} retrying={history.isFetching} />
        </div>
      ) : (
        <MessageList
          messages={messages}
          agentName={agentName}
          results={turn.results}
          hasOlder={!!history.hasNextPage}
          loadingOlder={history.isFetchingNextPage}
          onLoadOlder={() => void history.fetchNextPage()}
          top={<GreetingBanner agent={agent.data ?? null} name={agentName} />}
          bottom={
            <PendingTurn
              turn={turn}
              agentName={agentName}
              questionStored={questionStored}
              actions={{
                onRetry: () => turn.retry(),
                onEdit: editPending,
                onUnarchive: () => unarchive(() => turn.retry()),
                newConversationHref: `/w/${workspace.slug}/chat/new?agent=${conversation.agentId}`,
              }}
            />
          }
          followKey={`${turn.phase.kind}:${view?.text.length ?? 0}:${view?.tools.length ?? 0}:${view?.stage ?? ''}`}
        />
      )}

      <div className="shrink-0 border-t border-line bg-canvas/80 px-4 pt-3 pb-4 backdrop-blur sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={send}
            onStop={turn.stop}
            running={running}
            busy={turn.busy && !running}
            blocked={blocked}
            settings={settings}
            onSettings={(next) => {
              setSettings(next);
              setSettingsError(null);
            }}
            agent={agent.data ?? null}
            placeholder={`Ask ${agentName}…`}
            autoFocus={!handoff}
            error={settingsError}
          />
        </div>
      </div>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <RenameConversationDialog conversation={renaming ? conversation : null} onClose={() => setRenaming(false)} />
      <DeleteConversationDialog
        conversation={deleting ? conversation : null}
        onClose={() => setDeleting(false)}
        onDeleted={() => navigate(`/w/${workspace.slug}/chat`, { replace: true })}
      />
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') blocker.reset();
        }}
        icon={<Square />}
        tone="warning"
        title="Stop the answer and leave?"
        description="Leaving stops it. What has been written so far is kept in the conversation as a stopped answer."
        confirmLabel="Stop and leave"
        onConfirm={() => {
          if (blocker.state === 'blocked') blocker.proceed();
        }}
      />
    </div>
  );
}

