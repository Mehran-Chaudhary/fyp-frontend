import { Ban, CircleAlert, CircleCheck, CircleHelp, Clock, ExternalLink, RotateCcw, SearchCheck, X } from 'lucide-react';
import { Link } from 'react-router';
import { RequestReference } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip } from '@/components/ui/tooltip';
import { uploadQueue } from '@/lib/knowledge/app-upload-queue';
import { fileTypeFromName, formatBytes, type PrecheckProblem } from '@/lib/knowledge/files';
import type { QueueHold, UploadItem } from '@/lib/knowledge/upload-queue';
import { useCountdown } from '@/lib/hooks';
import { cn, formatCountdown } from '@/lib/utils';
import { FileGlyph } from '../shared/file-glyph';

/** A thin progress bar; `indeterminate` while the server works on the request. */
export function ProgressBar({ value, tone = 'brand', className }: { value: number; tone?: 'brand' | 'danger' | 'muted'; className?: string }) {
  return (
    <div
      className={cn('h-1 overflow-hidden rounded-full bg-well-strong', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-300 ease-out',
          tone === 'danger' ? 'bg-danger-500' : tone === 'muted' ? 'bg-line-strong' : 'bg-brand-500',
        )}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  );
}

/** A file picked for upload, before it's sent: its name, size and anything the server would refuse. */
export function PickedFileRow({ file, problem, onRemove }: { file: File; problem: PrecheckProblem | null; onRemove?: () => void }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <FileGlyph type={fileTypeFromName(file.name)} size="sm" className={problem ? 'opacity-50' : undefined} />
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-[13px] font-medium', problem ? 'text-muted' : 'text-ink')}>{file.name}</p>
        {problem ? (
          <p className="flex items-center gap-1 text-xs text-danger-700">
            <CircleAlert className="size-3 shrink-0" aria-hidden />
            {problem.message} <span className="text-muted">Won't be sent.</span>
          </p>
        ) : (
          <p className="text-xs text-muted tabular">{formatBytes(file.size)}</p>
        )}
      </div>
      {onRemove ? (
        <Button variant="ghost" size="icon-xs" className="text-faint" onClick={onRemove} aria-label={`Remove ${file.name}`}>
          <X />
        </Button>
      ) : null}
    </li>
  );
}

/** One file in the queue: progress, outcome, and what can be done about a failure. */
export function UploadItemRow({
  item,
  hold,
  workspaceSlug,
  showKnowledgeBase,
  onNavigate,
}: {
  item: UploadItem;
  hold: QueueHold | undefined;
  workspaceSlug: string;
  showKnowledgeBase?: boolean;
  /** Called before following a link (e.g. to close the dialog). */
  onNavigate?: () => void;
}) {
  const held = item.status === 'queued' && !!hold;
  const resumeIn = useCountdown(held ? hold.until : null);
  const documentLink = (documentId: string) => `/w/${workspaceSlug}/documents/${documentId}`;

  return (
    <li className="py-2.5">
      <div className="flex items-center gap-3">
        <FileGlyph type={fileTypeFromName(item.file.name)} size="sm" className={item.status === 'cancelled' ? 'opacity-50' : undefined} />
        <div className="min-w-0 flex-1">
          <p className={cn('truncate text-[13px] font-medium', item.status === 'cancelled' ? 'text-muted line-through decoration-line-strong' : 'text-ink')}>
            {item.file.name}
          </p>
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
            <span className="shrink-0 tabular">{formatBytes(item.file.size)}</span>
            {showKnowledgeBase ? (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{item.knowledgeBaseName}</span>
              </>
            ) : null}
            <span aria-hidden>·</span>
            <StatusLine item={item} held={held} resumeIn={resumeIn} />
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {item.status === 'done' && item.document ? (
            <Button asChild variant="ghost" size="xs">
              <Link to={documentLink(item.document.id)} onClick={onNavigate}>
                View
              </Link>
            </Button>
          ) : null}
          {item.status === 'failed' && item.error?.openDocumentId ? (
            <Button asChild variant="secondary" size="xs">
              <Link to={documentLink(item.error.openDocumentId)} onClick={onNavigate}>
                <ExternalLink />
                Open it
              </Link>
            </Button>
          ) : null}
          {item.status === 'unknown' ? (
            <Button variant="secondary" size="xs" onClick={() => uploadQueue.check(item.id)}>
              <SearchCheck />
              Check the vault
            </Button>
          ) : null}
          {(item.status === 'failed' && item.error?.retryable) || item.status === 'cancelled' ? (
            <Tooltip content="Send it again">
              <Button variant="ghost" size="icon-xs" className="text-faint" onClick={() => uploadQueue.retry(item.id)} aria-label={`Retry ${item.file.name}`}>
                <RotateCcw />
              </Button>
            </Tooltip>
          ) : null}
          {item.status === 'queued' || item.status === 'uploading' ? (
            <Tooltip content="Cancel">
              <Button variant="ghost" size="icon-xs" className="text-faint" onClick={() => uploadQueue.cancel(item.id)} aria-label={`Cancel ${item.file.name}`}>
                <X />
              </Button>
            </Tooltip>
          ) : null}
        </div>
      </div>
      {item.status === 'uploading' ? <ProgressBar value={item.progress} className="mt-2 ml-[34px]" /> : null}
      {(item.status === 'failed' || item.status === 'unknown') && item.error ? (
        <div
          className={cn(
            'mt-1.5 ml-[34px] flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs leading-relaxed',
            item.status === 'unknown' ? 'text-warning-700' : 'text-danger-700',
          )}
        >
          <span>
            {item.error.message}
            {item.status === 'unknown' ? ' It is not sent again automatically: check the vault first.' : null}
          </span>
          {item.requestId ? <RequestReference requestId={item.requestId} /> : null}
        </div>
      ) : null}
      {item.status === 'done' && item.foundByCheck ? (
        <p className="mt-1 ml-[34px] text-xs text-muted">Found in the vault: the upload had gone through.</p>
      ) : null}
    </li>
  );
}

function StatusLine({ item, held, resumeIn }: { item: UploadItem; held: boolean; resumeIn: number }) {
  switch (item.status) {
    case 'queued':
      return held ? (
        <span className="flex items-center gap-1 text-warning-700">
          <Clock className="size-3" aria-hidden />
          Upload limit reached · starts in <span className="font-mono tabular">{formatCountdown(resumeIn)}</span>
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <Clock className="size-3" aria-hidden />
          Waiting
        </span>
      );
    case 'uploading':
      return (
        <span className="flex items-center gap-1 text-brand-700">
          <Spinner className="size-3" />
          {item.progress >= 1 ? 'Checking the file…' : <span className="tabular">Uploading {Math.round(item.progress * 100)}%</span>}
        </span>
      );
    case 'done':
      return (
        <span className="flex items-center gap-1 text-success-700">
          <CircleCheck className="size-3" aria-hidden />
          Uploaded · queued for processing
        </span>
      );
    case 'failed':
      return (
        <span className="flex items-center gap-1 text-danger-700">
          <CircleAlert className="size-3" aria-hidden />
          Not uploaded
        </span>
      );
    case 'cancelled':
      return (
        <span className="flex items-center gap-1">
          <Ban className="size-3" aria-hidden />
          Cancelled
        </span>
      );
    case 'unknown':
      return (
        <span className="flex items-center gap-1 text-warning-700">
          <CircleHelp className="size-3" aria-hidden />
          Outcome unknown
        </span>
      );
    case 'checking':
      return (
        <span className="flex items-center gap-1 text-brand-700">
          <Spinner className="size-3" />
          Checking the vault…
        </span>
      );
  }
}
