import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { PageHeader } from '@/components/feedback/states';
import { Card } from '@/components/ui/card';
import { useDocumentTitle } from '@/lib/hooks';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { useAgentOutlet } from '../agent/agent-context';
import { ClearanceCeilingNote } from '../shared/agent-bits';
import { useAgentCan } from '../shared/use-agent-can';
import { AgentEditor } from './agent-editor';

/** /agents/new (agent:create). */
export function NewAgentPage() {
  const workspace = useWorkspace();
  const can = useAgentCan();
  useDocumentTitle('New agent');
  if (!can.createAgents) {
    return (
      <Card>
        <NoAccessState permissions={['agent:create']} workspaceName={workspace.name} title="You can't create agents" />
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        overline={
          <Link to={`/w/${workspace.slug}/agents`} className="inline-flex items-center gap-1 rounded-sm hover:text-ink">
            <ArrowLeft className="size-3.5" />
            AI agents
          </Link>
        }
        title="New agent"
        description="Only the name is required; everything else starts from the platform defaults. It's a private draft until you publish it."
      />
      <ClearanceCeilingNote />
      {!can.manageAgents ? (
        <p className="rounded-lg border border-warning-200 bg-warning-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-warning-700">
          Your role can create agents but not edit them (agent:update), so you won't be able to change or publish this one after
          creating it. Ask an administrator if you need to.
        </p>
      ) : null}
      <AgentEditor agent={null} />
    </div>
  );
}

/** /agents/:agentId/edit (agent:update). */
export function AgentEditTab() {
  const workspace = useWorkspace();
  const can = useAgentCan();
  const { agent } = useAgentOutlet();
  if (!can.manageAgents) {
    return (
      <Card>
        <NoAccessState permissions={['agent:update']} workspaceName={workspace.name} title="You can't edit agents" />
      </Card>
    );
  }
  return <AgentEditor key={agent.id} agent={agent} />;
}
