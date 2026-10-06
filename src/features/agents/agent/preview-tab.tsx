import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CornerDownLeft, Database, Eye, Layers, ScanText, ShieldAlert, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { RequestReference } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { Kbd } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { agentsApi } from '@/lib/api/endpoints';
import { hasCode, isApiError } from '@/lib/api/errors';
import type { PromptPreview } from '@/lib/api/types';
import { AGENT_MAX_MESSAGE_LENGTH } from '@/lib/agents/limits';
import { conversationTitle } from '@/lib/agents/messages';
import { messageFor, titleFor } from '@/lib/errors';
import { useCountdown } from '@/lib/hooks';
import { conversationsQuery } from '@/lib/queries';
import { cn, formatCountdown, pluralize } from '@/lib/utils';
import { formatMs } from '@/lib/agents/usage';
import { ClassificationBadge } from '@/features/knowledge/shared/badges';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { ContextBudget, MaskingSummary, ModelName } from '../shared/agent-bits';
import { PlaceholderChip } from '../shared/markdown';
import { useAgentCan } from '../shared/use-agent-can';
import { useAgentOutlet } from './agent-context';

const NO_HISTORY = 'none';

/**
 * Prompt preview (§5.5, P4-API-11): the masked prompt an agent would send, built
 * exactly as a turn would be, without calling the model or storing anything. The
 * result is sensitive (masked, but still internal), so it lives in this component
 * only and is gone when you leave.
 */
export function AgentPreviewTab() {
  const workspace = useWorkspace();
  const can = useAgentCan();
  if (!can.chat) {
    return (
      <Card>
        <NoAccessState permissions={['agent:execute']} workspaceName={workspace.name} title="You can't preview prompts" />
      </Card>
    );
  }
  return <Inspector />;
}

function Inspector() {
  const { agent } = useAgentOutlet();
  const workspace = useWorkspace();
  const can = useAgentCan();
  const [params] = useSearchParams();
  const [question, setQuestion] = useState('');
  const [conversationId, setConversationId] = useState<string>(params.get('conversation') ?? NO_HISTORY);
  const [result, setResult] = useState<{ preview: PromptPreview; question: string; withHistory: boolean } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null);
  const blockedFor = useCountdown(blockedUntil, () => setBlockedUntil(null));
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const conversations = useQuery({
    ...conversationsQuery(workspace.id, 'mine', { agentId: agent.id, limit: 50 }),
    enabled: can.readOwnConversations,
  });

  const content = question.trim();
  const tooLong = content.length > AGENT_MAX_MESSAGE_LENGTH;

  const run = async () => {
    if (!content || tooLong || pending || blockedFor > 0) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      const withHistory = conversationId !== NO_HISTORY;
      const preview = await agentsApi.promptPreview(
        workspace.id,
        agent.id,
        { content, ...(withHistory ? { conversationId } : {}) },
        controller.signal,
      );
      setResult({ preview, question: content, withHistory });
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(failure);
      if (hasCode(failure, 'RATE_LIMIT_EXCEEDED') && isApiError(failure)) setBlockedUntil(failure.retryDeadline(30));
      if (hasCode(failure, 'CONVERSATION_NOT_FOUND')) setConversationId(NO_HISTORY);
    } finally {
      if (request.current === controller) setPending(false);
    }
  };

  const historyOptions = [
    { value: NO_HISTORY, label: 'No history: a new conversation' },
    ...(conversations.data?.items ?? []).map((conversation) => ({
      value: conversation.id,
      label: conversationTitle(conversation),
      description: `${pluralize(conversation.messageCount, 'message')}${conversation.status === 'ARCHIVED' ? ' · archived' : ''}`,
    })),
  ];

  return (
    <div className="grid grid-cols-1 gap-6">
      <Card>
        <CardHeader
          title="Preview the prompt"
          icon={<ScanText />}
          description="Builds a turn exactly as sending would: retrieval as you, the context budget, masking and the egress check. It calls no model and stores nothing."
        />
        <form
          noValidate
          className="grid gap-4 px-5 pb-5 sm:px-6"
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
        >
          <Field
            label="Question"
            error={tooLong ? `Use no more than ${AGENT_MAX_MESSAGE_LENGTH.toLocaleString()} characters.` : undefined}
            labelAside={<span className={cn('text-xs tabular', tooLong ? 'text-danger-700' : 'text-faint')}>{content.length.toLocaleString()}/{AGENT_MAX_MESSAGE_LENGTH.toLocaleString()}</span>}
          >
            <Textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void run();
                }
              }}
              rows={3}
              placeholder="How many days of annual leave do I get, and who is the HR business partner?"
              autoFocus
            />
          </Field>
          {can.readOwnConversations ? (
            <Field label="Include history" hint="Your own conversations with this agent only: the history is included as the next turn would see it.">
              <Select value={conversationId} onValueChange={setConversationId} options={historyOptions} />
            </Field>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={pending} disabled={!content || tooLong || blockedFor > 0}>
              {pending ? null : <Eye />}
              {blockedFor > 0 ? `Try again in ${formatCountdown(blockedFor)}` : 'Build the prompt'}
            </Button>
            <span className="hidden items-center gap-1 text-xs text-faint sm:inline-flex">
              <Kbd>Ctrl</Kbd>
              <Kbd>
                <CornerDownLeft className="size-3" />
              </Kbd>
            </span>
            <span className="text-[12px] text-muted">Shares the 60-a-minute search limit.</span>
          </div>
          {error ? (
            <Callout
              tone={hasCode(error, 'RATE_LIMIT_EXCEEDED') ? 'warning' : 'danger'}
              title={titleFor(error, "Couldn't build the prompt")}
              role="alert"
            >
              {messageFor(error)}
              {isApiError(error) && hasCode(error, 'VALIDATION_FAILED') ? null : <RequestReference requestId={isApiError(error) ? error.requestId : undefined} className="ml-2" />}
            </Callout>
          ) : null}
        </form>
      </Card>

      {result ? <PreviewResult preview={result.preview} withHistory={result.withHistory} /> : null}
    </div>
  );
}

