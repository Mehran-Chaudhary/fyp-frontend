import { Dialog as Primitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A left-side drawer (mobile navigation). */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal>
        <Primitive.Overlay className="fixed inset-0 z-50 bg-[rgb(28_27_24/0.28)] data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out" />
        <Primitive.Content
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex w-[min(20rem,86vw)] flex-col bg-surface shadow-pop outline-none',
            'data-[state=open]:animate-sheet-in data-[state=closed]:animate-sheet-out',
            className,
          )}
        >
          <Primitive.Title className="sr-only">{title}</Primitive.Title>
          <Primitive.Description className="sr-only">{title}</Primitive.Description>
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
