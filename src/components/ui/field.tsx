import { CircleAlert } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { FieldContext } from './field-context';

interface FieldProps {
  label: ReactNode;
  /** Renders to the right of the label (e.g. "Forgot password?"). */
  labelAside?: ReactNode;
  hint?: ReactNode;
  error?: string;
  /** Marks the label as optional. */
  optional?: boolean;
  className?: string;
  children: ReactNode;
  id?: string;
}

/**
 * A labelled form control. Every input gets a visible label, and hint/error text
 * is linked through aria-describedby (spec §12, accessibility).
 */
export function Field({ label, labelAside, hint, error, optional, className, children, id }: FieldProps) {
  const generated = useId();
  const fieldId = id ?? `field-${generated}`;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <FieldContext.Provider value={{ id: fieldId, describedBy, invalid: !!error }}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        <div className="flex min-h-5 items-baseline justify-between gap-3">
          <label htmlFor={fieldId} className="text-[13px] font-medium text-ink-soft">
            {label}
            {optional ? <span className="ml-1.5 font-normal text-faint">Optional</span> : null}
          </label>
          {labelAside}
        </div>
        {children}
        {error ? (
          <p id={errorId} className="flex items-start gap-1.5 text-[13px] leading-snug text-danger-700" role="alert">
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </p>
        ) : null}
        {hint ? (
          <p id={hintId} className="text-[13px] leading-snug text-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

/** Form-level error (for errors that belong to no single field). */
export function FormError({ message, className }: { message?: string; className?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2.5 text-[13px] leading-snug text-danger-700',
        className,
      )}
    >
      <CircleAlert className="mt-px size-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}
