import { Ban, CircleAlert, CircleCheck, CircleHelp, Clock, Hourglass, RotateCw, Trash } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ErrorState, RequestReference } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/misc';
import { Spinner } from '@/components/ui/spinner';
import type { KnowledgeBase } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { useCountdown } from '@/lib/hooks';
import { cn, formatCountdown, pluralize } from '@/lib/utils';
import { ProgressBar } from '../upload/upload-rows';
import { useReindexAll, type ReindexRow, type ReindexRowState } from './use-reindex-all';

const ROW_META: Readonly<Record<ReindexRowState, { label: string; icon: ReactNode; tone: string }>> = {
  waiting: { label: 'Waiting', icon: <Clock className="size-3.5" aria-hidden />, tone: 'text-muted' },
  running: { label: 'Sending', icon: <Spinner className="size-3.5" />, tone: 'text-brand-700' },
  started: { label: 'Queued for reindexing', icon: <CircleCheck className="size-3.5" aria-hidden />, tone: 'text-success-700' },
  busy: { label: 'Already processing', icon: <RotateCw className="size-3.5" aria-hidden />, tone: 'text-info-700' },
  gone: { label: 'Gone', icon: <Trash className="size-3.5" aria-hidden />, tone: 'text-muted' },
  unknown: { label: 'No answer', icon: <CircleHelp className="size-3.5" aria-hidden />, tone: 'text-warning-700' },
  failed: { label: 'Refused', icon: <CircleAlert className="size-3.5" aria-hidden />, tone: 'text-danger-700' },
  'not-attempted': { label: 'Not attempted', icon: <Ban className="size-3.5" aria-hidden />, tone: 'text-muted' },
};

/**
 * "Reindex all documents" (spec §4.5): what will be reindexed, then each document's
 * outcome as it happens. Documents keep answering searches from their current
 * version until the new one is ready.
 */
