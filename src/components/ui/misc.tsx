import { useState, type ComponentProps, type ReactNode } from 'react';
import { cn, hashString, initials, safeImageUrl } from '@/lib/utils';

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-well-strong/70', className)} {...props} />;
}

export function Separator({ className, label }: { className?: string; label?: ReactNode }) {
  if (!label) return <hr className={cn('border-0 border-t border-line', className)} />;
  return (
    <div className={cn('flex items-center gap-3 text-xs text-faint', className)} role="separator">
      <span className="h-px flex-1 bg-line" />
      {label}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface px-1 font-mono text-[10.5px] text-muted shadow-xs',
        className,
      )}
      {...props}
    />
  );
}

/** Small uppercase section label. */
export function Overline({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p className={cn('text-[11px] font-medium tracking-[0.08em] text-faint uppercase', className)} {...props} />
  );
}

const avatarSizes = {
  xs: 'size-6 text-[10px]',
  sm: 'size-7 text-[11px]',
  md: 'size-8 text-xs',
  lg: 'size-12 text-base',
  xl: 'size-16 text-xl',
};

/**
 * An avatar image when there is a usable one, initials otherwise: only http(s)
 * URLs are loaded, without a referrer, and a broken image falls back to initials.
 */
export function Avatar({
  name,
  src,
  size = 'md',
  className,
  muted,
}: {
  name: string | null | undefined;
  src?: string | null;
  size?: keyof typeof avatarSizes;
  className?: string;
  /** Greyed out, for removed members. */
  muted?: boolean;
}) {
  // Remember which URL failed, so a new URL gets a fresh attempt.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const url = safeImageUrl(src);
  const showImage = !!url && failedSrc !== url;

  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border font-semibold tracking-wide',
        muted ? 'border-line-strong bg-well text-faint' : 'border-brand-200 bg-brand-50 text-brand-800',
        avatarSizes[size],
        className,
      )}
    >
      {showImage ? (
        <img
          src={url}
          alt=""
          className={cn('size-full object-cover', muted && 'grayscale')}
          referrerPolicy="no-referrer"
          decoding="async"
          loading="lazy"
          onError={() => setFailedSrc(url)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}

const tilePalette = [
  'bg-[#e4efe9] text-[#1f5a47] border-[#cfe2d8]',
  'bg-[#f1e9dc] text-[#6b4b1f] border-[#e6d9c3]',
  'bg-[#e3ebf4] text-[#2a4a79] border-[#cfdcec]',
  'bg-[#ece6f1] text-[#523c6e] border-[#ddd3e7]',
  'bg-[#f3e4e1] text-[#7a3a2c] border-[#ead0ca]',
  'bg-[#e8ecde] text-[#4a5a24] border-[#d8dfc6]',
  'bg-[#e1eeee] text-[#1f5758] border-[#cbe1e1]',
];

const tileSizes = {
  sm: 'size-7 rounded-md text-[11px]',
  md: 'size-9 rounded-lg text-[13px]',
  lg: 'size-11 rounded-xl text-[15px]',
};

/** A workspace monogram with a colour derived from its slug (stable across sessions). */
export function WorkspaceTile({
  name,
  seed,
  size = 'md',
  className,
}: {
  name: string;
  seed: string;
  size?: keyof typeof tileSizes;
  className?: string;
}) {
  const tone = tilePalette[hashString(seed) % tilePalette.length];
  const letters = initials(name).slice(0, 2);
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center border font-semibold tracking-wide',
        tone,
        tileSizes[size],
        className,
      )}
    >
      {letters}
    </span>
  );
}
