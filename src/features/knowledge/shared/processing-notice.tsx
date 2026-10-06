import { hashKey, type QueryKey } from '@tanstack/react-query';
import { Hourglass, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import type { VaultDocument } from '@/lib/api/types';
import { useCoarseNow } from '@/lib/hooks';
import { isSlow, pollingExpired, restartPollSession, usePollSessionStart } from '@/lib/knowledge/polling';
import { pluralize } from '@/lib/utils';

/**
 * What polling can't say on its own (spec §9.3): automatic updates stopped after 30
 * minutes while something is still processing ("refresh to check"), or a document
 * has had no heartbeat for 10 minutes ("taking longer than usual"). Neither is a
 * failure: only the server decides FAILED, and a stalled run can still be resumed
 * by its maintenance sweep.
 */
export function ProcessingNotice({
  queryKey,
  documents,
  onRefresh,
  refreshing,
  className,
}: {
  queryKey: QueryKey;
  documents: readonly Pick<VaultDocument, 'status' | 'lastStatusAt'>[];
  onRefresh: () => void;
  refreshing: boolean;
  className?: string;
}) {
  const hash = hashKey(queryKey);
  const started = usePollSessionStart(hash);
  const now = useCoarseNow();
  const expired = pollingExpired(started, documents, now);
  const slow = documents.filter((document) => isSlow(document, now)).length;
  if (!expired && slow === 0) return null;

  const refresh = () => {
    restartPollSession(hash);
    onRefresh();
  };

  return (
    <Callout
      tone="info"
      role="status"
      icon={<Hourglass className="size-4" aria-hidden />}
      className={className}
      title={expired ? 'Still processing — refresh to check' : slow === 1 ? 'Taking longer than usual' : `${slow} documents are taking longer than usual`}
      action={
        <Button size="xs" variant="secondary" onClick={refresh} loading={refreshing}>
          {refreshing ? null : <RefreshCw />}
          Refresh
        </Button>
      }
    >
      {expired
        ? 'Automatic updates stopped after 30 minutes. Processing can legitimately take longer while a service is down, and retries continue on the server.'
        : `No progress has been reported for ${slow === 1 ? 'it' : 'them'} in over 10 minutes. It may be waiting for a worker or retrying; only the server marks a document failed.`}
      {slow > 0 && expired ? ` ${pluralize(slow, 'document')} reported no progress for over 10 minutes.` : null}
    </Callout>
  );
}
