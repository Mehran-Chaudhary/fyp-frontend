import { X } from 'lucide-react';
import { Dialog as Primitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

/**
 * A panel that slides in from the right over the page (member details). Unlike
 * the left <Sheet>, it carries a header with a title and a close button.
 */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  headerExtra,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Visually rendered by the caller inside `headerExtra` or as-is here. */
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Replaces the default title block (e.g. an avatar header); the title stays for screen readers. */
  headerExtra?: ReactNode;
}) {
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal>
        <Primitive.Overlay className="fixed inset-0 z-50 bg-[rgb(28_27_24/0.22)] data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out" />
        <Primitive.Content
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-[min(34rem,100vw)] flex-col border-l border-line bg-surface shadow-pop outline-none',
            'data-[state=open]:animate-drawer-in data-[state=closed]:animate-drawer-out',
            className,
          )}
        >
          <div className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4 sm:px-6">
            <div className="min-w-0 flex-1">
              {headerExtra ? (
                <>
                  <Primitive.Title className="sr-only">{title}</Primitive.Title>
                  {headerExtra}
                </>
              ) : (
                <Primitive.Title className="text-base leading-6 font-semibold text-ink">{title}</Primitive.Title>
              )}
              {description ? (
                <Primitive.Description className="mt-0.5 text-[13px] text-muted">{description}</Primitive.Description>
              ) : (
                <Primitive.Description className="sr-only">{title}</Primitive.Description>
              )}
            </div>
            <Primitive.Close asChild>
              <Button variant="ghost" size="icon-sm" className="-mr-1.5 text-faint" aria-label="Close">
                <X />
              </Button>
            </Primitive.Close>
          </div>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line bg-well/40 px-5 py-3 sm:px-6">
              {footer}
            </div>
          ) : null}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}

/** A titled block inside a drawer. */
export function DrawerSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('border-b border-line px-5 py-5 last:border-b-0 sm:px-6', className)}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-semibold text-ink">{title}</h3>
          {description ? <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
