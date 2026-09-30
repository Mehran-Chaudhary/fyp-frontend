import { Check, ChevronRight } from 'lucide-react';
import { DropdownMenu as Primitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;
export const DropdownMenuGroup = Primitive.Group;
export const DropdownMenuSub = Primitive.Sub;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = 'end',
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'z-50 min-w-52 overflow-hidden rounded-xl border border-line bg-surface p-1 text-ink shadow-pop',
          'origin-(--radix-dropdown-menu-content-transform-origin) data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out',
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}

const itemClass = cn(
  'relative flex cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-ink-soft outline-none',
  'data-[highlighted]:bg-well data-[highlighted]:text-ink data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
  '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-faint data-[highlighted]:[&_svg]:text-ink-soft',
);

export function DropdownMenuItem({
  className,
  tone,
  ...props
}: ComponentProps<typeof Primitive.Item> & { tone?: 'danger' }) {
  return (
    <Primitive.Item
      className={cn(
        itemClass,
        tone === 'danger' &&
          'text-danger-700 data-[highlighted]:bg-danger-50 data-[highlighted]:text-danger-700 [&_svg]:text-danger-500 data-[highlighted]:[&_svg]:text-danger-600',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckItem({
  className,
  checked,
  children,
  ...props
}: ComponentProps<typeof Primitive.Item> & { checked?: boolean }) {
  return (
    <Primitive.Item className={cn(itemClass, 'pr-8', className)} {...props}>
      {children}
      {checked ? <Check className="absolute right-2.5 !text-brand-600" aria-label="Current" /> : null}
    </Primitive.Item>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Primitive.Label>) {
  return (
    <Primitive.Label
      className={cn('px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-[0.06em] text-faint uppercase', className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator className={cn('-mx-1 my-1 h-px bg-line', className)} {...props} />;
}

/** An item that opens a nested menu; `hint` shows the current choice on the right. */
export function DropdownMenuSubTrigger({
  className,
  children,
  hint,
  ...props
}: ComponentProps<typeof Primitive.SubTrigger> & { hint?: ReactNode }) {
  return (
    <Primitive.SubTrigger className={cn(itemClass, 'data-[state=open]:bg-well data-[state=open]:text-ink', className)} {...props}>
      {children}
      {hint ? <span className="ml-auto max-w-32 truncate pl-3 text-xs text-muted">{hint}</span> : <span className="ml-auto" />}
      <ChevronRight className="!size-3.5" aria-hidden />
    </Primitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({ className, ...props }: ComponentProps<typeof Primitive.SubContent>) {
  return (
    <Primitive.Portal>
      <Primitive.SubContent
        sideOffset={6}
        className={cn(
          'scrollbar-thin z-50 max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] min-w-52 overflow-y-auto rounded-xl border border-line bg-surface p-1 text-ink shadow-pop',
          'origin-(--radix-dropdown-menu-content-transform-origin) data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out',
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}
