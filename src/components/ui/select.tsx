import { Check, ChevronDown } from 'lucide-react';
import { Select as Primitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useFieldContext } from './field-context';

export interface SelectOption<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Shown under the label in the list only. */
  description?: ReactNode;
  /** Rendered before the label, in the list and in the trigger. */
  leading?: ReactNode;
  disabled?: boolean;
}

interface SelectProps<T extends string> {
  value: T | undefined;
  onValueChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  placeholder?: string;
  /** `sm` for toolbars, `md` to sit next to inputs in forms. */
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  /** Icon inside the trigger, before the value. */
  icon?: ReactNode;
  'aria-label'?: string;
  id?: string;
}

/**
 * A styled single-choice select (Radix). Picks up its id and aria wiring from an
 * enclosing <Field>. Radix forbids '' as an item value, so use a sentinel such as
 * 'all' for "no filter".
 */
export function Select<T extends string>({
  value,
  onValueChange,
  options,
  placeholder,
  size = 'md',
  disabled,
  className,
  contentClassName,
  icon,
  id,
  'aria-label': ariaLabel,
}: SelectProps<T>) {
  const field = useFieldContext();
  const selected = options.find((option) => option.value === value);

  return (
    <Primitive.Root value={value} onValueChange={(next) => onValueChange(next as T)} disabled={disabled}>
      <Primitive.Trigger
        id={id ?? field?.id}
        aria-label={ariaLabel}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.invalid || undefined}
        className={cn(
          'group inline-flex min-w-0 items-center gap-2 rounded-lg border border-line-strong bg-surface text-left text-ink shadow-xs transition-[border-color,box-shadow] duration-150',
          'hover:border-[#c8c3b8] focus-visible:border-brand-500 focus-visible:shadow-[0_0_0_3px_rgb(54_132_106/0.16)] focus-visible:outline-none',
          'data-[state=open]:border-brand-500 disabled:cursor-not-allowed disabled:bg-well disabled:text-muted',
          'aria-[invalid=true]:border-danger-500 data-[placeholder]:text-faint',
          size === 'sm' ? 'h-9 px-3 text-[13px]' : 'h-10 w-full px-3 text-sm',
          '[&_svg]:shrink-0',
          className,
        )}
      >
        {icon ? <span className="text-faint [&_svg]:size-4">{icon}</span> : null}
        <span className="flex min-w-0 flex-1 items-center gap-2 truncate">
          {selected?.leading}
          <Primitive.Value placeholder={placeholder}>{selected ? <span className="truncate">{selected.label}</span> : null}</Primitive.Value>
        </span>
        <Primitive.Icon asChild>
          <ChevronDown className="size-4 text-faint transition-transform group-data-[state=open]:rotate-180" />
        </Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          position="popper"
          sideOffset={6}
          className={cn(
            'z-50 max-h-[min(22rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-line bg-surface text-ink shadow-pop',
            'origin-(--radix-select-content-transform-origin) data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out',
            contentClassName,
          )}
        >
          <Primitive.Viewport className="scrollbar-thin p-1">
            {options.map((option) => (
              <Primitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  'relative flex cursor-default items-start gap-2.5 rounded-lg py-2 pr-8 pl-2.5 text-[13px] text-ink-soft outline-none select-none',
                  'data-[highlighted]:bg-well data-[highlighted]:text-ink data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
                  'data-[state=checked]:font-medium data-[state=checked]:text-ink',
                )}
              >
                {option.leading ? <span className="mt-px flex shrink-0 items-center">{option.leading}</span> : null}
                <span className="min-w-0">
                  <Primitive.ItemText>{option.label}</Primitive.ItemText>
                  {option.description ? (
                    <span className="mt-0.5 block text-xs font-normal text-muted">{option.description}</span>
                  ) : null}
                </span>
                <Primitive.ItemIndicator className="absolute top-2.5 right-2.5">
                  <Check className="size-3.5 text-brand-600" strokeWidth={2.5} />
                </Primitive.ItemIndicator>
              </Primitive.Item>
            ))}
          </Primitive.Viewport>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
