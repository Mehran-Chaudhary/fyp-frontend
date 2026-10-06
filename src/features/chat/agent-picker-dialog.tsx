import { useQuery } from '@tanstack/react-query';
import { Bot, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { Dialog, DialogBody, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { plainText } from '@/lib/agents/markdown';
import { allAgentsQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { AgentAvatar, AgentStateBadges } from '@/features/agents/shared/agent-bits';

/** "New chat": pick one of the agents you can use (§5.6 "Start"). */
export function AgentPickerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <PickerBody onPicked={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}

function PickerBody({ onPicked }: { onPicked: () => void }) {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const agents = useQuery(allAgentsQuery(workspace.id));
  const [filter, setFilter] = useState('');
  const list = (agents.data?.items ?? []).filter((agent) => agent.name.toLowerCase().includes(filter.trim().toLowerCase()));

  const pick = (agentId: string) => {
    onPicked();
    navigate(`/w/${workspace.slug}/chat/new?agent=${agentId}`);
  };

  return (
    <DialogContent size="lg">
      <DialogHeader icon={<Bot />} title="New chat" description="Choose who to talk to. Nothing is created until you send your first question." />
      <DialogBody className="grid gap-3 pt-1">
        <Input value={filter} onChange={(event) => setFilter(event.target.value)} leading={<Search />} placeholder="Search agents" aria-label="Search agents" inputClassName="h-9" autoFocus />
        {agents.isPending ? (
          <div className="grid gap-2">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : agents.isError ? (
          <ErrorState compact error={agents.error} onRetry={() => void agents.refetch()} retrying={agents.isFetching} />
        ) : list.length === 0 ? (
          <EmptyState icon={<Bot />} title={filter ? 'No agent matches' : 'No agents are available to you yet'} className="py-8" />
        ) : (
          <ul className="scrollbar-thin -mx-1 grid max-h-[55vh] gap-1 overflow-y-auto px-1">
            {list.map((agent) => (
              <li key={agent.id}>
                <button
                  type="button"
                  onClick={() => pick(agent.id)}
                  className={cn('flex w-full items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left hover:border-line hover:bg-well/50')}
                >
                  <AgentAvatar agent={agent} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-ink">{agent.name}</span>
                      <AgentStateBadges agent={agent} />
                    </span>
                    <span className="mt-0.5 line-clamp-1 block text-[12.5px] text-muted">{agent.greeting ? plainText(agent.greeting) : (agent.description ?? agent.role ?? 'No description.')}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogBody>
    </DialogContent>
  );
}
