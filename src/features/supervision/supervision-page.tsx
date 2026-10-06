import { useQuery } from '@tanstack/react-query';
import { Eye, MessagesSquare, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, Outlet, useNavigate, useSearchParams } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { EmptyState, ErrorState, PageHeader } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { Pagination } from '@/components/ui/pagination';
import { RelativeTime } from '@/components/ui/relative-time';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Table, TBody, TD, TH, THead, TR, TableMessage } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import type { Conversation, ConversationStatus } from '@/lib/api/types';
import { conversationTitle } from '@/lib/agents/messages';
import { useDocumentTitle } from '@/lib/hooks';
import { allAgentsQuery, conversationsQuery, memberNamesQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { ClassificationMark } from '@/features/agents/shared/agent-bits';
import { useAgentCan } from '@/features/agents/shared/use-agent-can';
import { DeleteConversationDialog } from '@/features/chat/conversation-dialogs';
import { OwnerLabel } from './owner-label';

const PAGE_SIZE = 25;

/** Supervision (§5.7, P4-API-12 `scope=all`): everyone's conversations, masked, every view audited. */
export function SupervisionPage() {
  const workspace = useWorkspace();
  const can = useAgentCan();
  useDocumentTitle('Supervision');
  if (!can.superviseConversations) {
    return (
      <Card>
        <NoAccessState permissions={['conversation:read_all']} workspaceName={workspace.name} title="You can't supervise conversations" />
      </Card>
    );
  }
  return (
    <>
      <List />
      <Outlet />
    </>
  );
}

function List() {
  const workspace = useWorkspace();
  const can = useAgentCan();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [deleting, setDeleting] = useState<Conversation | null>(null);
  const status: ConversationStatus | 'all' = params.get('status') === 'archived' ? 'ARCHIVED' : params.get('status') === 'active' ? 'ACTIVE' : 'all';
  const agentFilter = params.get('agent') ?? 'all';
  const pageParam = Number.parseInt(params.get('page') ?? '', 10);
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;

  const write = (patch: Record<string, string | null>) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        if (!('page' in patch)) next.delete('page');
        return next;
      },
      { replace: true, preventScrollReset: true },
    );

  const query = useQuery(
    conversationsQuery(workspace.id, 'all', {
      page,
      limit: PAGE_SIZE,
      ...(status !== 'all' ? { status } : {}),
      ...(agentFilter !== 'all' ? { agentId: agentFilter } : {}),
    }),
  );
  const agents = useQuery({ ...allAgentsQuery(workspace.id), enabled: can.browseAgents });
  const names = useQuery({ ...memberNamesQuery(workspace.id), enabled: can.readMembers });
  const items = query.data?.items ?? [];
  const search = params.toString() ? `?${params.toString()}` : '';
  const ownerName = (conversation: Conversation) =>
    conversation.ownerUserId ? (names.data?.get(conversation.ownerUserId)?.name ?? null) : null;
  const open = (conversation: Conversation) => navigate(`/w/${workspace.slug}/supervision/${conversation.id}${search}`);

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Supervision"
        description="Every conversation in the workspace, with personal data in other people's titles and messages masked. Opening one is audited."
      />
      <Callout tone="security" icon={<ShieldAlert className="size-4" />} title="Viewing is audited">
        Each list and each conversation you open is recorded. {can.revealPersonalData ? 'Revealing personal data is recorded as a critical event.' : "Revealing personal data needs pii:reveal, which your role doesn't hold."}
      </Callout>

      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <Segmented
          aria-label="Status"
          value={status}
          onValueChange={(value) => write({ status: value === 'all' ? null : value.toLowerCase() })}
          options={[
            { value: 'all', label: 'All' },
            { value: 'ACTIVE', label: 'Active' },
            { value: 'ARCHIVED', label: 'Archived' },
          ]}
        />
        {can.browseAgents ? (
          <Select
            size="sm"
            aria-label="Agent"
            className="w-full sm:ml-auto sm:w-60"
            value={agentFilter}
            onValueChange={(value) => write({ agent: value === 'all' ? null : value })}
            options={[{ value: 'all', label: 'All agents' }, ...(agents.data?.items ?? []).map((agent) => ({ value: agent.id, label: agent.name }))]}
          />
        ) : null}
      </div>

      <Card className="overflow-hidden">
        {query.isError && !query.data ? (
          <ErrorState error={query.error} title="We couldn't load the conversations" onRetry={() => void query.refetch()} retrying={query.isFetching} />
        ) : (
          <>
            {/* Narrow screens: cards. */}
            <ul className="divide-y divide-line md:hidden">
              {query.isPending
                ? Array.from({ length: 5 }, (_, index) => (
                    <li key={index} className="p-4">
                      <Skeleton className="h-12 w-full" />
                    </li>
                  ))
                : items.map((conversation) => (
                    <li key={conversation.id}>
                      <button type="button" onClick={() => open(conversation)} className="grid w-full gap-1 px-4 py-3 text-left hover:bg-well/40">
                        <span className={cn('truncate text-[13.5px] font-medium', conversation.title ? 'text-ink' : 'text-muted italic')}>{conversationTitle(conversation)}</span>
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                          <OwnerLabel conversation={conversation} name={ownerName(conversation)} canResolve={can.readMembers} />
                          <span>· {conversation.agentName ?? 'Deleted agent'}</span>
                          <span>· {conversation.messageCount} msgs</span>
                          <ClassificationMark classification={conversation.classification} />
                        </span>
                      </button>
                    </li>
                  ))}
            </ul>
            <Table wrapperClassName="hidden md:block">
              <THead>
                <tr>
                  <TH>Conversation</TH>
                  <TH>Owner</TH>
                  <TH>Agent</TH>
                  <TH className="text-right">Messages</TH>
                  <TH>Last activity</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <TBody className={cn(query.isPlaceholderData && 'opacity-60')}>
                {query.isPending ? (
                  Array.from({ length: 6 }, (_, index) => (
                    <TableMessage key={index} colSpan={6}>
                      <div className="px-6 py-3">
                        <Skeleton className="h-6 w-full" />
                      </div>
                    </TableMessage>
                  ))
                ) : items.length === 0 ? null : (
                  items.map((conversation) => (
                    <TR key={conversation.id} interactive onClick={() => open(conversation)}>
                      <TD className="max-w-[22rem]">
                        <Link
                          to={`/w/${workspace.slug}/supervision/${conversation.id}${search}`}
                          onClick={(event) => event.stopPropagation()}
                          className={cn('block truncate rounded-sm font-medium hover:text-brand-700', conversation.title ? 'text-ink' : 'text-muted italic')}
                        >
                          {conversationTitle(conversation)}
                        </Link>
                        <span className="mt-0.5 flex items-center gap-1.5">
                          {conversation.status === 'ARCHIVED' ? <span className="text-[11.5px] text-faint">Archived</span> : null}
                          <ClassificationMark classification={conversation.classification} />
                        </span>
                      </TD>
                      <TD>
                        <OwnerLabel conversation={conversation} name={ownerName(conversation)} canResolve={can.readMembers} />
                      </TD>
                      <TD className="max-w-[14rem] truncate">{conversation.agentName ?? <span className="text-faint">Deleted agent</span>}</TD>
                      <TD className="text-right font-mono tabular">{conversation.messageCount}</TD>
                      <TD>
                        <RelativeTime value={conversation.lastMessageAt} fallback="No messages" />
                      </TD>
                      <TD className="text-right">
                        <span className="inline-flex gap-1" onClick={(event) => event.stopPropagation()}>
                          <Tooltip content="Read (masked)">
                            <Button variant="ghost" size="icon-xs" aria-label="Read" onClick={() => open(conversation)}>
                              <Eye />
                            </Button>
                          </Tooltip>
                          {can.deleteConversations ? (
                            <Tooltip content="Delete">
                              <Button variant="ghost" size="icon-xs" className="text-danger-600" aria-label="Delete" onClick={() => setDeleting(conversation)}>
                                <Trash2 />
                              </Button>
                            </Tooltip>
                          ) : null}
                        </span>
                      </TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
            {!query.isPending && items.length === 0 ? (
              <EmptyState
                icon={<MessagesSquare />}
                title={status !== 'all' || agentFilter !== 'all' ? 'No conversations match' : 'No conversations yet'}
                action={
                  status !== 'all' || agentFilter !== 'all' ? (
                    <Button variant="secondary" size="sm" onClick={() => write({ status: null, agent: null })}>
                      <RotateCcw />
                      Clear filters
                    </Button>
                  ) : null
                }
              />
            ) : null}
          </>
        )}
      </Card>

      {query.data ? (
        <Pagination pagination={query.data.pagination} onPageChange={(next) => write({ page: next > 1 ? String(next) : null })} busy={query.isFetching} noun={['conversation', 'conversations']} />
      ) : null}

      <DeleteConversationDialog conversation={deleting} ownerName={deleting ? ownerName(deleting) : null} onClose={() => setDeleting(null)} />
    </div>
  );
}

