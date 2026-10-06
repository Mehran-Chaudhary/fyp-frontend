import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Brain,
  MoreHorizontal,
  PenLine,
  RefreshCw,
  ScanText,
  Send,
  ShieldAlert,
  Trash2,
  Unplug,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { RequestReference } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import type { Agent, Conversation } from '@/lib/api/types';
import { PLATFORM_MAX_MESSAGES } from '@/lib/agents/agent-form';
import { conversationTitle } from '@/lib/agents/messages';
import { failureAsError, remedyFor, stageLabel } from '@/lib/agents/turn';
import { messageFor, titleFor } from '@/lib/errors';
import { useCountdown, useNow } from '@/lib/hooks';
import { cn, formatCountdown, pluralize } from '@/lib/utils';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { AgentAvatar, ClassificationMark, ClearanceCeilingNote } from '@/features/agents/shared/agent-bits';
import { Markdown } from '@/features/agents/shared/markdown';
import { useAgentCan } from '@/features/agents/shared/use-agent-can';
import { ToolCallChips, UserBubble } from './message-view';
import type { TurnController, TurnPhase } from './use-turn';

// ── Header ──────────────────────────────────────────────────────────────────

export function ThreadHeader({
  conversation,
  agent,
  onRename,
  onArchive,
  onDelete,
}: {
  conversation: Conversation;
  agent: Agent | null;
  onRename?: () => void;
  onArchive?: (next: 'ACTIVE' | 'ARCHIVED') => void;
  onDelete?: () => void;
}) {
  const workspace = useWorkspace();
  const can = useAgentCan();
  const base = `/w/${workspace.slug}`;
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface/80 px-3 py-2.5 backdrop-blur sm:px-5">
      <Button asChild variant="ghost" size="icon-sm" className="-ml-1 lg:hidden" aria-label="All conversations">
        <Link to={`${base}/chat`}>
          <ArrowLeft />
        </Link>
      </Button>
      <AgentAvatar agent={{ id: conversation.agentId, name: conversation.agentName ?? '?' }} size="md" />
      <div className="min-w-0 flex-1">
        <h2 className={cn('truncate text-[14.5px] leading-5 font-semibold', conversation.title ? 'text-ink' : 'text-muted')}>{conversationTitle(conversation)}</h2>
        <p className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
          {agent && can.browseAgents ? (
            <Link to={`${base}/agents/${conversation.agentId}`} className="truncate rounded-sm hover:text-ink hover:underline">
              {conversation.agentName ?? agent.name}
            </Link>
          ) : (
            <span className="truncate">{conversation.agentName ?? 'Deleted agent'}</span>
          )}
          {conversation.messageCount ? <span className="shrink-0">· {pluralize(conversation.messageCount, 'message')}</span> : null}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <ClassificationMark classification={conversation.classification} />
        {conversation.status === 'ARCHIVED' ? (
          <Badge tone="outline">
            <Archive />
            Archived
          </Badge>
        ) : null}
        {conversation.isOwner && (onRename || onArchive || onDelete) ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Conversation actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onRename ? (
                <DropdownMenuItem onSelect={onRename}>
                  <PenLine />
                  Rename
                </DropdownMenuItem>
              ) : null}
              {onArchive ? (
                conversation.status === 'ACTIVE' ? (
                  <DropdownMenuItem onSelect={() => onArchive('ARCHIVED')}>
                    <Archive />
                    Archive
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => onArchive('ACTIVE')}>
                    <ArchiveRestore />
                    Unarchive
                  </DropdownMenuItem>
                )
              ) : null}
              {agent && can.chat ? (
                <DropdownMenuItem asChild>
                  <Link to={`${base}/agents/${conversation.agentId}/preview?conversation=${conversation.id}`}>
                    <ScanText />
                    Preview the next prompt
                  </Link>
                </DropdownMenuItem>
              ) : null}
              {onDelete ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem tone="danger" onSelect={onDelete}>
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </header>
  );
}

// ── The greeting: a banner, never a message (§4.1, §5.6) ────────────────────

