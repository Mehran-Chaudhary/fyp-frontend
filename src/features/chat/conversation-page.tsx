import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, MessageSquareOff, UserRoundSearch } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { hasCode } from '@/lib/api/errors';
import { afterConversationGone } from '@/lib/agents/cache';
import { conversationTitle } from '@/lib/agents/messages';
import { useDocumentTitle } from '@/lib/hooks';
import { conversationQuery } from '@/lib/queries';
import { isUuid } from '@/features/team/member-helpers';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { useAgentCan } from '@/features/agents/shared/use-agent-can';
import { OwnerThread } from './thread';

/** /chat/:conversationId (P4-API-14): yours to continue; someone else's opens in Supervision. */
export function ConversationPage() {
  const { conversationId = '' } = useParams();
  return <Loaded key={conversationId} conversationId={conversationId} />;
}

function Loaded({ conversationId }: { conversationId: string }) {
  const workspace = useWorkspace();
  const can = useAgentCan();
  const valid = isUuid(conversationId);
  const query = useQuery({ ...conversationQuery(workspace.id, conversationId), enabled: valid });
  const conversation = query.data;
  useDocumentTitle(conversation ? conversationTitle(conversation) : 'Chat');

  const gone = !valid || hasCode(query.error, 'CONVERSATION_NOT_FOUND', 'BAD_REQUEST');
  useEffect(() => {
    if (gone && valid) void afterConversationGone(workspace.id, conversationId);
  }, [gone, valid, workspace.id, conversationId]);

  const back = (
    <Button asChild variant="ghost" size="sm" className="lg:hidden">
      <Link to={`/w/${workspace.slug}/chat`}>
        <ArrowLeft />
        Conversations
      </Link>
    </Button>
  );

  if (gone) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6">
        <EmptyState
          icon={<MessageSquareOff />}
          title="This conversation doesn't exist or isn't available to you"
          description="It may have been deleted, or the link is wrong."
          action={back}
        />
      </div>
    );
  }

  if (!conversation) {
    return query.isError ? (
      <div className="flex-1 p-6">
        <ErrorState error={query.error} title="We couldn't open this conversation" onRetry={() => void query.refetch()} retrying={query.isFetching} />
      </div>
    ) : (
      <div className="grid flex-1 content-start gap-4 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="ml-auto h-12 w-2/3 rounded-2xl" />
        <Skeleton className="h-24 w-5/6" />
      </div>
    );
  }

  if (!conversation.isOwner) {
    // Supervisors can read it here, but supervision has the masking and audit context.
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6">
        <EmptyState
          icon={<UserRoundSearch />}
          title="This is someone else's conversation"
          description="You can read it masked from Supervision, where every view is audited."
          action={
            can.superviseConversations ? (
              <Button asChild size="sm">
                <Link to={`/w/${workspace.slug}/supervision/${conversation.id}`}>Open in Supervision</Link>
              </Button>
            ) : (
              back
            )
          }
        />
      </div>
    );
  }

  return <OwnerThread conversation={conversation} />;
}
