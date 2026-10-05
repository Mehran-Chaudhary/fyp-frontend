import { CircleHelp } from 'lucide-react';
import type { ReactNode } from 'react';
import { Callout } from '@/components/ui/callout';
import { isApiError } from '@/lib/api/errors';
import { RequestReference } from './states';

/**
 * A change whose result never arrived (timeout, lost connection, 5xx). It may
 * have happened, so nothing is resent automatically: the user checks first
 * (Phase 2 spec §9 "5xx/timeout after mutation").
 */
export function OutcomeUnknown({
  title = "We couldn't confirm whether that worked",
  error,
  children,
  action,
  className,
}: {
  title?: ReactNode;
  error?: unknown;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const requestId = isApiError(error) ? error.requestId : undefined;
  return (
    <Callout
      tone="warning"
      role="alert"
      icon={<CircleHelp className="size-4" aria-hidden />}
      title={title}
      action={action}
      className={className}
    >
      {children}
      {requestId ? <RequestReference requestId={requestId} className="mt-1 block w-fit" /> : null}
    </Callout>
  );
}
