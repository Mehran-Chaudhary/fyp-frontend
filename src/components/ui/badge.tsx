import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-px text-[11.5px] leading-[18px] font-medium [&_svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'border-line bg-well text-ink-soft',
        brand: 'border-brand-200 bg-brand-50 text-brand-800',
        success: 'border-success-200 bg-success-50 text-success-700',
        warning: 'border-warning-200 bg-warning-50 text-warning-700',
        danger: 'border-danger-200 bg-danger-50 text-danger-700',
        info: 'border-info-200 bg-info-50 text-info-700',
        outline: 'border-line-strong bg-surface text-ink-soft',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

const dotTone: Record<string, string> = {
  neutral: 'bg-faint',
  brand: 'bg-brand-500',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  info: 'bg-info-500',
  outline: 'bg-faint',
};

export interface BadgeProps extends ComponentProps<'span'>, VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({ className, tone, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot ? <span className={cn('size-1.5 rounded-full', dotTone[tone ?? 'neutral'])} aria-hidden /> : null}
      {children}
    </span>
  );
}
