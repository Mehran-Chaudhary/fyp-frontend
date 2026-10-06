import { ChevronDown, UploadCloud } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { isBatchVisible, uploadQueue, useUploadQueue } from '@/lib/knowledge/app-upload-queue';
import { itemsOfWorkspace, summarizeUploads, uploadEvents } from '@/lib/knowledge/upload-queue';
import { toast } from '@/lib/toast';
import { cn, pluralize } from '@/lib/utils';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { ProgressBar, UploadItemRow } from './upload-rows';

/**
 * Uploads of this workspace that are running or finished recently, above the
 * vault's table. Uploads started in the dialog keep going after it closes; this is
 * where they stay visible.
 */
export function UploadActivity() {
  const workspace = useWorkspace();
  const items = useUploadQueue((state) => state.items);
  const hold = useUploadQueue((state) => state.holds[workspace.id]);
  const mine = useMemo(() => itemsOfWorkspace(items, workspace.id), [items, workspace.id]);
  const summary = summarizeUploads(mine);
  const [expanded, setExpanded] = useState(true);

  if (mine.length === 0) return null;
  // Unknown outcomes stay until they're checked: dismissing them would lose track of the file.
  const finished = mine.filter((item) => item.status === 'done' || item.status === 'failed' || item.status === 'cancelled');

  return (
    <Card className="overflow-hidden animate-rise">
      <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
        <span
          className={cn(
            'inline-flex size-8 shrink-0 items-center justify-center rounded-lg border',
            summary.active ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-line bg-well text-ink-soft',
          )}
        >
          {summary.active ? <Spinner className="size-4" /> : <UploadCloud className="size-4" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-ink">
            {summary.active ? `Uploading ${pluralize(summary.uploading + summary.queued, 'file')}` : 'Uploads'}
            <span className="font-normal text-muted">
              {' · '}
              {summary.done} done
              {summary.failed ? <span className="text-danger-700"> · {summary.failed} failed</span> : null}
              {summary.unknown ? <span className="text-warning-700"> · {summary.unknown} to check</span> : null}
            </span>
          </p>
          {summary.active ? <ProgressBar value={summary.progress} className="mt-1.5 max-w-sm" /> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {summary.active ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                for (const item of mine) uploadQueue.cancel(item.id);
              }}
            >
              Cancel all
            </Button>
          ) : null}
          {summary.unknown ? (
            <Button variant="secondary" size="xs" onClick={() => uploadQueue.checkAll(workspace.id)}>
              Check the vault
            </Button>
          ) : null}
          {finished.length ? (
            <Button variant="ghost" size="xs" onClick={() => uploadQueue.dismiss(finished.map((item) => item.id))}>
              Clear finished
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-faint"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse uploads' : 'Expand uploads'}
          >
            <ChevronDown className={cn('transition-transform', expanded ? 'rotate-180' : null)} />
          </Button>
        </div>
      </div>
      {expanded ? (
        <ul className="scrollbar-thin max-h-72 divide-y divide-line/70 overflow-y-auto border-t border-line px-4 sm:px-5">
          {mine.map((item) => (
            <UploadItemRow key={item.id} item={item} hold={hold} workspaceSlug={workspace.slug} showKnowledgeBase />
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

/**
 * Announces a batch that finished while its dialog was closed, wherever the user
 * is in the workspace. Mounted once in the app shell.
 */
export function UploadWatcher() {
  const workspace = useWorkspace();
  const navigate = useNavigate();

  useEffect(
    () =>
      uploadEvents.on('batch-settled', ({ batchId, workspaceId, done, failed, unknown }) => {
        if (workspaceId !== workspace.id || isBatchVisible(batchId) || done + failed + unknown === 0) return;
        const open = { label: 'Open vault', onClick: () => void navigate(`/w/${workspace.slug}/documents`) };
        if (unknown > 0) {
          toast.warning(`${pluralize(unknown, 'upload')} got no answer`, {
            description: 'They may have been stored. Check the vault before sending them again.',
            action: open,
          });
        } else if (failed === 0) {
          toast.success(`${pluralize(done, 'file')} uploaded`, { description: 'Queued for processing.', action: open });
        } else {
          toast.warning(done ? `${done} uploaded, ${failed} failed` : `${pluralize(failed, 'upload')} failed`, {
            description: 'See the vault for what went wrong.',
            action: open,
          });
        }
      }),
    [workspace.id, workspace.slug, navigate],
  );

  return null;
}
