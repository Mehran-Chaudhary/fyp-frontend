import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useFieldContext } from './field-context';

const inputBase = [
  'w-full min-w-0 rounded-lg border border-line-strong bg-surface text-sm text-ink shadow-inset',
  'placeholder:text-faint transition-[border-color,box-shadow] duration-150',
  'hover:border-[#c8c3b8]',
  'focus:border-brand-500 focus:shadow-[0_0_0_3px_rgb(54_132_106/0.16)] focus:outline-none',
  'disabled:cursor-not-allowed disabled:bg-well disabled:text-muted',
  'aria-[invalid=true]:border-danger-500 aria-[invalid=true]:focus:shadow-[0_0_0_3px_rgb(210_71_47/0.14)]',
  'read-only:bg-well/60',
].join(' ');

export interface InputProps extends ComponentProps<'input'> {
  /** Icon rendered inside the left edge. */
  leading?: ReactNode;
  /** Element rendered inside the right edge (a button, a unit…). */
  trailing?: ReactNode;
  /** Static text attached to the left, e.g. a URL prefix. */
  addon?: ReactNode;
  inputClassName?: string;
}

export function Input({
  className,
  inputClassName,
  leading,
  trailing,
  addon,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  ...props
}: InputProps) {
  const field = useFieldContext();
  const input = (
    <input
      id={id ?? field?.id}
      aria-describedby={describedBy ?? field?.describedBy}
      aria-invalid={ariaInvalid ?? (field?.invalid || undefined)}
      className={cn(
        inputBase,
        'h-10 px-3',
        leading ? 'pl-9' : null,
        trailing ? 'pr-10' : null,
        addon ? 'rounded-l-none' : null,
        inputClassName,
      )}
      {...props}
    />
  );

  if (!leading && !trailing && !addon) {
    return <div className={cn('relative', className)}>{input}</div>;
  }

  return (
    <div className={cn('relative flex items-stretch', className)}>
      {addon ? (
        <span className="inline-flex max-w-[55%] shrink-0 items-center truncate rounded-l-lg border border-r-0 border-line-strong bg-well px-3 text-[13px] text-muted">
          {addon}
        </span>
      ) : null}
      <div className="relative min-w-0 flex-1">
        {leading ? (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-faint [&_svg]:size-4">
            {leading}
          </span>
        ) : null}
        {input}
        {trailing ? <span className="absolute inset-y-0 right-1 flex items-center">{trailing}</span> : null}
      </div>
    </div>
  );
}

export function Textarea({
  className,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  ...props
}: ComponentProps<'textarea'>) {
  const field = useFieldContext();
  return (
    <textarea
      id={id ?? field?.id}
      aria-describedby={describedBy ?? field?.describedBy}
      aria-invalid={ariaInvalid ?? (field?.invalid || undefined)}
      className={cn(inputBase, 'min-h-24 resize-y px-3 py-2.5 leading-relaxed', className)}
      {...props}
    />
  );
}