export function GreetingBanner({ agent, name }: { agent: Agent | null; name: string }) {
  const greeting = agent?.config.persona.greeting;
  const remembered = agent ? Math.min(agent.config.memory.maxMessages, PLATFORM_MAX_MESSAGES) : null;
  return (
    <div className="grid justify-items-center gap-3 py-4 text-center">
      <AgentAvatar agent={{ id: agent?.id ?? name, name }} size="lg" />
      <div>
        <p className="text-[15px] font-semibold text-ink">{name}</p>
        {agent?.config.persona.role ? <p className="text-[13px] text-muted">{capitalize(agent.config.persona.role)}</p> : null}
      </div>
      {greeting ? (
        <div className="max-w-lg rounded-2xl border border-line bg-surface px-4 py-3 text-left shadow-card">
          <Markdown source={greeting} className="text-[13.5px]" />
        </div>
      ) : null}
      {agent ? (
        <p className="flex items-center gap-1.5 text-[12px] text-muted">
          <Brain className="size-3.5 text-faint" aria-hidden />
          {remembered === 0 ? "Doesn't remember earlier messages: every question stands alone." : `Remembers the last ${pluralize(remembered ?? 0, 'message')} of this conversation.`}
        </p>
      ) : null}
      <ClearanceCeilingNote compact className="max-w-md justify-center text-center" />
    </div>
  );
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

// ── The turn in progress ────────────────────────────────────────────────────

export interface PendingActions {
  onRetry: () => void;
  /** Moves the question back into the composer. */
  onEdit: () => void;
  onUnarchive?: () => void;
  newConversationHref?: string;
}

/**
 * The question being answered and its live answer (§4.4): stage labels, streamed
 * text, tool calls. After a failure, why, and what can be done (§4.9, §10).
 */
export function PendingTurn({ turn, agentName, questionStored, actions }: { turn: TurnController; agentName: string; questionStored: boolean; actions: PendingActions }) {
  const { phase } = turn;
  if (phase.kind === 'idle') return null;
  const question = phase.question;

  if (phase.kind === 'failed') {
    return (
      <UserBubble content={question.content} tone="failed" status={<span className="text-danger-700">Not answered</span>}>
        <FailureCard phase={phase} actions={actions} />
      </UserBubble>
    );
  }
  if (phase.kind === 'lost') {
    return (
      <UserBubble content={question.content} tone="failed" status={<span className="text-warning-700">Connection lost</span>}>
        <div className="mt-1 w-full max-w-[min(42rem,88%)] rounded-xl border border-warning-200 bg-warning-50/60 px-3.5 py-3 text-left text-[13px] text-warning-700">
          <p className="flex items-center gap-1.5 font-semibold">
            <Unplug className="size-3.5" aria-hidden />
            The answer didn't arrive, and the conversation doesn't show this question.
          </p>
          <p className="mt-1 text-ink-soft">Sending it again is safe: if it did get through after all, it won't be asked twice.</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button size="xs" onClick={actions.onRetry}>
              <Send />
              Send again
            </Button>
            <Button size="xs" variant="ghost" onClick={actions.onEdit}>
              <PenLine />
              Edit
            </Button>
          </div>
        </div>
      </UserBubble>
    );
  }

  const { view } = phase;
  const label =
    phase.kind === 'reconciling'
      ? phase.why === 'stopped'
        ? 'Stopping… checking what was kept'
        : 'Checking what was saved…'
      : phase.kind === 'waiting'
        ? 'The server is still answering. Checking every few seconds…'
        : view.phase === 'sending'
          ? 'Sending…'
          : (stageLabel(view.stage, view.activeTool) ?? (view.text ? 'Writing…' : 'Starting…'));

  return (
    <>
      {questionStored ? null : <UserBubble content={question.content} tone="pending" status={view.meta ? null : 'Sending…'} />}
      <article className="flex flex-col gap-2" aria-busy="true" aria-label={`${agentName} is answering`}>
        {view.text ? (
          <Markdown
            source={view.text}
            streaming={phase.kind === 'running'}
            renderCitation={(tag) => (
              <sup className="mx-0.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-[5px] border border-line-strong bg-well px-1 font-mono text-[10.5px] text-muted">
                {tag.replace(/^S/, '')}
              </sup>
            )}
          />
        ) : null}
        {view.tools.length || view.activeTool ? <ToolCallChips calls={view.tools} active={view.activeTool} /> : null}
        <StageLine label={label} phase={phase} />
        {phase.kind === 'waiting' ? (
          <p className="text-[12px] text-muted">
            The question was saved, but the answer isn't in yet. It will appear here when the server finishes.{' '}
            <button type="button" className="font-medium text-brand-700 underline underline-offset-2" onClick={turn.stopWaiting}>
              Stop waiting
            </button>
          </p>
        ) : null}
      </article>
    </>
  );
}

function StageLine({ label, phase }: { label: string; phase: Exclude<TurnPhase, { kind: 'idle' | 'failed' | 'lost' }> }) {
  const now = useNow();
  const startedAt = phase.kind === 'running' || phase.kind === 'waiting' ? phase.startedAt : null;
  const elapsed = startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
  const queue = phase.view.queue;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
      <Spinner className="size-3.5 text-brand-600" />
      <span>{label}</span>
      {phase.view.stage === 'queued' && queue && queue.waiting > 0 ? (
        <span className="text-faint">
          {pluralize(queue.waiting, 'request')} ahead · {queue.inUse}/{queue.capacity} in use
        </span>
      ) : null}
      {elapsed >= 5 ? <span className="font-mono text-[11.5px] text-faint tabular">{formatCountdown(elapsed)}</span> : null}
    </p>
  );
}

