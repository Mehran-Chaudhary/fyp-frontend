import { Popover as Primitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;
export const PopoverClose = Primitive.Close;
export const PopoverAnchor = Primitive.Anchor;

/** A floating panel for small forms and details (filters, timing breakdowns). */
export function PopoverContent({
  className,
  sideOffset = 6,
  align = 'start',
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'z-50 w-72 rounded-xl border border-line bg-surface p-3 text-ink shadow-pop outline-none',
          'origin-(--radix-popover-content-transform-origin) data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out',
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}
