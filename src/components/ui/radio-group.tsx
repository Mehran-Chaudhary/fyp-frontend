import { RadioGroup as Primitive } from 'radix-ui';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface RadioOption<T extends string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  /** Rendered under the option while it is selected (e.g. a number input). */
  children?: ReactNode;
}

/**
 * Stacked radio options with labels and descriptions. `variant="cards"` draws each
 * option as a bordered tile.
 */
export function RadioGroup<T extends string>({
  value,
  onValueChange,
  options,
  disabled,
  variant = 'plain',
  orientation = 'vertical',
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': labelledBy,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly RadioOption<T>[];
  disabled?: boolean;
  variant?: 'plain' | 'cards';
  orientation?: 'vertical' | 'horizontal';
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}) {
  const baseId = useId();
  return (
    <Primitive.Root
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      disabled={disabled}
      orientation={orientation}
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      className={cn(
        'grid gap-2',
        orientation === 'horizontal' && 'sm:auto-cols-fr sm:grid-flow-col',
        className,
      )}
    >
      {options.map((option) => {
        const id = `${baseId}-${option.value}`;
        const checked = option.value === value;
        return (
          <div
            key={option.value}
            className={cn(
              variant === 'cards' &&
                'rounded-lg border bg-surface px-3.5 py-3 transition-colors has-[button:focus-visible]:border-brand-500',
              variant === 'cards' && (checked ? 'border-brand-300 bg-brand-50/40' : 'border-line hover:border-line-strong'),
              (option.disabled || disabled) && 'opacity-55',
            )}
          >
            <div className="flex items-start gap-2.5">
              <Primitive.Item
                id={id}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  'mt-0.5 inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface shadow-inset transition-colors',
                  'hover:border-brand-400 data-[state=checked]:border-brand-600',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed',
                )}
              >
                <Primitive.Indicator className="size-2 rounded-full bg-brand-600" />
              </Primitive.Item>
              <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer text-[13px] leading-snug select-none">
                <span className="font-medium text-ink">{option.label}</span>
                {option.description ? <span className="mt-0.5 block text-muted">{option.description}</span> : null}
              </label>
            </div>
            {checked && option.children ? <div className="mt-2.5 pl-[28px]">{option.children}</div> : null}
          </div>
        );
      })}
    </Primitive.Root>
  );
}
