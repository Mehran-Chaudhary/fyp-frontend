import { CircleAlert, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { isApiError } from '@/lib/api/errors';
import { messageFor } from '@/lib/errors';
import { toast } from 'sonner';
import { copyToClipboard, cn } from '@/lib/utils';

/** "Reference: 3f0f7ab8", click to copy the full request id (spec §7.15). */
export function RequestReference({ requestId, className }: { requestId?: string | null; className?: string }) {
  if (!requestId) return null;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        void copyToClipboard(requestId).then((ok) => ok && toast.success('Reference copied', { description: requestId }));
      }}
      className={cn(
        'inline-flex items-center gap-1 rounded font-mono text-[11px] text-faint underline decoration-line-strong underline-offset-2 hover:text-muted',
        className,
      )}
      title="Copy the full reference for a bug report"
    >
      Reference: {requestId.slice(0, 8)}
    </button>
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      {icon ? (
        <span className="mb-4 inline-flex size-11 items-center justify-center rounded-xl border border-line bg-surface text-ink-soft shadow-card [&_svg]:size-5">
          {icon}
        </span>
      ) : null}
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {description ? <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}

interface ErrorStateProps {
  error: unknown;
  title?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
  compact?: boolean;
}

/** A failed load, with the reason, a retry and the request reference. */
export function ErrorState({ error, title = "Couldn't load this", onRetry, retrying, className, compact }: ErrorStateProps) {
  const requestId = isApiError(error) ? error.requestId : undefined;
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center text-center',
        compact ? 'px-4 py-8' : 'px-6 py-14',
        className,
      )}
    >
      <span className="mb-3 inline-flex size-10 items-center justify-center rounded-xl border border-danger-200 bg-danger-50 text-danger-600">
        <CircleAlert className="size-5" aria-hidden />
      </span>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted">{messageFor(error)}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry} loading={retrying}>
          {retrying ? null : <RefreshCw />}
          Try again
        </Button>
      ) : null}
      <RequestReference requestId={requestId} className="mt-3" />
    </div>
  );
}

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  overline?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, overline, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {overline ? <div className="mb-1.5 text-[13px] text-muted">{overline}</div> : null}
        <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.015em] text-ink">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
