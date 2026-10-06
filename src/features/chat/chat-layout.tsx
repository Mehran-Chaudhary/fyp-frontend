import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Bot, MessageSquarePlus, MessagesSquare, MoreHorizontal, PenLine, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useMatch, useNavigate, useSearchParams } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/misc';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import type { Conversation, ConversationStatus } from '@/lib/api/types';
import { plainText } from '@/lib/agents/markdown';
import { conversationTitle } from '@/lib/agents/messages';
import { useCoarseNow, useDocumentTitle } from '@/lib/hooks';
import { allAgentsQuery, conversationsInfiniteQuery } from '@/lib/queries';
import { messageFor } from '@/lib/errors';
import { toast } from '@/lib/toast';
import { cn, formatRelative } from '@/lib/utils';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { AgentAvatar, ClassificationMark } from '@/features/agents/shared/agent-bits';
import { useAgentCan } from '@/features/agents/shared/use-agent-can';
import { AgentPickerDialog } from './agent-picker-dialog';
import { DeleteConversationDialog, RenameConversationDialog } from './conversation-dialogs';
import { useConversationActions } from './use-conversation-actions';

/**
 * Chat (§5.6–5.7): your conversations beside the open thread. On a phone, one pane
 * at a time. The page fills the viewport; each pane scrolls on its own.
 */
