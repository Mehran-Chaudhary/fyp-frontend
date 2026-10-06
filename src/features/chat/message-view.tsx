import {
  CircleAlert,
  CircleCheck,
  CircleSlash,
  EyeOff,
  FileQuestion,
  FileText,
  Info,
  ShieldAlert,
  CircleStop,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip } from '@/components/ui/tooltip';
import type { Citation, Message, ToolCallRecord, TurnResult } from '@/lib/api/types';
import { messageNotice, partitionCitations, WITHHELD_DETAIL } from '@/lib/agents/messages';
import { formatMs } from '@/lib/agents/usage';
import { cn, formatDateTime, formatTime, pluralize } from '@/lib/utils';
import { ClassificationBadge } from '@/features/knowledge/shared/badges';
import { KnowledgeBaseDot } from '@/features/knowledge/shared/kb-identity';
import { useKnowledgeBases } from '@/features/knowledge/shared/use-knowledge-access';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { ContextBudget, MaskingSummary, ModelName } from '@/features/agents/shared/agent-bits';
import { Markdown, PlaceholderChip } from '@/features/agents/shared/markdown';
import { useAgentCan } from '@/features/agents/shared/use-agent-can';

const PLACEHOLDER = /(\[[A-Z][A-Z0-9_]*_\d+\])/g;

/** Plain text with masked placeholders drawn as chips. Questions are never Markdown. */
export function PlainText({ text, className }: { text: string; className?: string }) {
  const parts = useMemo(() => text.split(PLACEHOLDER), [text]);
  return (
    <p className={cn('text-[14px] leading-[1.65] break-words whitespace-pre-wrap', className)}>
      {parts.map((part, index) => (index % 2 === 1 ? <PlaceholderChip key={index} placeholder={part} /> : <span key={index}>{part}</span>))}
    </p>
  );
}

// ── Questions ───────────────────────────────────────────────────────────────

export function UserBubble({
  content,
  status,
  tone = 'normal',
  children,
  time,
}: {
  content: string;
  /** "Sending…", "Not sent"… shown under the bubble. */
  status?: ReactNode;
  tone?: 'normal' | 'pending' | 'failed';
  children?: ReactNode;
  time?: string;
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div
        className={cn(
          'max-w-[min(42rem,88%)] rounded-2xl rounded-br-md border px-4 py-2.5 text-ink',
          tone === 'failed' ? 'border-danger-200 bg-danger-50/50' : 'border-brand-200 bg-brand-50/80',
          tone === 'pending' && 'opacity-80',
        )}
      >
        <PlainText text={content} />
      </div>
      {status || time ? (
        <p className="flex items-center gap-1.5 text-[11.5px] text-faint">
          {status}
          {time ? <time dateTime={time}>{formatTime(time)}</time> : null}
        </p>
      ) : null}
      {children}
    </div>
  );
}

// ── Notices (§4.7) ──────────────────────────────────────────────────────────

/** A withheld message: a quiet row with the reason, never an error. */
export function WithheldRow({ message }: { message: Message }) {
  const notice = messageNotice(message);
  return (
    <div className={cn('flex', message.role === 'USER' ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'flex max-w-[min(36rem,88%)] items-start gap-2 rounded-xl border border-dashed px-3.5 py-2.5 text-[13px]',
          notice?.tone === 'warning' ? 'border-warning-200 bg-warning-50/40 text-warning-700' : 'border-line-strong bg-well/40 text-muted',
        )}
      >
        <EyeOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0">
          {notice?.text ?? 'Hidden from you.'}
          {message.withheldReason ? (
            <Tooltip content={WITHHELD_DETAIL[message.withheldReason]}>
              <button type="button" className="ml-1 inline-flex translate-y-[2px] rounded text-faint hover:text-ink" aria-label="Why?">
                <Info className="size-3.5" />
              </button>
            </Tooltip>
          ) : null}
          <span className="mt-0.5 block text-[11.5px] text-faint">
            {message.role === 'USER' ? 'Question' : 'Answer'} · {formatTime(message.createdAt)}
          </span>
        </span>
      </div>
    </div>
  );
}

