import { Switch as Primitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** An on/off toggle. Pair it with a visible label (aria-labelledby or a <label htmlFor>). */
export function Switch({ className, ...props }: ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root
      className={cn(
        'peer relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-line-strong shadow-inset transition-colors duration-150',
        'data-[state=checked]:bg-brand-600 hover:data-[state=unchecked]:bg-[#c8c3b8]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <Primitive.Thumb
        className={cn(
          'pointer-events-none block size-[18px] rounded-full bg-white shadow-[0_1px_2px_rgb(28_27_24/0.25)] transition-transform duration-150',
          'data-[state=checked]:translate-x-[17px] data-[state=unchecked]:translate-x-px',
        )}
      />
    </Primitive.Root>
  );
}
