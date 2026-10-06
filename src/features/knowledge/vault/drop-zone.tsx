import { FileUp, ShieldCheck, Upload } from 'lucide-react';
import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { ACCEPT_ATTRIBUTE } from '@/lib/knowledge/files';
import { cn } from '@/lib/utils';
import { FileGlyph } from '../shared/file-glyph';

/**
 * The mockup's drop zone (§5 "Document Vault"): "Drop PDF, DOCX, TXT or Markdown files here".
 * Dropping anywhere on the page works too; this is the visible invitation, and
 * clicking it opens the file picker.
 */
export function DropZone({
  onFiles,
  dragging,
  disabled,
  disabledReason,
  compact,
}: {
  onFiles: (files: File[]) => void;
  dragging: boolean;
  disabled?: boolean;
  disabledReason?: string;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-label="Upload documents: drop files here or press Enter to choose them"
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          input.current?.click();
        }
      }}
      className={cn(
        'group relative flex items-center gap-4 overflow-hidden rounded-xl border border-dashed px-5 text-left transition-[border-color,background-color] duration-200',
        compact ? 'py-3.5' : 'py-5',
        disabled
          ? 'cursor-not-allowed border-line-strong bg-well/40'
          : dragging
            ? 'cursor-copy border-brand-400 bg-brand-50/70'
            : 'cursor-pointer border-line-strong bg-surface/70 hover:border-brand-300 hover:bg-brand-50/30',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
      )}
    >
      <div className="bg-dots pointer-events-none absolute inset-0 opacity-40" aria-hidden />
      <span
        className={cn(
          'relative inline-flex size-10 shrink-0 items-center justify-center rounded-xl border bg-surface shadow-card transition-colors',
          dragging ? 'border-brand-300 text-brand-700' : 'border-line text-ink-soft group-hover:text-brand-700',
        )}
      >
        <Upload className="size-[18px]" aria-hidden />
      </span>
      <div className="relative min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-ink">
          {disabled ? 'Uploads are turned off' : dragging ? 'Drop to upload' : 'Drop PDF, DOCX, TXT or Markdown files here'}
          {disabled || dragging ? null : <span className="font-normal text-muted"> or click to choose</span>}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
          {disabled ? (
            disabledReason
          ) : (
            <>
              <ShieldCheck className="size-3.5 shrink-0 text-brand-600" aria-hidden />
              Files are encrypted before storage · chunked and embedded · PII masked before any model sees it
            </>
          )}
        </p>
      </div>
      {compact ? null : (
        <div className="relative hidden shrink-0 items-end gap-1.5 sm:flex" aria-hidden>
          <FileGlyph type="PDF" size="sm" className="-rotate-6 opacity-90" />
          <FileGlyph type="DOCX" size="sm" className="-translate-y-1" />
          <FileGlyph type="TXT" size="sm" className="rotate-3 opacity-90" />
          <FileGlyph type="MARKDOWN" size="sm" className="rotate-6 opacity-80" />
        </div>
      )}
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="hidden"
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}

/** The full-page veil while files are dragged over the vault. */
export function DropOverlay({ visible, target }: { visible: boolean; target: string }) {
  if (!visible) return null;
  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 z-[45] flex items-center justify-center bg-[rgb(246_245_241/0.72)] backdrop-blur-[2px] animate-overlay-in"
      aria-hidden
    >
      <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-brand-400 bg-surface/95 px-12 py-10 text-center shadow-pop animate-pop-in">
        <span className="inline-flex size-12 items-center justify-center rounded-xl border border-brand-200 bg-brand-50 text-brand-700">
          <FileUp className="size-6" />
        </span>
        <p className="mt-4 text-base font-semibold text-ink">Drop to upload</p>
        <p className="mt-1 text-[13px] text-muted">{target}</p>
      </div>
    </div>,
    document.body,
  );
}