function PreviewResult({ preview, withHistory }: { preview: PromptPreview; withHistory: boolean }) {
  const { redaction, retrieval } = preview;
  const findings = redaction.egressFindings.length;

  return (
    <div className="grid grid-cols-1 gap-6 animate-rise xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card className="min-w-0">
        <CardHeader
          title="What the model would receive"
          icon={<Layers />}
          description={`${pluralize(preview.messages.length, 'message')}, masked. Treat it as internal: it isn't kept anywhere and disappears when you leave.`}
        />
        <CardBody className="grid gap-3">
          {preview.messages.map((message, index) => (
            <PromptMessage key={index} role={message.role} content={message.content} label={roleLabel(index, preview.messages.length, message.role, withHistory)} />
          ))}
        </CardBody>
      </Card>

      <div className="grid min-w-0 content-start gap-6">
        <Card>
          <CardHeader title="Turn" />
          <CardBody>
            <dl className="divide-y divide-line/70 text-[13px]">
              <Row label="Model">
                <ModelName model={preview.model} />
              </Row>
              <Row label="Agent version">v{preview.agentVersion}</Row>
              <Row label="Prompt template">v{preview.promptTemplateVersion}</Row>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Retrieval" icon={<Database />} />
          <CardBody>
            {retrieval ? (
              <dl className="divide-y divide-line/70 text-[13px]">
                <Row label="Bases searched">{retrieval.knowledgeBasesSearched}</Row>
                <Row label="Passages">
                  {retrieval.passagesIncluded} of {retrieval.passagesRetrieved} included
                </Row>
                <Row label="Your reach">
                  <ClassificationBadge classification={retrieval.effectiveClearance} withTooltip />
                </Row>
              </dl>
            ) : (
              <p className="text-[13px] text-muted">No retrieval ran: retrieval is off, or no knowledge base you can read is attached.</p>
            )}
            {retrieval ? (
              <p className="mt-2 text-[12px] leading-snug text-muted">
                Your reach is the lowest of your clearance, the agent's cap and the model endpoint's ceiling. Someone else asking the same
                question may reach different documents.
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Masking" icon={<ShieldAlert />} />
          <CardBody className="grid gap-3">
            <MaskingSummary redaction={redaction} />
            {findings === 0 ? (
              <p className="flex items-center gap-1.5 text-[12.5px] text-success-700">
                <CircleCheck className="size-3.5" aria-hidden />
                Egress check: nothing sensitive left in the payload.
              </p>
            ) : (
              <p className="flex items-start gap-1.5 text-[12.5px] text-danger-700">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                The egress check found {pluralize(findings, 'item')} that survived masking. A real turn would be stopped before reaching the
                model.
              </p>
            )}
            <dl className="divide-y divide-line/70 text-[12.5px]">
              <Row label="Occurrences">{redaction.occurrences}</Row>
              <Row label="Masking time">{formatMs(redaction.timings.totalMs)}</Row>
              {redaction.detectors.length ? (
                <Row label="Detectors">
                  <span className="grid justify-items-end gap-0.5 font-mono text-[11.5px]">
                    {redaction.detectors.map((detector) => (
                      <span key={detector} className="break-all">
                        {detector}
                      </span>
                    ))}
                  </span>
                </Row>
              ) : null}
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Context budget" />
          <CardBody>
            <ContextBudget context={preview.context} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function roleLabel(index: number, count: number, role: string, withHistory: boolean): string {
  if (index === 0 && role === 'system') return 'System prompt';
  if (index === count - 1 && role === 'user') return 'This question, with its retrieved context';
  if (withHistory) return role === 'assistant' ? 'History · answer' : 'History · question';
  return role;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-ink-soft">{children}</dd>
    </div>
  );
}

const TOKEN = /(\[[A-Z][A-Z0-9_]*_\d+\])|(<\/?context>|<source\b[^>]*>|<\/source>)/g;

/** One masked message: placeholders as chips, the `<context>` scaffolding dimmed. Plain text only. */
function PromptMessage({ role, content, label }: { role: string; content: string; label: string }) {
  const parts = useMemo(() => {
    const out: Array<{ kind: 'text' | 'placeholder' | 'tag'; text: string }> = [];
    let last = 0;
    for (const match of content.matchAll(TOKEN)) {
      const at = match.index ?? 0;
      if (at > last) out.push({ kind: 'text', text: content.slice(last, at) });
      out.push({ kind: match[1] ? 'placeholder' : 'tag', text: match[0] });
      last = at + match[0].length;
    }
    if (last < content.length) out.push({ kind: 'text', text: content.slice(last) });
    return out;
  }, [content]);

  return (
    <section className="overflow-hidden rounded-lg border border-line">
      <header className="flex items-center justify-between gap-2 border-b border-line bg-well/50 px-3 py-1.5">
        <span className="flex items-center gap-2">
          <Badge tone={role === 'system' ? 'info' : role === 'assistant' ? 'neutral' : 'brand'}>{role}</Badge>
          <span className="text-[12px] text-muted">{label}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-faint tabular">{content.length.toLocaleString()} chars</span>
          <CopyButton value={content} size="xs" variant="ghost" iconOnly label="Copy masked message" />
        </span>
      </header>
      <pre className="scrollbar-thin max-h-[30rem] overflow-auto bg-[#fcfbf9] px-3.5 py-3 font-mono text-[12px] leading-[1.7] whitespace-pre-wrap text-ink-soft">
        {parts.map((part, index) =>
          part.kind === 'placeholder' ? (
            <PlaceholderChip key={index} placeholder={part.text} className="text-[10.5px]" />
          ) : part.kind === 'tag' ? (
            <span key={index} className="text-info-600/80">
              {part.text}
            </span>
          ) : (
            <span key={index}>{part.text}</span>
          ),
        )}
      </pre>
    </section>
  );
}
