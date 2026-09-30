import { toast } from 'sonner';
import { RequestReference } from '@/components/feedback/states';
import { isApiError } from './api/errors';
import { messageFor, titleFor } from './errors';

/**
 * Error toast that always carries the request reference (spec §7.15), so a bug
 * report can be traced to the server log. Skips errors a global handler has
 * already announced.
 */
export function toastError(error: unknown, title?: string): void {
  if (isApiError(error) && error.handledGlobally) return;
  const requestId = isApiError(error) ? error.requestId : undefined;
  toast.error(title ?? titleFor(error), {
    description: (
      <div className="flex flex-col">
        <span>{messageFor(error)}</span>
        {requestId ? <RequestReference requestId={requestId} className="mt-1 w-fit" /> : null}
      </div>
    ),
  });
}

export { toast };
