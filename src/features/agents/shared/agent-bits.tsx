import { useQuery } from '@tanstack/react-query';
import { Globe2, Lock, PenLine, ShieldAlert, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { WorkspaceTile } from '@/components/ui/misc';
import { Tooltip } from '@/components/ui/tooltip';
import type { AgentSummary, Classification, ContextAccounting, MessageRedaction } from '@/lib/api/types';
import { llmPolicyQuery } from '@/lib/queries';
import { cn, pluralize } from '@/lib/utils';
import { EntityCounts } from '@/features/knowledge/shared/masked-text';
import { CLASSIFICATION_META } from '@/features/knowledge/shared/meta';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { useAgentCan } from './use-agent-can';

/** An agent's monogram: the same colour wherever it appears. */
export function AgentAvatar({ agent, size = 'md', className }: { agent: Pick<AgentSummary, 'id' | 'name'>; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return <WorkspaceTile name={agent.name} seed={agent.id} size={size} className={cn('rounded-full', className)} />;
}

/** Draft or published, and a lock when only some roles may use it. Icons as well as colour. */
export function AgentStateBadges({ agent, className }: { agent: Pick<AgentSummary, 'visibility' | 'accessMode'>; className?: string }) {
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      {agent.visibility === 'PRIVATE' ? (
        <Tooltip content="Only its creator and agent managers can see and use it.">
          <Badge tone="outline" tabIndex={0}>
            <PenLine />
            Draft
          </Badge>
        </Tooltip>
      ) : (
        <Badge tone="success" dot>
          Published
        </Badge>
      )}
      {agent.accessMode === 'RESTRICTED' ? (
        <Tooltip content="Once published, only members holding one of its roles can use it.">
          <Badge tone="warning" tabIndex={0}>
            <Lock />
            Restricted
          </Badge>
        </Tooltip>
      ) : null}
    </span>
  );
}

/** A model name in mono, or "Workspace default" when the agent follows the policy. */
export function ModelName({ model, className, fallback = 'Workspace default' }: { model: string | null; className?: string; fallback?: string }) {
  return model ? (
    <span className={cn('font-mono text-[12.5px] break-all text-ink-soft', className)}>{model}</span>
  ) : (
    <span className={cn('text-muted', className)}>{fallback}</span>
  );
}

/**
 * The model endpoint's classification ceiling (P4-G07): "Agents on this workspace
 * only use Internal and Public documents". Read from the policy when it can be.
 */
export function ClearanceCeilingNote({ className, compact }: { className?: string; compact?: boolean }) {
  const workspace = useWorkspace();
  const can = useAgentCan();
  const policy = useQuery({ ...llmPolicyQuery(workspace.id), enabled: can.readModels });
  const ceiling = policy.data?.effective.maxClassification;
  if (!ceiling) return null;
  const levels = classificationsUpTo(ceiling).map((level) => CLASSIFICATION_META[level].label);
  const sentence = `Agents in this workspace only use ${joinOr(levels.reverse())} documents`;
  if (ceiling === 'RESTRICTED') return null;
  return (
    <p className={cn('flex items-start gap-1.5 text-[12.5px] leading-snug text-muted', className)}>
      <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-faint" aria-hidden />
      <span>
        {sentence}
        {compact ? '.' : ': the model endpoint is never sent anything classified above that, for anyone, the owner included.'}
      </span>
    </p>
  );
}

const ORDER: Classification[] = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'];

function classificationsUpTo(ceiling: Classification): Classification[] {
  return ORDER.slice(0, ORDER.indexOf(ceiling) + 1);
}

function joinOr(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

// ── The context budget (§4.8) ───────────────────────────────────────────────

const SEGMENTS = [
  { key: 'systemTokens', label: 'Instructions', className: 'bg-[#7a5aa6]' },
  { key: 'passageTokens', label: 'Passages', className: 'bg-info-500' },
  { key: 'historyTokens', label: 'History', className: 'bg-[#2f7f80]' },
  { key: 'userTokens', label: 'Question', className: 'bg-brand-500' },
] as const;

/**
 * context window = instructions + passages + history + question + reserved answer
 * + safety margin, as one stacked bar with a legend.
 */
export function ContextBudget({ context, className }: { context: ContextAccounting; className?: string }) {
  const window = Math.max(1, context.contextWindow);
  const used = SEGMENTS.reduce((sum, segment) => sum + context[segment.key], 0);
  const free = Math.max(0, context.promptBudget - used);
  const margin = Math.max(0, context.contextWindow - context.promptBudget - context.reservedForAnswer);
  const pct = (value: number) => `${(value / window) * 100}%`;
  return (
    <div className={cn('@container grid gap-2.5', className)}>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-well-strong" role="img" aria-label={`${used.toLocaleString()} of ${context.contextWindow.toLocaleString()} tokens used by the prompt`}>
        {SEGMENTS.map((segment) => (
          <span key={segment.key} className={segment.className} style={{ width: pct(context[segment.key]) }} />
        ))}
        <span className="bg-transparent" style={{ width: pct(free) }} />
        <span className="bg-[repeating-linear-gradient(135deg,var(--color-warning-200)_0_4px,var(--color-warning-100)_4px_8px)]" style={{ width: pct(context.reservedForAnswer) }} />
        <span className="bg-line-strong" style={{ width: pct(margin) }} />
      </div>
      <dl className="grid grid-cols-1 gap-x-5 gap-y-1 text-[12px] @md:grid-cols-2 @3xl:grid-cols-3">
        {SEGMENTS.map((segment) => (
          <LegendItem key={segment.key} swatch={segment.className} label={segment.label} value={context[segment.key]} />
        ))}
        <LegendItem swatch="bg-[repeating-linear-gradient(135deg,var(--color-warning-200)_0_3px,var(--color-warning-100)_3px_6px)]" label="Reserved for answer" value={context.reservedForAnswer} />
        <LegendItem swatch="bg-transparent border border-line-strong" label="Unused prompt budget" value={free} />
        <LegendItem swatch="bg-line-strong" label="Safety margin" value={margin} />
      </dl>
      <p className="text-[12px] leading-snug text-muted">
        Window {context.contextWindow.toLocaleString()} tokens · {pluralize(context.passagesIncluded, 'passage')} included
        {context.passagesDropped ? `, ${context.passagesDropped} dropped for budget` : ''} · {pluralize(context.historyIncluded, 'earlier message')} included
        {context.historyExcluded ? `, ${context.historyExcluded} left out` : ''}
      </p>
    </div>
  );
}

function LegendItem({ swatch, label, value }: { swatch: string; label: string; value: number }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className={cn('size-2.5 shrink-0 rounded-[3px]', swatch)} aria-hidden />
      <dt className="truncate text-muted">{label}</dt>
      <dd className="ml-auto font-mono text-ink-soft tabular">{value.toLocaleString()}</dd>
    </div>
  );
}

// ── Masking (§4.6) ──────────────────────────────────────────────────────────

/**
 * "4 personal details masked before the model saw them", with counts by type, and
 * the degraded warning when names couldn't be detected.
 */
export function MaskingSummary({
  redaction,
  extra,
  className,
}: {
  redaction: Pick<MessageRedaction, 'enabled' | 'degraded' | 'entities' | 'byType'>;
  extra?: ReactNode;
  className?: string;
}) {
  if (!redaction.enabled) {
    return (
      <p className={cn('flex items-start gap-1.5 text-[12.5px] text-warning-700', className)}>
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Masking is turned off in this workspace: the model saw the text as written.
      </p>
    );
  }
  return (
    <div className={cn('grid gap-2', className)}>
      <p className="text-[12.5px] text-ink-soft">
        {redaction.entities === 0
          ? 'No personal details found to mask.'
          : `${pluralize(redaction.entities, 'personal detail')} masked before the model saw ${redaction.entities === 1 ? 'it' : 'them'}.`}
      </p>
      <EntityCounts byType={redaction.byType} />
      {redaction.degraded ? (
        <p className="flex items-start gap-1.5 text-[12.5px] leading-snug text-warning-700">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Names couldn't be detected at the time (the detection service was down), so only patterns such as emails, phone
          numbers and card numbers were masked.
        </p>
      ) : null}
      {extra}
    </div>
  );
}

/** "Public" etc. as a quiet chip, for a conversation's high-water mark. */
export function ClassificationMark({ classification }: { classification: Classification }) {
  if (classification === 'PUBLIC') return null;
  const meta = CLASSIFICATION_META[classification];
  return (
    <Tooltip content={`This conversation contains ${meta.label} material. The mark only ever rises.`}>
      <span tabIndex={0} className={cn('inline-flex items-center gap-1 rounded-[4px] border px-1 text-[10.5px] leading-4 font-semibold tracking-[0.06em] uppercase', meta.className)}>
        {meta.label}
      </span>
    </Tooltip>
  );
}

/** For published agents: who can use it. */
export function AudienceLine({ agent }: { agent: Pick<AgentSummary, 'visibility' | 'accessMode'> }) {
  if (agent.visibility === 'PRIVATE') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted">
        <PenLine className="size-3.5" aria-hidden />
        Draft: only you and agent managers
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted">
      {agent.accessMode === 'RESTRICTED' ? <Lock className="size-3.5" aria-hidden /> : <Globe2 className="size-3.5" aria-hidden />}
      {agent.accessMode === 'RESTRICTED' ? 'Members holding one of its roles' : 'Everyone who can use agents'}
    </span>
  );
}