function NoticeLine({ message, degraded }: { message: Message; degraded: boolean }) {
  const notice = messageNotice(message);
  const parts: ReactNode[] = [];
  if (notice && message.contentState !== 'WITHHELD') {
    const Icon = notice.tone === 'danger' ? CircleAlert : notice.tone === 'warning' ? CircleStop : ShieldAlert;
    parts.push(
      <span
        key="status"
        className={cn(
          'inline-flex items-center gap-1.5',
          notice.tone === 'danger' ? 'text-danger-700' : notice.tone === 'warning' ? 'text-warning-700' : 'text-info-700',
        )}
      >
        <Icon className="size-3.5" aria-hidden />
        {notice.text}
        {message.errorCode && message.status === 'FAILED' ? <code className="font-mono text-[11px] opacity-80">{message.errorCode}</code> : null}
      </span>,
    );
  }
  if (degraded) {
    parts.push(
      <Tooltip key="degraded" content="Names couldn't be detected when this was answered, so only patterns (emails, phone and card numbers…) were masked before the model saw it.">
        <span tabIndex={0} className="inline-flex items-center gap-1.5 text-warning-700">
          <TriangleAlert className="size-3.5" aria-hidden />
          Names weren't masked for this answer
        </span>
      </Tooltip>,
    );
  }
  if (!parts.length) return null;
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">{parts}</div>;
}

// ── Answers ─────────────────────────────────────────────────────────────────

/** An assistant message from history: Markdown, citations, tools, notices and details. */
export function AssistantMessage({
  message,
  result,
  agentName,
}: {
  message: Message;
  /** The full TurnResult, for answers produced in this session (tokens, timings, budget). */
  result?: TurnResult;
  agentName: string;
}) {
  const anchor = `msg-${message.id}`;
  const content = message.content ?? '';
  return (
    <article className="group/answer flex flex-col gap-2" aria-label={`Answer from ${agentName}`}>
      {content ? (
        <Markdown
          source={content}
          renderCitation={(tag) => <CitationMark tag={tag} citation={message.citations.find((citation) => citation.tag === tag) ?? null} anchor={anchor} />}
        />
      ) : message.status === 'COMPLETE' ? (
        <p className="text-[13px] text-faint">An empty answer.</p>
      ) : null}
      <NoticeLine message={message} degraded={!!message.redaction?.degraded} />
      {message.toolCalls.length ? <ToolCallChips calls={message.toolCalls} /> : null}
      {message.citations.length ? <SourcesList citations={message.citations} anchor={anchor} /> : null}
      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-faint">
        <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
        {message.agentVersion ? <span>v{message.agentVersion}</span> : null}
        {message.redaction?.enabled && message.redaction.entities > 0 ? (
          <span className="inline-flex items-center gap-1">
            <ShieldAlert className="size-3" aria-hidden />
            {pluralize(message.redaction.entities, 'detail')} masked
          </span>
        ) : null}
        <TurnDetails message={message} result={result} />
      </footer>
    </article>
  );
}

/** `[S2]` as a small superscript link to its source below the answer. */
export function CitationMark({ tag, citation, anchor }: { tag: string; citation: Citation | null; anchor: string }) {
  const label = tag.replace(/^S/, '');
  if (!citation) {
    return (
      <Tooltip content="The answer cites a source it wasn't given.">
        <sup tabIndex={0} className="mx-0.5 rounded px-1 font-mono text-[10.5px] text-faint">
          [{tag}]
        </sup>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={citation.documentTitle ?? 'A document that no longer exists'}>
      <a
        href={`#${anchor}-${tag}`}
        onClick={(event) => {
          event.preventDefault();
          const target = document.getElementById(`${anchor}-${tag}`);
          if (!target) return;
          const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'nearest' });
          target.classList.remove('animate-highlight');
          void target.offsetWidth;
          target.classList.add('animate-highlight');
          target.focus({ preventScroll: true });
        }}
        className="mx-0.5 inline-flex h-[17px] min-w-[17px] -translate-y-[3px] items-center justify-center rounded-[5px] border border-brand-200 bg-brand-50 px-1 font-mono text-[10.5px] leading-none font-semibold text-brand-700 no-underline hover:border-brand-400 hover:bg-brand-100"
        aria-label={`Source ${label}: ${citation.documentTitle ?? 'a deleted document'}`}
      >
        {label}
      </a>
    </Tooltip>
  );
}