export function ChatLayout() {
  const workspace = useWorkspace();
  const can = useAgentCan();
  useDocumentTitle('Chat');
  const atList = useMatch('/w/:workspaceSlug/chat');

  if (!can.readOwnConversations) {
    return (
      <div className="p-6">
        <NoAccessState permissions={['conversation:read']} workspaceName={workspace.name} title="You can't use chat" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className={cn(
          'min-h-0 w-full shrink-0 flex-col border-r border-line bg-[#fbfaf7] lg:flex lg:w-[300px] xl:w-[320px]',
          atList ? 'flex' : 'hidden',
        )}
        aria-label="Conversations"
      >
        <ConversationSidebar />
      </aside>
      <section className={cn('min-h-0 min-w-0 flex-1 flex-col', atList ? 'hidden lg:flex' : 'flex')}>
        <Outlet />
      </section>
    </div>
  );
}

type StatusFilter = 'ACTIVE' | 'ARCHIVED';

function ConversationSidebar() {
  const workspace = useWorkspace();
  const can = useAgentCan();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [picking, setPicking] = useState(false);
  const [renaming, setRenaming] = useState<Conversation | null>(null);
  const [deleting, setDeleting] = useState<Conversation | null>(null);
  const openMatch = useMatch('/w/:workspaceSlug/chat/:conversationId');
  const openId = openMatch?.params.conversationId;

  const status: StatusFilter = params.get('status') === 'archived' ? 'ARCHIVED' : 'ACTIVE';
  const agentFilter = params.get('agent') ?? 'all';
  const agents = useQuery({ ...allAgentsQuery(workspace.id), enabled: can.browseAgents });
  const list = useInfiniteQuery(
    conversationsInfiniteQuery(workspace.id, 'mine', { limit: 30, status, ...(agentFilter !== 'all' ? { agentId: agentFilter } : {}) }),
  );
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const { update } = useConversationActions();

  const setFilter = (key: 'status' | 'agent', value: string | null) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const archive = (conversation: Conversation, next: ConversationStatus) =>
    update.mutate(
      { id: conversation.id, body: { status: next } },
      {
        onSuccess: () => toast.success(next === 'ARCHIVED' ? 'Archived' : 'Back in your active conversations'),
        onError: (error) => toast.error("Couldn't change it", { description: messageFor(error) }),
      },
    );

  const now = useCoarseNow();
  const groups = groupByRecency(items, now);
  const search = params.toString() ? `?${params.toString()}` : '';

  return (
    <>
      <header className="grid shrink-0 gap-3 border-b border-line px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-[15px] font-semibold text-ink">Conversations</h1>
          {can.chat ? (
            <Button size="sm" onClick={() => setPicking(true)}>
              <MessageSquarePlus />
              New chat
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Segmented
            size="xs"
            aria-label="Status"
            value={status}
            onValueChange={(value) => setFilter('status', value === 'ARCHIVED' ? 'archived' : null)}
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'ARCHIVED', label: 'Archived' },
            ]}
          />
          {can.browseAgents && (agents.data?.items.length ?? 0) > 1 ? (
            <Select
              size="sm"
              aria-label="Agent"
              className="h-8 min-w-0 flex-1 text-[12.5px]"
              value={agentFilter}
              onValueChange={(value) => setFilter('agent', value === 'all' ? null : value)}
              options={[{ value: 'all', label: 'All agents' }, ...(agents.data?.items ?? []).map((agent) => ({ value: agent.id, label: agent.name }))]}
            />
          ) : null}
        </div>
      </header>

      <nav className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 py-2" aria-label="Your conversations">
        {list.isPending ? (
          <div className="grid gap-1.5 p-2">
            {Array.from({ length: 7 }, (_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : list.isError && !list.data ? (
          <ErrorState compact error={list.error} title="We couldn't load your conversations" onRetry={() => void list.refetch()} retrying={list.isFetching} />
        ) : items.length === 0 ? (
          <EmptyState
            className="py-10"
            icon={status === 'ARCHIVED' ? <Archive /> : <MessagesSquare />}
            title={status === 'ARCHIVED' ? 'Nothing archived' : agentFilter !== 'all' ? 'No conversations with this agent' : 'No conversations yet'}
            description={status === 'ARCHIVED' ? 'Archived conversations stay readable here.' : can.chat ? 'Start one with any agent published to you.' : undefined}
          />
        ) : (
          <>
            {groups.map((group) => (
              <div key={group.label} className="mb-2">
                <p className="px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-[0.07em] text-faint uppercase">{group.label}</p>
                <ul className="grid gap-px">
                  {group.items.map((conversation) => (
                    <li key={conversation.id} className="group/row relative">
                      <NavLink
                        to={`/w/${workspace.slug}/chat/${conversation.id}${search}`}
                        className={({ isActive }) =>
                          cn(
                            'flex items-start gap-2.5 rounded-lg py-2 pr-9 pl-2.5 transition-colors',
                            isActive ? 'bg-well-strong/70' : 'hover:bg-well',
                          )
                        }
                      >
                        <AgentAvatar agent={{ id: conversation.agentId, name: conversation.agentName ?? '?' }} size="sm" className="mt-0.5" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className={cn('truncate text-[13px]', conversation.title ? 'font-medium text-ink' : 'text-muted italic')}>
                              {conversationTitle(conversation)}
                            </span>
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted">
                            <span className="truncate">{conversation.agentName ?? 'Deleted agent'}</span>
                            <span aria-hidden>·</span>
                            <span className="shrink-0">{formatRelative(conversation.lastMessageAt ?? conversation.createdAt)}</span>
                            <ClassificationMark classification={conversation.classification} />
                          </span>
                        </span>
                      </NavLink>
                      <div className={cn('absolute top-1.5 right-1.5 opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100', openId === conversation.id && 'opacity-100')}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-xs" className="text-faint" aria-label={`Actions for ${conversationTitle(conversation)}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setRenaming(conversation)}>
                              <PenLine />
                              Rename
                            </DropdownMenuItem>
                            {conversation.status === 'ACTIVE' ? (
                              <DropdownMenuItem onSelect={() => archive(conversation, 'ARCHIVED')}>
                                <Archive />
                                Archive
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onSelect={() => archive(conversation, 'ACTIVE')}>
                                <ArchiveRestore />
                                Unarchive
                              </DropdownMenuItem>
                            )}
                            {can.deleteConversations ? (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem tone="danger" onSelect={() => setDeleting(conversation)}>
                                  <Trash2 />
                                  Delete
                                </DropdownMenuItem>
                              </>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {list.hasNextPage ? (
              <div className="px-2 py-2">
                <Button variant="ghost" size="sm" className="w-full" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
                  Load more
                </Button>
              </div>
            ) : null}
          </>
        )}
      </nav>

      <AgentPickerDialog open={picking} onOpenChange={setPicking} />
      <RenameConversationDialog conversation={renaming} onClose={() => setRenaming(null)} />
      <DeleteConversationDialog
        conversation={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(id) => {
          if (id === openId) navigate(`/w/${workspace.slug}/chat${search}`, { replace: true });
        }}
      />
    </>
  );
}

function groupByRecency(items: Conversation[], now: number): Array<{ label: string; items: Conversation[] }> {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  const day = 86_400_000;
  const buckets: Array<{ label: string; from: number; items: Conversation[] }> = [
    { label: 'Today', from: today, items: [] },
    { label: 'Yesterday', from: today - day, items: [] },
    { label: 'Previous 7 days', from: today - 7 * day, items: [] },
    { label: 'Previous 30 days', from: today - 30 * day, items: [] },
    { label: 'Older', from: -Infinity, items: [] },
  ];
  for (const conversation of items) {
    const at = Date.parse(conversation.lastMessageAt ?? conversation.createdAt);
    const bucket = buckets.find((candidate) => at >= candidate.from) ?? buckets[buckets.length - 1];
    bucket.items.push(conversation);
  }
  return buckets.filter((bucket) => bucket.items.length > 0);
}

/** /chat with nothing open: pick a conversation, or start one. */
export function ChatHome() {
  const workspace = useWorkspace();
  const can = useAgentCan();
  const agents = useQuery({ ...allAgentsQuery(workspace.id), enabled: can.browseAgents && can.chat });
  const suggestions = (agents.data?.items ?? []).slice(0, 6);

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-xl text-center">
        <span className="mx-auto inline-flex size-12 items-center justify-center rounded-2xl border border-line bg-surface text-ink-soft shadow-card">
          <MessagesSquare className="size-5" aria-hidden />
        </span>
        <h2 className="mt-5 font-display text-[34px] leading-tight text-ink">Ask your agents</h2>
        <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-muted">
          Answers stream in with citations to the documents behind them. Personal data is masked before any model sees it.
        </p>
        {can.chat && suggestions.length ? (
          <ul className="mt-7 grid gap-2 text-left sm:grid-cols-2">
            {suggestions.map((agent) => (
              <li key={agent.id}>
                <Link
                  to={`/w/${workspace.slug}/chat/new?agent=${agent.id}`}
                  className="flex h-full items-start gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 shadow-card transition-colors hover:border-line-strong"
                >
                  <AgentAvatar agent={agent} size="md" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-medium text-ink">{agent.name}</span>
                    <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-muted">{agent.greeting ? plainText(agent.greeting) : (agent.description ?? 'No description.')}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : can.chat && agents.isSuccess ? (
          <EmptyState className="py-8" icon={<Bot />} title="No agents have been published to you yet" />
        ) : !can.chat ? (
          <p className="mt-6 text-[13px] text-muted">Your role can read conversations but not start them (agent:execute).</p>
        ) : null}
      </div>
    </div>
  );
}
