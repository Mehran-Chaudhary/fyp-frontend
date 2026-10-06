import { useQuery } from '@tanstack/react-query';
import { BookOpenText, Lock, MessageSquareQuote, ScanText, ScrollText, Send, ShieldCheck, Users, Wrench } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Callout } from '@/components/ui/callout';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { configRows, type ConfigRow } from '@/lib/agents/versions';
import { PLATFORM_MAX_MESSAGES } from '@/lib/agents/agent-form';
import { llmPolicyQuery, memberNamesQuery, rolesQuery } from '@/lib/queries';
import { cn, pluralize } from '@/lib/utils';
import { KnowledgeBaseName } from '@/features/knowledge/shared/kb-identity';
import { useKnowledgeBases } from '@/features/knowledge/shared/use-knowledge-access';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { ClearanceCeilingNote, ModelName } from '../shared/agent-bits';
import { Markdown } from '../shared/markdown';
import { useAgentCan } from '../shared/use-agent-can';
import { useAgentOutlet } from './agent-context';

/** Overview (§5 routes): what the agent is, what it knows, who may use it. */
export function AgentOverviewTab() {
  const { agent, requestPublish } = useAgentOutlet();
  const location = useLocation();
  const created = (location.state as { created?: boolean } | null)?.created === true;
  const workspace = useWorkspace();
  const can = useAgentCan();
  const knowledgeBases = useKnowledgeBases();
  const policy = useQuery({ ...llmPolicyQuery(workspace.id), enabled: can.readModels });
  const roles = useQuery({ ...rolesQuery(workspace.id), enabled: can.readRoles && agent.accessMode === 'RESTRICTED' });
  const names = useQuery({ ...memberNamesQuery(workspace.id), enabled: can.readMembers && !!agent.createdById });

  const config = agent.config;
  const retrieval = config.retrieval;
  const rows = configRows(config, { knowledgeBaseName: (id) => knowledgeBases.byId.get(id)?.name });
  const bySection = (section: ConfigRow['section']) => rows.filter((row) => row.section === section);
  const creator = agent.createdById ? names.data?.get(agent.createdById) : undefined;
  const remembered = Math.min(config.memory.maxMessages, PLATFORM_MAX_MESSAGES);

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {created && agent.visibility === 'PRIVATE' ? (
        <Callout
          tone="success"
          className="animate-rise lg:col-span-2"
          title="Your agent is ready as a private draft"
          action={
            <div className="flex flex-wrap gap-2">
              {can.chat ? (
                <Button asChild size="xs" variant="secondary">
                  <Link to={`/w/${workspace.slug}/agents/${agent.id}/preview`}>
                    <ScanText />
                    Preview its prompt
                  </Link>
                </Button>
              ) : null}
              {requestPublish ? (
                <Button size="xs" onClick={requestPublish}>
                  <Send />
                  Publish
                </Button>
              ) : null}
            </div>
          }
        >
          Check exactly what the model would receive for a question, masked, before members can use it.
        </Callout>
      ) : null}
      <div className="grid min-w-0 gap-6">
        <Card>
          <CardHeader title="About" icon={<MessageSquareQuote />} />
          <div className="grid gap-4 px-5 pb-5 sm:px-6">
            {agent.description ? (
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-soft">{agent.description}</p>
            ) : (
              <p className="text-sm text-faint">No description.</p>
            )}
            <div>
              <p className="mb-1.5 text-[12px] font-medium tracking-[0.06em] text-faint uppercase">Greeting</p>
              {config.persona.greeting ? (
                <div className="max-w-xl rounded-2xl rounded-tl-md border border-line bg-well/60 px-4 py-3">
                  <Markdown source={config.persona.greeting} className="text-[13.5px]" />
                </div>
              ) : (
                <p className="text-[13px] text-faint">None. Conversations open without a greeting.</p>
              )}
              <p className="mt-1.5 text-[12px] text-muted">Shown when a conversation opens. Never sent to the model or stored.</p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Instructions"
            icon={<ScrollText />}
            description="The system prompt, as its authors wrote it. Three platform rules are always added after it."
            actions={<span className="font-mono text-xs text-faint tabular">{agent.instructions.length.toLocaleString()} / 12,000</span>}
          />
          <CardBody className="grid gap-3">
            {agent.instructions.trim() ? (
              <pre className="scrollbar-thin max-h-[28rem] overflow-auto rounded-lg border border-line bg-[#faf9f6] px-4 py-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink-soft">
                {agent.instructions}
              </pre>
            ) : (
              <p className="text-[13px] text-faint">No instructions: it follows the persona and the platform rules only.</p>
            )}
            <p className="flex items-start gap-1.5 text-[12px] leading-snug text-muted">
              <Lock className="mt-0.5 size-3.5 shrink-0 text-faint" aria-hidden />
              Everyone who can see this agent can read its instructions, so they must never contain secrets.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Behaviour" icon={<ShieldCheck />} description="The configuration of the current version." />
          <CardBody className="grid gap-5">
            {(['Persona', 'Model', 'Knowledge', 'Memory', 'Answers'] as const).map((section) => (
              <section key={section}>
                <h3 className="mb-1 text-[12px] font-medium tracking-[0.06em] text-faint uppercase">{section}</h3>
                <dl className="divide-y divide-line/70">
                  {bySection(section)
                    .filter((row) => !(row.key === 'retrieval.minScore' && retrieval.mode !== 'dense'))
                    .map((row) => (
                      <div key={row.key} className="grid gap-1 py-2 text-[13px] sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                        <dt className="text-muted">{row.label}</dt>
                        <dd className={cn('min-w-0 break-words text-ink-soft', row.key === 'model' && config.model && 'font-mono text-[12.5px]')}>
                          {row.value}
                        </dd>
                      </div>
                    ))}
                </dl>
              </section>
            ))}
          </CardBody>
        </Card>
      </div>

      <div className="grid min-w-0 gap-6">
        <Card>
          <CardHeader title="Model" />
          <CardBody className="grid gap-2 text-[13px]">
            <ModelName model={config.model} />
            {!config.model && policy.data ? (
              <p className="text-muted">
                Currently <span className="font-mono text-[12.5px] text-ink-soft">{policy.data.effective.defaultModel}</span>, and
                whatever the workspace default is at the time of each turn.
              </p>
            ) : null}
            {config.model && policy.data && policy.data.allowedModels.length > 0 && !policy.data.allowedModels.includes(config.model) ? (
              <Callout tone="warning">This model isn't on the workspace's allowed list any more, so turns fail until the agent is edited.</Callout>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Knowledge" icon={<BookOpenText />} />
          <CardBody className="grid gap-3 text-[13px]">
            {!retrieval.enabled ? (
              <p className="text-muted">Retrieval is off: it answers without searching any documents.</p>
            ) : retrieval.knowledgeBaseIds.length === 0 && retrieval.hiddenKnowledgeBases === 0 ? (
              <p className="text-muted">No knowledge bases attached, so no retrieval runs.</p>
            ) : (
              <ul className="grid gap-1.5">
                {retrieval.knowledgeBaseIds.map((id) => {
                  const knowledgeBase = knowledgeBases.byId.get(id);
                  return (
                    <li key={id} className="min-w-0">
                      {knowledgeBase ? <KnowledgeBaseName knowledgeBase={knowledgeBase} className="text-ink-soft" /> : <span className="text-muted">A knowledge base you can read</span>}
                    </li>
                  );
                })}
              </ul>
            )}
            {retrieval.hiddenKnowledgeBases > 0 ? (
              <p className="rounded-lg border border-line bg-well/60 px-3 py-2 text-[12.5px] leading-snug text-ink-soft">
                Also uses {pluralize(retrieval.hiddenKnowledgeBases, 'knowledge base')} you don't have access to. Saving keeps{' '}
                {retrieval.hiddenKnowledgeBases === 1 ? 'it' : 'them'} attached.
              </p>
            ) : null}
            <p className="text-[12.5px] leading-snug text-muted">
              It searches as the person talking to it: only the bases and classifications that person can read, so the same question
              can reach different documents for different people.
            </p>
            <ClearanceCeilingNote compact />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Memory" />
          <CardBody className="text-[13px] text-ink-soft">
            {config.memory.maxMessages === 0
              ? "It doesn't remember earlier messages: every question stands alone."
              : `It remembers the last ${pluralize(remembered, 'message')} of a conversation, within ${config.memory.maxHistoryTokens.toLocaleString()} tokens.`}
            {config.memory.maxMessages > PLATFORM_MAX_MESSAGES ? (
              <span className="mt-1 block text-[12.5px] text-muted">
                Set to {config.memory.maxMessages}; the platform caps it at {PLATFORM_MAX_MESSAGES}.
              </span>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Access" icon={<Users />} />
          <CardBody className="grid gap-2 text-[13px]">
            <p className="text-ink-soft">
              {agent.accessMode === 'RESTRICTED' ? 'Restricted to members holding one of these roles:' : 'Open to everyone who can use agents.'}
            </p>
            {agent.accessMode === 'RESTRICTED' ? (
              agent.allowedRoleIds.length === 0 ? (
                <Callout tone="warning">No roles are allowed, so nobody can use it once it's published.</Callout>
              ) : can.readRoles ? (
                <div className="flex flex-wrap gap-1.5">
                  {agent.allowedRoleIds.map((id) => (
                    <Badge key={id} tone="outline">
                      {roles.data?.find((role) => role.id === id)?.name ?? 'A role that no longer exists'}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-muted">{pluralize(agent.allowedRoleIds.length, 'role')}. Seeing their names needs role:read.</p>
              )
            ) : null}
            <p className="text-[12.5px] text-muted">
              {agent.visibility === 'PRIVATE' ? "It's a draft: only its creator and agent managers can see it." : 'It is published.'}
              {creator ? ` Created by ${creator.name}${creator.removed ? ' (no longer a member)' : ''}.` : null}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Tools" icon={<Wrench />} />
          <CardBody className="text-[13px] text-ink-soft">
            {config.tools.toolIds.length === 0
              ? 'No tools granted.'
              : `${pluralize(config.tools.toolIds.length, 'tool')} granted, up to ${pluralize(config.tools.maxIterations, 'round')} per answer.`}
            <span className="mt-1 block text-[12.5px] text-muted">Tools are managed in a later release; calls show up in conversations.</span>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
