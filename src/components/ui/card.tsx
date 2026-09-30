import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return <section className={cn('rounded-xl border border-line bg-surface shadow-card', className)} {...props} />;
}

interface CardHeaderProps extends Omit<ComponentProps<'header'>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned actions. */
  actions?: ReactNode;
  icon?: ReactNode;
}

export function CardHeader({ title, description, actions, icon, className, ...props }: CardHeaderProps) {
  return (
    <header className={cn('flex items-start gap-3 px-5 pt-5 pb-4 sm:px-6', className)} {...props}>
      {icon ? (
        <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-well text-ink-soft [&_svg]:size-4">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] leading-6 font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function CardBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('px-5 pb-5 sm:px-6', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<'footer'>) {
  return (
    <footer
      className={cn(
        'flex flex-wrap items-center justify-end gap-2 rounded-b-xl border-t border-line bg-well/40 px-5 py-3 sm:px-6',
        className,
      )}
      {...props}
    />
  );
}

/** A labelled read-only value, used in detail lists. */
export function DetailRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-2.5 text-[13px]', className)}>
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-ink">{children}</dd>
    </div>
  );
}
