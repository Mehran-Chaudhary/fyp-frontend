import { CircleAlert, X } from 'lucide-react';
import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { useFieldContext } from './field-context';

interface TagInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  /** Tidies an entry before validation (e.g. lowercase, strip a leading "@"). */
  normalize?: (entry: string) => string;
  /** An error message for an invalid entry, or null. */
  validate?: (entry: string) => string | null;
  max?: number;
  placeholder?: string;
  disabled?: boolean;
  /** Monospace chips, for addresses and ranges. */
  mono?: boolean;
  className?: string;
  'aria-label'?: string;
}

/**
 * A list of short values typed one at a time: Enter, comma, space or Tab adds the
 * entry, Backspace on an empty box removes the last one, and pasting a list adds
 * every entry. Invalid entries stay in the box with an explanation.
 */
export function TagInput({
  value,
  onChange,
  normalize = (entry) => entry.trim(),
  validate,
  max,
  placeholder,
  disabled,
  mono,
  className,
  'aria-label': ariaLabel,
}: TagInputProps) {
  const field = useFieldContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const full = max !== undefined && value.length >= max;

  /** Adds entries; returns what could not be added so it stays in the box. */
  const commit = (raw: string[]): string => {
    const next = [...value];
    const rejected: string[] = [];
    let message: string | null = null;
    for (const piece of raw) {
      const entry = normalize(piece);
      if (!entry) continue;
      if (next.includes(entry)) continue; // duplicates are dropped silently
      if (max !== undefined && next.length >= max) {
        message = `You can add at most ${max}.`;
        rejected.push(piece.trim());
        continue;
      }
      const error = validate?.(entry) ?? null;
      if (error) {
        message = error;
        rejected.push(piece.trim());
        continue;
      }
      next.push(entry);
    }
    if (next.length !== value.length) onChange(next);
    setProblem(message);
    return rejected.join(' ');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === ' ' || (event.key === 'Tab' && draft.trim())) {
      if (!draft.trim()) {
        if (event.key !== 'Tab' && event.key !== 'Enter') event.preventDefault();
        return;
      }
      event.preventDefault();
      setDraft(commit([draft]));
    } else if (event.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
      setProblem(null);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text');
    if (!/[\s,;]/.test(text)) return;
    event.preventDefault();
    setDraft(commit(text.split(/[\s,;]+/)));
  };

  const remove = (entry: string) => {
    onChange(value.filter((item) => item !== entry));
    setProblem(null);
    inputRef.current?.focus();
  };

  return (
    <div className={cn('grid gap-1.5', className)}>
      <div
        onClick={() => inputRef.current?.focus()}
        className={cn(
          'flex min-h-10 w-full cursor-text flex-wrap items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2 py-1.5 shadow-inset transition-[border-color,box-shadow] duration-150',
          'hover:border-[#c8c3b8] focus-within:border-brand-500 focus-within:shadow-[0_0_0_3px_rgb(54_132_106/0.16)]',
          (field?.invalid || problem) && 'border-danger-500',
          disabled && 'cursor-not-allowed bg-well',
        )}
      >
        {value.map((entry) => (
          <span
            key={entry}
            className={cn(
              'inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-well py-0.5 pr-1 pl-2 text-[12.5px] text-ink-soft',
              mono && 'font-mono text-[12px]',
            )}
          >
            <span className="truncate">{entry}</span>
            {disabled ? null : (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  remove(entry);
                }}
                className="inline-flex size-4 items-center justify-center rounded text-faint hover:bg-well-strong hover:text-ink"
                aria-label={`Remove ${entry}`}
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        {disabled ? null : (
          <input
            ref={inputRef}
            id={field?.id}
            aria-label={ariaLabel}
            aria-describedby={field?.describedBy}
            aria-invalid={field?.invalid || !!problem || undefined}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (problem) setProblem(null);
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={() => {
              if (draft.trim()) setDraft(commit([draft]));
            }}
            placeholder={full ? undefined : value.length === 0 ? placeholder : 'Add another…'}
            disabled={full}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className={cn(
              'h-7 min-w-[8rem] flex-1 bg-transparent px-1 text-sm text-ink outline-none placeholder:text-faint disabled:hidden',
              mono && 'font-mono text-[13px]',
            )}
          />
        )}
      </div>
      {problem ? (
        <p className="flex items-start gap-1.5 text-[13px] leading-snug text-danger-700" role="alert">
          <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{problem}</span>
        </p>
      ) : null}
    </div>
  );
}