/** The sources an answer cited first, then the rest it was given (§5.6 "Citations"). */
export function SourcesList({ citations, anchor }: { citations: readonly Citation[]; anchor: string }) {
  const { cited, consulted } = partitionCitations(citations);
  const top = Math.max(...citations.map((citation) => citation.score), 0);
  return (
    <div className="grid gap-2 pt-1">
      {cited.length ? <SourceGroup title="Sources" citations={cited} anchor={anchor} top={top} /> : null}
      {consulted.length ? (
        <details className="group/consulted">
          <summary className="w-fit cursor-pointer list-none rounded text-[12px] font-medium text-muted hover:text-ink [&::-webkit-details-marker]:hidden">
            <span className="group-open/consulted:hidden">Also consulted ({consulted.length})</span>
            <span className="hidden group-open/consulted:inline">Also consulted</span>
          </summary>
          <div className="mt-2">
            <SourceGroup citations={consulted} anchor={anchor} top={top} quiet />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function SourceGroup({ title, citations, anchor, top, quiet }: { title?: string; citations: Citation[]; anchor: string; top: number; quiet?: boolean }) {
  const workspace = useWorkspace();
  const can = useAgentCan();
  const knowledgeBases = useKnowledgeBases();
  return (
    <div>
      {title ? <p className="mb-1.5 text-[11px] font-medium tracking-[0.07em] text-faint uppercase">{title}</p> : null}
      <ol className="grid gap-1.5 sm:grid-cols-2">
        {citations.map((citation) => {
          const knowledgeBase = knowledgeBases.byId.get(citation.knowledgeBaseId);
          const gone = citation.documentTitle === null;
          const body = (
            <>
              <span className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[5px] border border-line-strong bg-surface px-1 font-mono text-[10.5px] font-semibold text-ink-soft">
                {citation.tag.replace(/^S/, '')}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('flex items-center gap-1.5 truncate text-[12.5px] font-medium', gone ? 'text-faint italic' : 'text-ink')}>
                  {gone ? <FileQuestion className="size-3.5 shrink-0" aria-hidden /> : <FileText className="size-3.5 shrink-0 text-faint" aria-hidden />}
                  <span className="truncate">{citation.documentTitle ?? 'A document that no longer exists'}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted">
                  <KnowledgeBaseDot id={citation.knowledgeBaseId} />
                  <span className="truncate">{knowledgeBase?.name ?? 'Knowledge base'}</span>
                </span>
              </span>
              {/* Relative to this answer's best match only: never a percentage (§5.6). */}
              <span className="h-1 w-8 shrink-0 self-center overflow-hidden rounded-full bg-well-strong" aria-label={`Match rank ${citation.rank}`}>
                <span className="block h-full rounded-full bg-brand-400" style={{ width: `${top > 0 ? Math.max(8, (citation.score / top) * 100) : 0}%` }} />
              </span>
            </>
          );
          const className = cn(
            'flex items-start gap-2 rounded-lg border px-2.5 py-2 outline-offset-2 transition-colors',
            quiet ? 'border-line/70 bg-transparent' : 'border-line bg-surface',
          );
          return (
            <li key={citation.tag} id={`${anchor}-${citation.tag}`} tabIndex={-1} className="rounded-lg">
              {can.readDocuments && !gone ? (
                <Link to={`/w/${workspace.slug}/documents/${citation.documentId}`} className={cn(className, 'hover:border-line-strong hover:bg-well/40')}>
                  {body}
                </Link>
              ) : (
                <div className={className}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ── Tools (§4.10, display only) ─────────────────────────────────────────────

export function ToolCallChips({ calls, active }: { calls: readonly ToolCallRecord[]; active?: string | null }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Tool calls">
      {calls.map((call) => {
        const Icon = call.status === 'ok' ? CircleCheck : call.status === 'denied' ? CircleSlash : CircleAlert;
        const chip = (
          <span
            tabIndex={call.reason || call.code ? 0 : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11.5px]',
              call.status === 'ok' && 'border-line bg-well/60 text-ink-soft',
              call.status === 'denied' && 'border-warning-200 bg-warning-50 text-warning-700',
              call.status === 'error' && 'border-danger-200 bg-danger-50 text-danger-700',
            )}
          >
            <Wrench className="size-3 opacity-70" aria-hidden />
            {call.tool} · {formatMs(call.durationMs)} · <Icon className="size-3" aria-hidden />
            {call.status}
          </span>
        );
        return (
          <li key={call.executionId}>
            {call.reason || call.code ? <Tooltip content={[call.reason, call.code].filter(Boolean).join(' · ')}>{chip}</Tooltip> : chip}
          </li>
        );
      })}
      {active ? (
        <li>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-info-200 bg-info-50 px-2 py-0.5 font-mono text-[11.5px] text-info-700">
            <Wrench className="size-3 animate-pulse motion-reduce:animate-none" aria-hidden />
            {active} · running
          </span>
        </li>
      ) : null}
    </ul>
  );
}

// ── Per-turn details (§5.6) ─────────────────────────────────────────────────

function TurnDetails({ message, result }: { message: Message; result?: TurnResult }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="rounded text-faint underline decoration-line-strong underline-offset-2 hover:text-ink">
          Details
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(24rem,calc(100vw-2rem))] p-0" align="start">
        <div className="scrollbar-thin grid max-h-[70vh] gap-3 overflow-y-auto p-4 text-[12.5px]">
          <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
            <dt className="text-muted">Model</dt>
            <dd className="min-w-0">
              <ModelName model={message.model} fallback="—" className="text-[12px]" />
            </dd>
            <dt className="text-muted">Agent version</dt>
            <dd>{message.agentVersion ? `v${message.agentVersion}` : '—'}</dd>
            <dt className="text-muted">Draws on</dt>
            <dd>
              <ClassificationBadge classification={message.classification} withTooltip />
            </dd>
            <dt className="text-muted">Written</dt>
            <dd>{formatDateTime(message.createdAt)}</dd>
            {message.errorCode ? (
              <>
                <dt className="text-muted">Ended with</dt>
                <dd className="font-mono text-[11.5px]">{message.errorCode}</dd>
              </>
            ) : null}
            {result ? (
              <>
                <dt className="text-muted">Tokens</dt>
                <dd>
                  {result.usage.promptTokens.toLocaleString()} in · {result.usage.completionTokens.toLocaleString()} out
                  {result.usage.estimated ? ' (estimated)' : ''}
                </dd>
                <dt className="text-muted">First token</dt>
                <dd>{formatMs(result.timings.timeToFirstTokenMs)}</dd>
                <dt className="text-muted">Total</dt>
                <dd>
                  {formatMs(result.timings.totalMs)}
                  <span className="text-muted">
                    {' '}
                    (search {formatMs(result.timings.retrievalMs)}, masking {formatMs(result.timings.redactionMs)}, queue {formatMs(result.timings.queueMs)})
                  </span>
                </dd>
                <dt className="text-muted">Passages</dt>
                <dd>
                  {result.retrieval.passagesCited} cited of {result.retrieval.passagesProvided} provided
                </dd>
                {result.retrieval.effectiveClearance ? (
                  <>
                    <dt className="text-muted">Your reach</dt>
                    <dd>
                      <ClassificationBadge classification={result.retrieval.effectiveClearance} withTooltip />
                    </dd>
                  </>
                ) : null}
              </>
            ) : null}
          </dl>
          {message.redaction ? (
            <div className="border-t border-line pt-3">
              <p className="mb-1.5 font-medium text-ink">Masking</p>
              <MaskingSummary redaction={message.redaction} />
            </div>
          ) : null}
          {result ? (
            <div className="border-t border-line pt-3">
              <p className="mb-1.5 font-medium text-ink">Context budget</p>
              <ContextBudget context={result.context} />
            </div>
          ) : (
            <p className="border-t border-line pt-3 text-muted">Tokens, timings and the context budget are shown for answers written in this session.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
