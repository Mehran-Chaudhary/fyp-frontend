import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Data tables: dense rows, a quiet header, horizontal scroll on small screens. */
export function Table({ className, wrapperClassName, ...props }: ComponentProps<'table'> & { wrapperClassName?: string }) {
  return (
    <div className={cn('scrollbar-thin w-full overflow-x-auto', wrapperClassName)}>
      <table className={cn('w-full border-collapse text-left text-[13px]', className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: ComponentProps<'thead'>) {
  return <thead className={cn('border-b border-line bg-well/45', className)} {...props} />;
}

export function TBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={cn('[&>tr+tr]:border-t [&>tr+tr]:border-line/70', className)} {...props} />;
}

export function TR({ className, interactive, ...props }: ComponentProps<'tr'> & { interactive?: boolean }) {
  return (
    <tr
      className={cn(
        'transition-colors',
        interactive && 'cursor-pointer hover:bg-well/45 focus-within:bg-well/35',
        className,
      )}
      {...props}
    />
  );
}

export function TH({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      scope="col"
      className={cn(
        'h-10 px-3 text-xs font-medium whitespace-nowrap text-muted first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6',
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      className={cn('px-3 py-3 align-middle text-ink-soft first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6', className)}
      {...props}
    />
  );
}

/** A header cell that sorts its column; `direction` is set only on the active column. */
export function SortableTH({
  children,
  direction,
  onSort,
  className,
}: {
  children: ReactNode;
  direction: 'ASC' | 'DESC' | null;
  onSort: () => void;
  className?: string;
}) {
  const Icon = direction === 'ASC' ? ArrowUp : direction === 'DESC' ? ArrowDown : ArrowUpDown;
  return (
    <TH
      className={className}
      aria-sort={direction === 'ASC' ? 'ascending' : direction === 'DESC' ? 'descending' : 'none'}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          '-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-ink',
          direction ? 'text-ink' : null,
        )}
      >
        {children}
        <Icon className={cn('size-3', direction ? 'text-brand-600' : 'text-faint')} aria-hidden />
      </button>
    </TH>
  );
}

/** A row that spans the table, for skeletons and in-table messages. */
export function TableMessage({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        {children}
      </td>
    </tr>
  );
}
