import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PaginationMeta } from '@/lib/api/types';
import { cn } from '@/lib/utils';
import { Button } from './button';

/** "21–40 of 57" with previous/next, driven by the envelope's `meta.pagination`. */
export function Pagination({
  pagination,
  onPageChange,
  busy,
  noun,
  className,
}: {
  pagination: PaginationMeta | undefined;
  onPageChange: (page: number) => void;
  busy?: boolean;
  /** "member" → "57 members" */
  noun: [singular: string, plural: string];
  className?: string;
}) {
  if (!pagination || pagination.totalItems === 0) return null;
  const { page, limit, totalItems, totalPages, hasNextPage, hasPreviousPage } = pagination;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, totalItems);
  const label = totalItems === 1 ? noun[0] : noun[1];

  return (
    <nav
      aria-label="Pagination"
      className={cn('flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted', className)}
    >
      <span className="tabular">
        {totalPages > 1 ? (
          <>
            <span className="font-medium text-ink-soft">
              {from}–{to}
            </span>{' '}
            of {totalItems.toLocaleString()} {label}
          </>
        ) : (
          <>
            {totalItems.toLocaleString()} {label}
          </>
        )}
      </span>
      {totalPages > 1 ? (
        <div className="flex items-center gap-2">
          <span className="hidden text-xs sm:inline tabular">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={!hasPreviousPage || busy}
            onClick={() => onPageChange(Math.max(1, page - 1))}
            aria-label="Previous page"
          >
            <ChevronLeft />
            <span className="hidden sm:inline">Previous</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!hasNextPage || busy}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight />
          </Button>
        </div>
      ) : null}
    </nav>
  );
}
