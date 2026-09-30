import { cn } from '@/lib/utils';
import { CopyButton } from './copy-button';

/** A monospace snippet with a copy button (usage examples). */
export function CodeBlock({ code, label, className }: { code: string; label?: string; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-line bg-[#faf9f6]', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
        <span className="text-[11px] font-medium tracking-[0.06em] text-faint uppercase">{label ?? 'Example'}</span>
        <CopyButton value={code} size="xs" variant="ghost" />
      </div>
      <pre className="scrollbar-thin overflow-x-auto px-3.5 py-3 font-mono text-[12px] leading-relaxed text-ink-soft">
        <code>{code}</code>
      </pre>
    </div>
  );
}
