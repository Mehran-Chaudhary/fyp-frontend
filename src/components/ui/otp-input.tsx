import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useFieldContext } from './field-context';

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called once the last digit is entered (auto-submit, spec §7.2). */
  onComplete?: (value: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
  name?: string;
  'aria-label'?: string;
  className?: string;
}

/**
 * A six-digit code entry. One real <input> sits on top of the visual slots, so
 * paste, one-time-code autofill and screen readers all work. Accepts "123456" and
 * "123 456"; anything that is not a digit is dropped.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled,
  autoFocus,
  invalid,
  name,
  className,
  'aria-label': ariaLabel,
}: OtpInputProps) {
  const field = useFieldContext();
  const [focused, setFocused] = useState(false);
  const digits = value.replace(/\D/g, '').slice(0, length);
  const activeIndex = Math.min(digits.length, length - 1);
  const isInvalid = invalid ?? field?.invalid;
  const half = Math.ceil(length / 2);

  const slot = (index: number) => {
    const char = digits[index];
    const active = focused && index === activeIndex && !disabled;
    return (
      <div
        key={index}
        className={cn(
          'relative flex h-12 w-10 items-center justify-center rounded-lg border bg-surface font-mono text-xl font-medium text-ink shadow-inset transition-[border-color,box-shadow] duration-150 sm:w-11',
          isInvalid ? 'border-danger-500' : 'border-line-strong',
          active && !isInvalid && 'border-brand-500 shadow-[0_0_0_3px_rgb(54_132_106/0.16)]',
          active && isInvalid && 'shadow-[0_0_0_3px_rgb(210_71_47/0.14)]',
          disabled && 'bg-well text-muted',
        )}
      >
        {char ?? (active && digits.length < length ? <span className="h-5 w-px animate-pulse bg-ink" /> : null)}
      </div>
    );
  };

  return (
    <div className={cn('relative inline-flex items-center gap-2', isInvalid && 'animate-shake', className)}>
      {Array.from({ length: half }, (_, i) => slot(i))}
      <span className="mx-0.5 h-px w-3 bg-line-strong" aria-hidden />
      {Array.from({ length: length - half }, (_, i) => slot(i + half))}
      <input
        id={field?.id}
        name={name}
        aria-label={ariaLabel}
        aria-describedby={field?.describedBy}
        aria-invalid={isInvalid || undefined}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        spellCheck={false}
        autoFocus={autoFocus}
        disabled={disabled}
        value={digits}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSelect={(event) => {
          const input = event.currentTarget;
          const end = input.value.length;
          if (input.selectionStart !== end || input.selectionEnd !== end) input.setSelectionRange(end, end);
        }}
        onChange={(event) => {
          const next = event.target.value.replace(/\D/g, '').slice(0, length);
          onChange(next);
          if (next.length === length && next !== digits) onComplete?.(next);
        }}
        className="absolute inset-0 h-full w-full cursor-text rounded-lg border-0 bg-transparent text-base text-transparent caret-transparent opacity-0 outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
}
