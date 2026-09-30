import { Clock, Eye, KeyRound, Lock, PenLine, RotateCw, Users } from 'lucide-react';
import type { AccessLevel, Classification, KnowledgeBaseAccessMode, VaultDocument } from '@/lib/api/types';
import { rankOf } from '@/lib/knowledge/access';
import { displayStatus, type VaultBadge } from '@/lib/knowledge/status';
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

/** A document's classification, drawn as a small stamp (§6.1: grey, blue, amber, red). */
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

// ── Document status ─────────────────────────────────────────────────────────

const STATUS_LABEL: Readonly<Record<VaultBadge, string>> = {
  INDEXED: 'Indexed',
  INDEXING: 'Indexing',
  PENDING: 'Pending',
  FAILED: 'Failed',
};

type StatusFields = Pick<VaultDocument, 'status' | 'statusMessage' | 'isSearchable' | 'indexVersion' | 'activeIndexVersion'>;

/** The vault badge for a document (INDEXED / INDEXING / PENDING / FAILED). */
export function DocumentStatusBadge({ document, className }: { document: StatusFields; className?: string }) {
  const { badge } = displayStatus(document);
  if (badge === 'INDEXING') {
    return (
      <Badge tone="info" className={className}>
        <Spinner className="size-3" />
        {STATUS_LABEL.INDEXING}
      </Badge>
    );
  }
  if (badge === 'PENDING') {
    return (
      <Badge tone="neutral" className={className}>
        <Clock />
        {STATUS_LABEL.PENDING}
      </Badge>
    );
  }
  return (
    <Badge tone={badge === 'INDEXED' ? 'success' : 'danger'} dot className={className}>
      {STATUS_LABEL[badge]}
    </Badge>
  );
}

/** The badge plus its second line: the stage, a retry notice, or "previous version searchable". */
export function DocumentStatusCell({ document }: { document: StatusFields }) {
  const status = displayStatus(document);
  let note: string | null = null;
  let tone = 'text-muted';
  if (status.retrying) {
    note = 'Retrying…';
    tone = 'text-warning-700';
  } else if (status.badge === 'INDEXING' || (status.badge === 'PENDING' && status.previousVersionServing)) {
    note = status.stage;
  } else if (status.badge === 'FAILED' && status.previousVersionServing) {
    note = 'Previous version searchable';
  } else if (status.badge === 'PENDING') {
    note = document.activeIndexVersion !== null ? 'Reindex queued' : 'Queued';
  }
  return (
    <span className="grid justify-items-start gap-0.5">
      <DocumentStatusBadge document={document} />
      {note ? (
        <span className={cn('flex max-w-[9.5rem] items-start gap-1 text-[11.5px] leading-4', tone)}>
          {status.retrying ? <RotateCw className="mt-0.5 size-3 shrink-0" aria-hidden /> : null}
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
