import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * "You don't have access to this section": shown when someone opens a tab their
 * roles hide (spec §4), instead of a 404.
 */
export function NoAccessState({
  title = "You don't have access to this section",
  permissions,
  workspaceName,
  action,
  className,
}: {
  title?: ReactNode;
  /** Any one of these would grant access. */
  permissions: string[];
  workspaceName: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-16 text-center', className)}>
      <span className="mb-4 inline-flex size-11 items-center justify-center rounded-xl border border-line bg-well text-ink-soft">
        <Lock className="size-5" aria-hidden />
      </span>
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted">
        Your role in {workspaceName} doesn't include{' '}
        {permissions.map((permission, index) => (
          <span key={permission}>
            {index > 0 ? ' or ' : null}
            <code className="rounded bg-well px-1 font-mono text-[12px] text-ink-soft">{permission}</code>
          </span>
        ))}
        . Ask a workspace administrator if you need it.
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
