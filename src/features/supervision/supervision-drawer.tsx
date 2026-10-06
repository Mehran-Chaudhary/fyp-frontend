import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Eye, EyeOff, MessageSquareOff, ShieldAlert, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/misc';
import { conversationsApi } from '@/lib/api/endpoints';
import { hasCode } from '@/lib/api/errors';
import type { Conversation, MessagePage } from '@/lib/api/types';
import { afterConversationGone } from '@/lib/agents/cache';
import { conversationTitle, flattenPages } from '@/lib/agents/messages';
import { messageFor } from '@/lib/errors';
import { conversationMessagesQuery, conversationQuery, memberNamesQuery, MESSAGE_PAGE_SIZE } from '@/lib/queries';
import { isUuid } from '@/features/team/member-helpers';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { AgentAvatar, ClassificationMark } from '@/features/agents/shared/agent-bits';
import { useAgentCan } from '@/features/agents/shared/use-agent-can';
import { DeleteConversationDialog } from '@/features/chat/conversation-dialogs';
import { MessageList } from '@/features/chat/message-list';
import { OwnerLabel } from './owner-label';

/**
 * A supervised conversation, read-only (§4.7, §5.7). Content is masked by default.
 * "Reveal" (pii:reveal) is audited as a critical event; the revealed pages live in
 * this component only, never in the query cache, and are dropped when the panel
 * closes or the tab is hidden.
 */
