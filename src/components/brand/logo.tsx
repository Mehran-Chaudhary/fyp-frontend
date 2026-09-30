import { APP_NAME } from '@/lib/env';
import { cn } from '@/lib/utils';

/** The vault-dial mark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={cn('size-8 shrink-0', className)}>
      <rect width="32" height="32" rx="8" className="fill-brand-600" />
      <circle cx="16" cy="16" r="8.25" stroke="#fff" strokeWidth="2.25" />
      <circle cx="16" cy="16" r="2.5" fill="#fff" />
      <path
        d="M16 7.75v3M16 21.25v3M7.75 16h3M21.25 16h3"
        stroke="#fff"
        strokeWidth="2.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark className="size-7" />
      {compact ? null : <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{APP_NAME}</span>}
    </span>
  );
}
