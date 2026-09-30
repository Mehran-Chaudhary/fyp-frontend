import { ToggleGroup } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** A small count after the label. */
  count?: number;
}

/** A compact single-choice switcher for filters ("All / Active / Suspended"). */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  className,
  'aria-label': ariaLabel,
  size = 'sm',
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  className?: string;
  'aria-label': string;
  size?: 'xs' | 'sm';
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      // Radix sends '' when the active item is clicked again; keep the selection.
      onValueChange={(next) => next && onValueChange(next as T)}
      aria-label={ariaLabel}
      className={cn(
        'scrollbar-thin inline-flex max-w-full shrink-0 items-center gap-0.5 overflow-x-auto rounded-lg border border-line bg-well p-0.5',
        className,
      )}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-md font-medium whitespace-nowrap text-muted transition-[background-color,color,box-shadow] duration-150',
            'hover:text-ink data-[state=on]:bg-surface data-[state=on]:text-ink data-[state=on]:shadow-card',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500',
            size === 'xs' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
          )}
        >
          {option.label}
          {typeof option.count === 'number' ? (
            <span className="rounded bg-well-strong px-1 text-[11px] leading-4 text-muted tabular">{option.count}</span>
          ) : null}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
