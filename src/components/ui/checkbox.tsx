import { Check, Minus } from 'lucide-react';
import { Checkbox as Primitive } from 'radix-ui';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface CheckboxProps {
  checked: boolean | 'indeterminate';
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
  /** Replaces the default label typography (the label still toggles the box). */
  labelClassName?: string;
}

export function Checkbox({ checked, onCheckedChange, label, description, disabled, className, labelClassName }: CheckboxProps) {
  const id = useId();
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <CheckboxBox id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      <label
        htmlFor={id}
        className={cn(
          'min-w-0 text-[13px] leading-snug text-ink-soft select-none',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
      >
        <span className={cn(labelClassName ?? 'font-medium text-ink', disabled && 'opacity-60')}>{label}</span>
        {description ? <span className={cn('mt-0.5 block text-muted', disabled && 'opacity-70')}>{description}</span> : null}
      </label>
    </div>
  );
}

/** The bare box, for rows that lay out their own label. */
export function CheckboxBox({
  id,
  checked,
  onCheckedChange,
  disabled,
  className,
  'aria-label': ariaLabel,
}: {
  id?: string;
  checked: boolean | 'indeterminate';
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <Primitive.Root
      id={id}
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onCheckedChange={(value) => onCheckedChange(value === true)}
      className={cn(
        'group mt-0.5 inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border border-line-strong bg-surface shadow-inset transition-colors',
        'hover:border-brand-400 data-[state=checked]:border-brand-600 data-[state=checked]:bg-brand-600 data-[state=checked]:text-white',
        'data-[state=indeterminate]:border-brand-600 data-[state=indeterminate]:bg-brand-600 data-[state=indeterminate]:text-white',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line-strong',
        className,
      )}
    >
      <Primitive.Indicator>
        <Check className="size-3.5 group-data-[state=indeterminate]:hidden" strokeWidth={3} />
        <Minus className="hidden size-3.5 group-data-[state=indeterminate]:block" strokeWidth={3} />
      </Primitive.Indicator>
    </Primitive.Root>
  );
}
