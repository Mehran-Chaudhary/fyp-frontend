import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Tooltip } from '@/components/ui/tooltip';
import type { RetrievedChunk } from '@/lib/api/types';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { ClassificationBadge } from '../shared/badges';
import { Highlighted } from '../shared/highlight';
import { KnowledgeBaseDot } from '../shared/kb-identity';

/**
 * One retrieved passage (§6.8). Scores are comparable only within one response, so
 * they're drawn as a bar relative to the top result, with the raw number on hover;
 * never as a percentage or "match quality" (§4.4).
 */
export function PassageCard({
  passage,
  topScore,
  terms,
  compact,
  keepSearch,
}: {
  passage: RetrievedChunk;
  topScore: number;
  terms: readonly string[];
  compact?: boolean;
  /** Keep the current query string on the document link (the vault's filters). */
  keepSearch?: boolean;
}) {
  const workspace = useWorkspace();
  const location = useLocation();
  const [expanded, setExpanded] = useState(false);
  const relative = topScore > 0 ? Math.max(0.04, Math.min(1, passage.score / topScore)) : 0;
  const pages =
    passage.pageStart === null
      ? null
      : passage.pageEnd === null || passage.pageEnd === passage.pageStart
        ? `p. ${passage.pageStart}`
        : `pp. ${passage.pageStart}–${passage.pageEnd}`;
  const long = passage.text.length > (compact ? 260 : 520);

  return (
    <article className="group grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 py-3.5">
      <span
        className="mt-0.5 inline-flex size-6 items-center justify-center rounded-full border border-line bg-well font-mono text-[11px] font-semibold text-ink-soft tabular"
        aria-label={`Rank ${passage.rank}`}
      >
        {passage.rank}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            to={{ pathname: `/w/${workspace.slug}/documents/${passage.documentId}`, search: keepSearch ? location.search : '' }}
            preventScrollReset={keepSearch}
            className="min-w-0 truncate text-[13.5px] font-medium text-ink hover:text-brand-700 hover:underline hover:decoration-brand-200 hover:underline-offset-4"
          >
            {passage.documentTitle}
          </Link>
          <ClassificationBadge classification={passage.classification} />
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <KnowledgeBaseDot id={passage.knowledgeBaseId} />
            {passage.knowledgeBaseName}
          </span>
          <span aria-hidden>·</span>
          <span>Chunk {passage.chunkIndex + 1}</span>
          {pages ? (
            <>
              <span aria-hidden>·</span>
              <span>{pages}</span>
            </>
          ) : null}
          <span className="ml-auto flex items-center gap-2">
            <Tooltip content={`Score ${formatScore(passage.score)}. Comparable within this search only.`}>
              <span tabIndex={0} className="flex items-center gap-1.5 rounded-sm" aria-label={`Relative score ${Math.round(relative * 100)} of 100`}>
                <span className="h-1 w-16 overflow-hidden rounded-full bg-well-strong">
                  <span className="block h-full rounded-full bg-brand-500" style={{ width: `${relative * 100}%` }} />
                </span>
              </span>
            </Tooltip>
          </span>
        </p>
        <p
          className={cn(
            'mt-2 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-ink-soft',
            long && !expanded && (compact ? 'line-clamp-3' : 'line-clamp-6'),
          )}
        >
          <Highlighted text={passage.text} terms={terms} />
        </p>
        {long ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="mt-1 inline-flex items-center gap-1 rounded-sm text-xs font-medium text-muted hover:text-ink"
            aria-expanded={expanded}
          >
            {expanded ? 'Show less' : 'Show the whole passage'}
            <ChevronDown className={cn('size-3 transition-transform', expanded && 'rotate-180')} />
          </button>
        ) : null}
      </div>
    </article>
  );
}

function formatScore(score: number): string {
  if (!Number.isFinite(score)) return String(score);
  const magnitude = Math.abs(score);
  return magnitude !== 0 && magnitude < 0.01 ? score.toPrecision(3) : score.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}
