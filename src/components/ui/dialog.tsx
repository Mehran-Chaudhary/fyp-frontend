import { X } from 'lucide-react';
import { AlertDialog as AlertDialogPrimitive, Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const overlayClass =
  'fixed inset-0 z-50 bg-[rgb(28_27_24/0.28)] backdrop-blur-[2px] data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out';

const contentClass = cn(
  'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col',
  'rounded-xl border border-line bg-surface shadow-pop outline-none',
  'data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out',
);

const sizes = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl' };

interface DialogContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  size?: keyof typeof sizes;
  hideClose?: boolean;
}

export function DialogContent({ className, children, size = 'md', hideClose, ...props }: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClass} />
      <DialogPrimitive.Content className={cn(contentClass, sizes[size], className)} {...props}>
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon-sm" className="absolute top-3.5 right-3.5 text-faint" aria-label="Close">
              <X />
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({
  title,
  description,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex gap-3 px-6 pt-6 pb-2 pr-14', className)}>
      {icon ? (
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-well text-ink-soft [&_svg]:size-4">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0">
        <DialogPrimitive.Title className="text-base leading-6 font-semibold text-ink">{title}</DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="mt-1 text-[13px] leading-relaxed text-muted">
            {description}
          </DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        )}
      </div>
    </div>
  );
}

export function DialogBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('scrollbar-thin min-h-0 overflow-y-auto px-6 py-4', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 rounded-b-xl border-t border-line bg-well/40 px-6 py-3.5 sm:flex-row sm:items-center sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}

// ── Alert dialog (confirmations) ────────────────────────────────────────────

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
export const AlertDialogCancel = AlertDialogPrimitive.Cancel;
export const AlertDialogAction = AlertDialogPrimitive.Action;

export function AlertDialogContent({
  className,
  children,
  size = 'sm',
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Content> & { size?: keyof typeof sizes }) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className={overlayClass} />
      <AlertDialogPrimitive.Content className={cn(contentClass, sizes[size], className)} {...props}>
        {children}
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogHeader({
  title,
  description,
  icon,
  tone = 'neutral',
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  tone?: 'neutral' | 'danger' | 'warning';
}) {
  const toneClass = {
    neutral: 'border-line bg-well text-ink-soft',
    danger: 'border-danger-200 bg-danger-50 text-danger-600',
    warning: 'border-warning-200 bg-warning-50 text-warning-600',
  }[tone];
  return (
    <div className="flex gap-3 px-6 pt-6 pb-4">
      {icon ? (
        <span
          className={cn(
            'inline-flex size-9 shrink-0 items-center justify-center rounded-lg border [&_svg]:size-4',
            toneClass,
          )}
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0">
        <AlertDialogPrimitive.Title className="text-base leading-6 font-semibold text-ink">
          {title}
        </AlertDialogPrimitive.Title>
        {description ? (
          <AlertDialogPrimitive.Description className="mt-1 text-[13px] leading-relaxed text-muted">
            {description}
          </AlertDialogPrimitive.Description>
        ) : null}
      </div>
    </div>
  );
}
