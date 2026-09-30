import { Tooltip as Primitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const TooltipProvider = Primitive.Provider;

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Render the children without a tooltip. */
  disabled?: boolean;
  className?: string;
}

/**
 * A short explanation on hover/focus. When wrapping a disabled button, wrap the
 * button in a <span tabIndex={0}> so keyboard users can still reach the hint.
 */
export function Tooltip({ content, children, side = 'top', align = 'center', disabled, className }: TooltipProps) {
  if (disabled || !content) return <>{children}</>;
  return (
    <Primitive.Root delayDuration={250}>
      <Primitive.Trigger asChild>{children}</Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          side={side}
          align={align}
          sideOffset={6}
          className={cn(
            'z-50 max-w-64 rounded-md bg-ink px-2.5 py-1.5 text-xs leading-snug text-white shadow-pop',
            'data-[state=delayed-open]:animate-pop-in data-[state=instant-open]:animate-pop-in data-[state=closed]:animate-pop-out',
            className,
          )}
        >
          {content}
          <Primitive.Arrow className="fill-ink" width={10} height={5} />
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