function FailureCard({ phase, actions }: { phase: Extract<TurnPhase, { kind: 'failed' }>; actions: PendingActions }) {
  const workspace = useWorkspace();
  const can = useCan();
  const { failure, advice } = phase;
  const error = failureAsError(failure);
  const waitLeft = useCountdown(phase.retryAt);
  const remedy = remedyFor(failure.code);
  const waiting = advice.retry === 'wait' && waitLeft > 0;
  const tone = advice.retry === 'wait' ? 'warning' : 'danger';

  let action: ReactNode = null;
  if (remedy === 'unarchive' && actions.onUnarchive) {
    action = (
      <Button size="xs" onClick={actions.onUnarchive}>
        <ArchiveRestore />
        Unarchive and send
      </Button>
    );
  } else if (remedy === 'new-conversation' && actions.newConversationHref) {
    action = (
      <Button asChild size="xs">
        <Link to={actions.newConversationHref}>Start a new conversation</Link>
      </Button>
    );
  } else if (advice.retry !== 'none' && advice.safeToResend) {
    action = (
      <Button size="xs" onClick={actions.onRetry} disabled={waiting}>
        <RefreshCw />
        {waiting ? `Try again in ${formatCountdown(waitLeft)}` : 'Try again'}
      </Button>
    );
  }

  return (
    <div
      role="alert"
      className={cn(
        'mt-1 w-full max-w-[min(42rem,88%)] rounded-xl border px-3.5 py-3 text-left text-[13px]',
        tone === 'warning' ? 'border-warning-200 bg-warning-50/60 text-warning-700' : 'border-danger-200 bg-danger-50/60 text-danger-700',
      )}
    >
      <p className="font-semibold">{titleFor(error, "Couldn't answer")}</p>
      <p className="mt-0.5 text-ink-soft">{messageFor(error)}</p>
      {advice.retry === 'wait' ? (
        <p className="mt-1 text-[12.5px] text-muted">
          Nothing was stored.{' '}
          {waiting ? (phase.auto ? `Trying again by itself in ${formatCountdown(waitLeft)}.` : `You can try again in ${formatCountdown(waitLeft)}.`) : 'You can try again now.'}
        </p>
      ) : advice.safeToResend && remedy === null && advice.retry === 'manual' ? (
        <p className="mt-1 text-[12.5px] text-muted">Nothing was stored, so trying again won't ask twice.</p>
      ) : null}
      {failure.code === 'PII_DETECTION_UNAVAILABLE' && can('pii:policy:update') ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-[12.5px] text-ink-soft">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            The workspace refuses to send text it can't mask. Its privacy policy can allow pattern-only masking while detection is down:{' '}
            <Link to={`/w/${workspace.slug}/settings/privacy`} className="font-medium underline underline-offset-2">
              privacy settings
            </Link>
            .
          </span>
        </p>
      ) : null}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {action}
        <Button size="xs" variant="ghost" onClick={actions.onEdit}>
          <PenLine />
          {remedy === 'shorten' ? 'Shorten it' : 'Edit'}
        </Button>
        <RequestReference requestId={failure.requestId} />
      </div>
    </div>
  );
}
