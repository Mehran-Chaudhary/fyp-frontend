import { Clock, Eye, Hourglass, KeyRound, Lock, PenLine, RotateCw, ShieldCheck, TriangleAlert, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AccessLevel, Classification, KnowledgeBaseAccessMode, VaultDocument } from '@/lib/api/types';
import { rankOf } from '@/lib/knowledge/access';
import { displayStatus } from '@/lib/knowledge/status';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ACCESS_LEVEL_META, CLASSIFICATION_META } from './meta';

// ── Classification ──────────────────────────────────────────────────────────

/** Four small bars filled up to the tier, like a stamp's grade. */
function TierPips({ classification }: { classification: Classification }) {
  const filled = rankOf(classification) + 1;
  const meta = CLASSIFICATION_META[classification];
  return (
    <span className="inline-flex items-end gap-[2px]" aria-hidden>
      {[0, 1, 2, 3].map((index) => (
        <span
          key={index}
          className={cn('w-[3px] rounded-[1px]', index < filled ? meta.pip : 'bg-current opacity-15')}
          style={{ height: `${5 + index * 1.5}px` }}
        />
      ))}
    </span>
  );
}

/** A document's classification, drawn as a small stamp (§5 "Document Vault": grey, blue, amber, red). */
export function ClassificationBadge({
  classification,
  className,
  withTooltip = false,
}: {
  classification: Classification;
  className?: string;
  withTooltip?: boolean;
}) {
  const meta = CLASSIFICATION_META[classification];
  const badge = (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[5px] border px-1.5 py-px text-[10.5px] leading-[18px] font-semibold tracking-[0.07em] whitespace-nowrap uppercase',
        meta.className,
        className,
      )}
      tabIndex={withTooltip ? 0 : undefined}
    >
      <TierPips classification={classification} />
      {meta.label}
    </span>
  );
  return withTooltip ? <Tooltip content={meta.description}>{badge}</Tooltip> : badge;
}

// ── Document status (spec §4.1–4.3) ────────────────────────────────────────

type StatusFields = Pick<VaultDocument, 'status' | 'statusMessage' | 'failureCode' | 'isSearchable' | 'activeIndexVersion'>;

/**
 * The status badge: Queued, Processing, Ready, Failed or Reindex failed. Every state
 * has an icon or a dot as well as a colour, so it reads without colour too.
 */
export function DocumentStatusBadge({ document, className }: { document: StatusFields; className?: string }) {
  const status = displayStatus(document);
  if (status.group === 'processing') {
    return (
      <Badge tone={status.retrying ? 'warning' : 'info'} className={className}>
        {status.retrying ? <RotateCw /> : <Spinner className="size-3" />}
        {status.label}
      </Badge>
    );
  }
  if (status.group === 'queued') {
    return (
      <Badge tone={status.retrying ? 'warning' : 'neutral'} className={className}>
        {status.retrying ? <RotateCw /> : <Clock />}
        {status.label}
      </Badge>
    );
  }
  if (status.group === 'failed' && status.previousVersionServing) {
    return (
      <Badge tone="warning" className={className}>
        <TriangleAlert />
        {status.label}
      </Badge>
    );
  }
  return (
    <Badge tone={status.group === 'ready' ? 'success' : 'danger'} dot className={className}>
      {status.label}
    </Badge>
  );
}

/**
 * The badge and its second line: the stage, a retry notice ("Retrying"), "Taking
 * longer than usual" (§9.3: never "failed": only the server decides that), or
 * "previous version still searchable".
 */
export function DocumentStatusCell({ document, slow = false }: { document: StatusFields; slow?: boolean }) {
  const status = displayStatus(document);
  let note: string | null = status.stage;
  let tone = 'text-muted';
  let icon: ReactNode = null;
  if (status.retrying) {
    note = 'Retrying after a failed attempt';
    tone = 'text-warning-700';
    icon = <RotateCw className="mt-0.5 size-3 shrink-0" aria-hidden />;
  } else if (slow) {
    note = 'Taking longer than usual';
    tone = 'text-warning-700';
    icon = <Hourglass className="mt-0.5 size-3 shrink-0" aria-hidden />;
  } else if (status.group === 'failed' && status.previousVersionServing) {
    tone = 'text-muted';
    icon = <ShieldCheck className="mt-0.5 size-3 shrink-0 text-success-600" aria-hidden />;
  }
  return (
    <span className="grid justify-items-start gap-0.5">
      <DocumentStatusBadge document={document} />
      {note ? (
        <span className={cn('flex max-w-[10rem] items-start gap-1 text-[11.5px] leading-4', tone)}>
          {icon}
          {note}
        </span>
      ) : null}
    </span>
  );
}

// ── Knowledge-base access ───────────────────────────────────────────────────

export function AccessModeBadge({ mode, className }: { mode: KnowledgeBaseAccessMode; className?: string }) {
  return mode === 'RESTRICTED' ? (
    <Badge tone="warning" className={className}>
      <Lock />
      Restricted
    </Badge>
  ) : (
    <Badge tone="neutral" className={className}>
      <Users />
      Workspace
    </Badge>
  );
}

const LEVEL_ICON = { READ: Eye, WRITE: PenLine, MANAGE: KeyRound } as const;

export function AccessLevelBadge({ level, className }: { level: AccessLevel; className?: string }) {
  const Icon = LEVEL_ICON[level];
  return (
    <Badge tone={level === 'MANAGE' ? 'brand' : level === 'WRITE' ? 'info' : 'outline'} className={className}>
      <Icon />
      {ACCESS_LEVEL_META[level].label}
    </Badge>
  );
}
