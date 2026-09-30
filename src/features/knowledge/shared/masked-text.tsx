import { useMemo } from 'react';
import type { DetectedEntity, PiiEntityType } from '@/lib/api/types';
import { ENTITY_SOURCE_LABEL, humanizeEntityType, parsePlaceholder, splitPlaceholders } from '@/lib/knowledge/pii';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { entityTone } from './pii-colors';

/**
 * A chunk as an AI model receives it (§6.5): the masked text with every
 * placeholder drawn as a coloured chip. With revealed values, each chip shows
 * the real value instead; hovering shows the type, score and how it was found.
 */
export function MaskedText({
  maskedText,
  entities,
  labels,
  revealed = false,
  className,
}: {
  maskedText: string;
  entities: readonly DetectedEntity[];
  /** Entity-type labels from GET …/pii/entity-types, when available. */
  labels?: ReadonlyMap<string, PiiEntityType>;
  revealed?: boolean;
  className?: string;
}) {
  const parts = useMemo(() => splitPlaceholders(maskedText, entities), [maskedText, entities]);
  return (
    <p className={cn('text-[13px] leading-[1.75] break-words whitespace-pre-wrap text-ink-soft', className)}>
      {parts.map((part, index) =>
        part.kind === 'text' ? (
          <span key={index}>{part.text}</span>
        ) : (
          <EntityChip key={index} placeholder={part.placeholder} entity={part.entity} labels={labels} revealed={revealed} />
        ),
      )}
    </p>
  );
}

function EntityChip({
  placeholder,
  entity,
  labels,
  revealed,
}: {
  placeholder: string;
  entity: DetectedEntity | undefined;
  labels?: ReadonlyMap<string, PiiEntityType>;
  revealed: boolean;
}) {
  const parsed = parsePlaceholder(placeholder);
  const type = entity?.entityType ?? parsed?.type ?? 'CUSTOM';
  const tone = entityTone(type);
  const label = labels?.get(type)?.label ?? humanizeEntityType(type);
  const value = revealed ? entity?.value : undefined;
  const inner = placeholder.slice(1, -1);

  return (
    <Tooltip
      content={
        <span className="grid gap-0.5">
          <span className="font-semibold">{label}</span>
          {value !== undefined ? <span className="font-mono text-[11px] opacity-80">{placeholder}</span> : null}
          {entity ? (
            <span className="opacity-80">
              Score {entity.score.toFixed(2)} · {ENTITY_SOURCE_LABEL[entity.source] ?? entity.source}
            </span>
          ) : null}
        </span>
      }
    >
      <span
        tabIndex={0}
        className={cn(
          'mx-px inline-flex items-center gap-1 rounded-[5px] border px-1 align-baseline leading-[1.45] outline-offset-1',
          tone.chip,
          value !== undefined ? 'text-[12.5px] font-medium' : 'font-mono text-[11px] font-semibold tracking-[0.02em]',
        )}
      >
        <span className={cn('size-1.5 shrink-0 rounded-full', tone.dot)} aria-hidden />
        {value !== undefined ? value : inner}
        <span className="sr-only">{value !== undefined ? ` (${label}, revealed)` : ` (${label}, masked)`}</span>
      </span>
    </Tooltip>
  );
}

/** "PERSON 1 · EMAIL_ADDRESS 1": counts per entity type as chips. */
export function EntityCounts({
  byType,
  labels,
  className,
}: {
  byType: Readonly<Record<string, number>>;
  labels?: ReadonlyMap<string, PiiEntityType>;
  className?: string;
}) {
  const entries = Object.entries(byType).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (entries.length === 0) return null;
  return (
    <ul className={cn('flex flex-wrap gap-1.5', className)}>
      {entries.map(([type, count]) => {
        const tone = entityTone(type);
        return (
          <li key={type}>
            <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-1.5 py-px text-[11.5px] leading-[18px] font-medium', tone.chip)}>
              <span className={cn('size-1.5 rounded-full', tone.dot)} aria-hidden />
              {labels?.get(type)?.label ?? humanizeEntityType(type)}
              <span className="font-mono text-[11px] tabular opacity-80">{count}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