export function SupervisionDrawer() {
  const { conversationId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const workspace = useWorkspace();
  const close = () => navigate(`/w/${workspace.slug}/supervision${location.search}`);
  return <Panel key={conversationId} conversationId={conversationId} onClose={close} />;
}

function Panel({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const workspace = useWorkspace();
  const can = useAgentCan();
  const valid = isUuid(conversationId);
  const conversation = useQuery({ ...conversationQuery(workspace.id, conversationId), enabled: valid });
  const names = useQuery({ ...memberNamesQuery(workspace.id), enabled: can.readMembers });
  const [deleting, setDeleting] = useState(false);
  const data = conversation.data;
  const gone = !valid || hasCode(conversation.error, 'CONVERSATION_NOT_FOUND', 'BAD_REQUEST');
  const ownerName = data?.ownerUserId ? (names.data?.get(data.ownerUserId)?.name ?? null) : null;

  useEffect(() => {
    if (gone && valid) void afterConversationGone(workspace.id, conversationId);
  }, [gone, valid, workspace.id, conversationId]);

  return (
    <Drawer
      open
      onOpenChange={(open) => (open ? null : onClose())}
      title={data ? conversationTitle(data) : 'Conversation'}
      className="w-[min(46rem,100vw)]"
      headerExtra={
        data ? (
          <div className="flex min-w-0 items-start gap-3">
            <AgentAvatar agent={{ id: data.agentId, name: data.agentName ?? '?' }} size="md" />
            <div className="min-w-0">
              <p className={data.title ? 'truncate text-base leading-6 font-semibold text-ink' : 'truncate text-base leading-6 font-semibold text-muted italic'}>{conversationTitle(data)}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
                <OwnerLabel conversation={data} name={ownerName} canResolve={can.readMembers} />
                <span>· {data.agentName ?? 'Deleted agent'}</span>
                <ClassificationMark classification={data.classification} />
              </p>
            </div>
          </div>
        ) : null
      }
      footer={
        data && can.deleteConversations ? (
          <Button variant="danger-outline" size="sm" onClick={() => setDeleting(true)}>
            <Trash2 />
            Delete conversation
          </Button>
        ) : null
      }
    >
      {gone ? (
        <EmptyState icon={<MessageSquareOff />} title="This conversation doesn't exist or isn't available to you" description="It may have been deleted." />
      ) : !data ? (
        conversation.isError ? (
          <ErrorState error={conversation.error} onRetry={() => void conversation.refetch()} retrying={conversation.isFetching} />
        ) : (
          <div className="grid gap-4 p-6">
            <Skeleton className="ml-auto h-10 w-2/3 rounded-2xl" />
            <Skeleton className="h-24 w-5/6" />
          </div>
        )
      ) : (
        <SupervisedThread conversation={data} ownerName={ownerName} />
      )}
      <DeleteConversationDialog
        conversation={deleting && data ? data : null}
        ownerName={ownerName}
        onClose={() => setDeleting(false)}
        onDeleted={() => onClose()}
      />
    </Drawer>
  );
}

function SupervisedThread({ conversation, ownerName }: { conversation: Conversation; ownerName: string | null }) {
  const workspace = useWorkspace();
  const can = useAgentCan();
  const masked = useInfiniteQuery(conversationMessagesQuery(workspace.id, conversation.id));
  const maskedMessages = useMemo(() => flattenPages(masked.data?.pages ?? []), [masked.data]);
  const firstPage = masked.data?.pages[0];

  // Revealed pages: component state only (§9.1 "never cache reveal=true pages").
  const [revealed, setRevealed] = useState<MessagePage[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  // Hidden tab: drop the real values (§9.2).
  useEffect(() => {
    if (!revealed) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') setRevealed(null);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [revealed]);

  const loadRevealed = async (before?: number) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setRevealing(true);
    setRevealError(null);
    try {
      const page = await conversationsApi.messages(workspace.id, conversation.id, { limit: MESSAGE_PAGE_SIZE, before, reveal: true }, controller.signal);
      setRevealed((current) => (before === undefined ? [page] : [...(current ?? []), page]));
      setConfirming(false);
    } catch (error) {
      if (controller.signal.aborted) return;
      setRevealError(hasCode(error, 'PERMISSION_DENIED') ? "Your role can't reveal personal data (it needs pii:reveal)." : messageFor(error));
    } finally {
      if (request.current === controller) setRevealing(false);
    }
  };

  const showing = revealed ?? null;
  const messages = showing ? flattenPages(showing) : maskedMessages;
  const lastRevealed = showing?.[showing.length - 1];
  const hasOlder = showing ? !!lastRevealed?.nextBefore : !!masked.hasNextPage;
  const policyOff = !!firstPage && !firstPage.masked && !conversation.isOwner && !showing;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 gap-2 border-b border-line bg-well/30 px-5 py-3 sm:px-6">
        {showing ? (
          <Callout
            tone="warning"
            icon={<Eye className="size-4" />}
            title="Personal data revealed"
            action={
              <Button size="xs" variant="secondary" onClick={() => setRevealed(null)}>
                <EyeOff />
                Mask again
              </Button>
            }
          >
            This reveal was recorded as a critical audit event. Real values disappear when you close the panel or switch tabs.
          </Callout>
        ) : policyOff ? (
          <Callout tone="warning" title="Masking is turned off in this workspace">
            So {ownerName ? `${ownerName}'s` : "this member's"} conversation is shown as it was stored. Viewing it is still audited.
          </Callout>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted">
            <span className="flex items-center gap-1.5">
              <ShieldAlert className="size-3.5 text-faint" aria-hidden />
              Read-only. Personal data is masked; this view is audited.
            </span>
            {can.revealPersonalData ? (
              <Button
                size="xs"
                variant="secondary"
                onClick={() => {
                  setRevealError(null);
                  setConfirming(true);
                }}
              >
                <Eye />
                Reveal personal data
              </Button>
            ) : null}
          </div>
        )}
      </div>

      {masked.isPending ? (
        <div className="grid gap-4 p-6">
          <Skeleton className="ml-auto h-10 w-2/3 rounded-2xl" />
          <Skeleton className="h-24 w-5/6" />
        </div>
      ) : masked.isError && !masked.data ? (
        <ErrorState error={masked.error} onRetry={() => void masked.refetch()} retrying={masked.isFetching} />
      ) : messages.length === 0 ? (
        <EmptyState icon={<MessageSquareOff />} title="No messages yet" />
      ) : (
        <MessageList
          messages={messages}
          agentName={conversation.agentName ?? 'Agent'}
          hasOlder={hasOlder}
          loadingOlder={showing ? revealing : masked.isFetchingNextPage}
          onLoadOlder={() => (showing ? void loadRevealed(lastRevealed?.nextBefore ?? undefined) : void masked.fetchNextPage())}
        />
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        icon={<Eye />}
        tone="warning"
        title="Reveal personal data?"
        description={`You'll see the real names, emails and other details in ${ownerName ? `${ownerName}'s` : 'this'} conversation. This is recorded as a critical audit event.`}
        confirmLabel="Reveal"
        onConfirm={() => void loadRevealed()}
        pending={revealing}
        error={revealError}
      />
    </div>
  );
}