export function ReindexAllDialog({
  knowledgeBase,
  open,
  onOpenChange,
}: {
  knowledgeBase: Pick<KnowledgeBase, 'id' | 'name'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // A fresh run every time the dialog opens.
  const [session, setSession] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) window.setTimeout(() => setSession((value) => value + 1), 200);
      }}
    >
      <DialogContent size="lg">{open ? <Run key={session} knowledgeBase={knowledgeBase} onClose={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

function Run({ knowledgeBase, onClose }: { knowledgeBase: Pick<KnowledgeBase, 'id' | 'name'>; onClose: () => void }) {
  const run = useReindexAll(knowledgeBase);
  const [includePermanent, setIncludePermanent] = useState(false);
  const waitFor = useCountdown(run.waitingUntil);

  const finished = run.rows.filter((row) => row.state !== 'waiting' && row.state !== 'running').length;
  const count = (state: ReindexRowState) => run.rows.filter((row) => row.state === state).length;

  return (
    <>
      <DialogHeader
        icon={<RotateCw />}
        title={`Reindex ${knowledgeBase.name}`}
        description="Re-runs extraction, chunking and embedding with the current chunk settings, one document at a time. Each keeps answering searches from its current version until the new one is ready."
      />
      <DialogBody className="grid gap-4">
        {run.phase === 'planning' ? (
          <div className="grid gap-2" aria-busy="true">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ) : run.planError ? (
          <ErrorState compact error={run.planError} title="We couldn't list the documents" onRetry={run.prepare} />
        ) : run.phase === 'planned' && run.planned ? (
          <Plan
            targets={run.planned.targets.length}
            busy={run.planned.busy}
            permanent={run.planned.permanent.length}
            includePermanent={includePermanent}
            onIncludePermanent={setIncludePermanent}
          />
        ) : (
          <>
            <div className="grid gap-2">
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-ink-soft" aria-live="polite">
                  <span className="font-medium text-ink tabular">{finished}</span> of {run.rows.length} done
                  {count('started') ? <span className="text-success-700"> · {count('started')} queued</span> : null}
                  {count('failed') + count('unknown') ? (
                    <span className="text-danger-700"> · {count('failed') + count('unknown')} need attention</span>
                  ) : null}
                </span>
                {run.waitingUntil ? (
                  <span className="flex items-center gap-1 text-xs text-warning-700 tabular">
                    <Hourglass className="size-3" aria-hidden />
                    Rate limit · resumes in {formatCountdown(waitFor)}
                  </span>
                ) : null}
              </div>
              <ProgressBar value={run.rows.length ? finished / run.rows.length : 0} className="h-1.5" />
            </div>
            {run.stoppedBy ? (
              <Callout tone="danger" title="Stopped early">
                {messageFor(run.stoppedBy)} The documents not attempted keep their current version.
              </Callout>
            ) : null}
            <ul className="scrollbar-thin max-h-72 divide-y divide-line/70 overflow-y-auto rounded-lg border border-line px-3.5">
              {run.rows.map((row) => (
                <Row key={row.document.id} row={row} />
              ))}
            </ul>
          </>
        )}
      </DialogBody>
      <DialogFooter>
        {run.phase === 'running' ? (
          <Button variant="ghost" onClick={run.cancel}>
            Stop after this one
          </Button>
        ) : null}
        {run.phase === 'planned' && run.planned ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => run.start(includePermanent)}
              disabled={run.planned.targets.length + (includePermanent ? run.planned.permanent.length : 0) === 0}
            >
              <RotateCw />
              Reindex {pluralize(run.planned.targets.length + (includePermanent ? run.planned.permanent.length : 0), 'document')}
            </Button>
          </>
        ) : (
          <Button variant={run.phase === 'done' ? 'primary' : 'secondary'} onClick={onClose} disabled={run.phase === 'planning'}>
            {run.phase === 'running' ? 'Hide' : 'Done'}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

function Plan({
  targets,
  busy,
  permanent,
  includePermanent,
  onIncludePermanent,
}: {
  targets: number;
  busy: number;
  permanent: number;
  includePermanent: boolean;
  onIncludePermanent: (value: boolean) => void;
}) {
  if (targets + busy + permanent === 0) {
    return <p className="text-[13px] text-muted">There are no documents in it that you can see.</p>;
  }
  return (
    <div className="grid gap-3">
      <ul className="grid gap-1.5 text-[13px] text-ink-soft">
        <li className="flex items-center gap-2">
          <CircleCheck className="size-4 text-success-600" aria-hidden />
          <span>
            <span className="font-medium text-ink tabular">{targets}</span> {targets === 1 ? 'document' : 'documents'} will be reindexed
            (ready, or failed for a reason a retry can fix).
          </span>
        </li>
        {busy ? (
          <li className="flex items-center gap-2">
            <RotateCw className="size-4 text-info-600" aria-hidden />
            <span>
              {pluralize(busy, 'document')} {busy === 1 ? 'is' : 'are'} already processing and will use the current settings anyway.
            </span>
          </li>
        ) : null}
        {permanent ? (
          <li className="flex items-center gap-2">
            <CircleAlert className="size-4 text-danger-600" aria-hidden />
            <span>
              {pluralize(permanent, 'document')} failed for a reason a retry can't fix (the file itself).
            </span>
          </li>
        ) : null}
      </ul>
      {permanent ? (
        <Checkbox
          checked={includePermanent}
          onCheckedChange={onIncludePermanent}
          label="Try the failed ones again too"
          description="They will most likely fail the same way."
        />
      ) : null}
      <p className="text-xs text-faint">
        One request at a time, within your request budget. If the server asks to slow down, the run pauses and carries on.
      </p>
    </div>
  );
}

function Row({ row }: { row: ReindexRow }) {
  const meta = ROW_META[row.state];
  return (
    <li className="flex items-start gap-3 py-2">
      <span className={cn('mt-0.5 shrink-0', meta.tone)}>{meta.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{row.document.title}</p>
        <p className={cn('text-xs', meta.tone)}>
          {meta.label}
          {row.message && row.state !== 'busy' ? <span className="text-muted"> · {row.message}</span> : null}
        </p>
        {row.requestId ? <RequestReference requestId={row.requestId} /> : null}
      </div>
    </li>
  );
}
