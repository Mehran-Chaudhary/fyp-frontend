import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './spinner';

const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
    'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    'active:translate-y-px [&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-brand-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(20_71_58/0.28)] hover:bg-brand-700',
        secondary:
          'border border-line-strong bg-surface text-ink shadow-xs hover:border-[#c8c3b8] hover:bg-well/70',
        ghost: 'text-ink-soft hover:bg-well hover:text-ink',
        subtle: 'bg-well text-ink hover:bg-well-strong',
        danger:
          'bg-danger-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(149_47_32/0.3)] hover:bg-danger-700',
        'danger-outline': 'border border-danger-200 bg-surface text-danger-700 hover:bg-danger-50',
        link: 'h-auto rounded-sm px-0 text-brand-700 underline decoration-brand-200 underline-offset-4 hover:text-brand-800 hover:decoration-brand-500 active:translate-y-0',
      },
      size: {
        xs: 'h-7 gap-1.5 rounded-md px-2.5 text-xs [&_svg]:size-3.5',
        sm: 'h-8 gap-1.5 px-3 text-[13px] [&_svg]:size-3.5',
        md: 'h-9 px-3.5 text-sm [&_svg]:size-4',
        lg: 'h-11 px-5 text-[15px] [&_svg]:size-4',
        icon: 'size-9 [&_svg]:size-4',
        'icon-sm': 'size-8 [&_svg]:size-4',
        'icon-xs': 'size-7 rounded-md [&_svg]:size-3.5',
      },
    },
    compoundVariants: [{ variant: 'link', className: 'h-auto px-0' }],
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Shows a spinner, disables the button and marks it busy. */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  type,
  ...props
}: ButtonProps) {
  if (asChild) {
    return (
      <Slot.Root className={cn(buttonVariants({ variant, size }), className)} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      type={type ?? 'button'}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}
