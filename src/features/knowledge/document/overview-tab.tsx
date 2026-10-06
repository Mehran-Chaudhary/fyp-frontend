import { useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  CloudOff,
  Download,
  FileWarning,
  HardDrive,
  Pencil,
  RotateCcw,
  RotateCw,
  ShieldCheck,
  ShieldHalf,
  Tag,
  Timer,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { DetailRow } from '@/components/ui/card';
import { DrawerSection } from '@/components/ui/drawer';
import { Field, FormError } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { RelativeTime } from '@/components/ui/relative-time';
import { TagInput } from '@/components/ui/tag-input';
import { Tooltip } from '@/components/ui/tooltip';
import { useDialogTarget } from '@/components/ui/use-dialog-target';
import { isApiError } from '@/lib/api/errors';
import type { DocumentProcessingMetrics, UpdateDocumentRequest, VaultDocument } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { formatBytes } from '@/lib/knowledge/files';
import { canReindexNow, displayStatus, failureHint, isInProgress, type FailureKind } from '@/lib/knowledge/status';
import { UPLOAD_DESCRIPTION_MAX, UPLOAD_TAG_MAX_LENGTH, UPLOAD_TAGS_MAX, UPLOAD_TITLE_MAX } from '@/lib/knowledge/upload';
import { documentQuery, memberNamesQuery, meQuery } from '@/lib/queries';
import { toast } from '@/lib/toast';
import { cn, formatDateTime, pluralize } from '@/lib/utils';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { DocumentStatusBadge } from '../shared/badges';
import { ProcessingNotice } from '../shared/processing-notice';
import { useActionGate } from '../shared/use-action-gate';
import { useDocumentContext } from './document-context';
import { DeleteDocumentDialog, ReclassifyDialog } from './document-dialogs';
import { useDownloadDocument, useReindexDocument, useUpdateDocument } from './document-mutations';

const TYPE_LABEL: Record<VaultDocument['fileType'], string> = {
  PDF: 'PDF',
  DOCX: 'Word document',
  TXT: 'Plain text',
  MARKDOWN: 'Markdown',
};

const FAILURE_ICON: Readonly<Record<FailureKind, ReactNode>> = {
  file: <FileWarning className="size-4" />,
  service: <CloudOff className="size-4" />,
  storage: <HardDrive className="size-4" />,
  time: <Timer className="size-4" />,
  unknown: <TriangleAlert className="size-4" />,
};

/** The drawer's Overview tab (spec §5 "Document detail"): status and versions, facts, actions. */
export function DocumentOverviewTab() {
  const { document, knowledgeBase, close } = useDocumentContext();
  const workspace = useWorkspace();
  const gate = useActionGate();
  const reindex = useReindexDocument();
  const downloads = useDownloadDocument();
  const deleteDialog = useDialogTarget<VaultDocument>();
  const reclassifyDialog = useDialogTarget<VaultDocument>();
  const [editing, setEditing] = useState(false);
  const detail = useQuery({ ...documentQuery(workspace.id, document.id), enabled: false });

  const status = displayStatus(document);
  const failed = document.status === 'FAILED';
  const processing = isInProgress(document.status);
  const hint = failed ? failureHint(document.failureCode) : null;

  const edit = gate('editDocument', knowledgeBase);
  const reindexGate = gate('reindex', knowledgeBase);
  const download = gate('download', knowledgeBase);
  const del = gate('deleteDocument', knowledgeBase);
  const reindexing = reindex.isPending;

  return (
    <>
      {/* ── Status (spec §4.1–4.3) ── */}
      <DrawerSection title="Status" description="The latest processing run, and what search serves meanwhile.">
        <div className="grid grid-cols-1 gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <DocumentStatusBadge document={document} />
            {status.stage ? <span className="text-[13px] text-muted">{status.stage}</span> : null}
          </div>

          {failed ? (
            <Callout
              tone={status.previousVersionServing ? 'warning' : 'danger'}
              icon={hint ? FAILURE_ICON[hint.kind] : undefined}
              title={status.previousVersionServing ? 'Reindex failed · previous version still searchable' : 'Processing failed'}
              action={
                <RetryAction
                  visible={reindexGate.visible}
                  reason={reindexGate.reason}
                  retryHelps={hint?.retryHelps ?? true}
                  pending={reindexing}
                  onRetry={() => reindex.mutate(document)}
                />
              }
            >
              {/* Always the server's sentence (§4.3); the code only picks the hint and icon. */}
              <p>{document.statusMessage ?? 'The document could not be processed.'}</p>
              {hint?.hint ? <p className="mt-1 opacity-90">{hint.hint}</p> : null}
              {document.failureCode ? <p className="mt-1 font-mono text-[11px] opacity-70">{document.failureCode}</p> : null}
            </Callout>
          ) : null}
          {status.retrying ? (
            <Callout tone="warning" icon={<RotateCw className="size-4" />} title="Retrying">
              {document.statusMessage} The server retries on its own with growing pauses; nothing needs doing yet.
            </Callout>
          ) : null}
          {status.previousVersionServing && processing ? (
            <Callout tone="info" icon={<ShieldCheck className="size-4" />} title="Reindexing">
              Version {document.activeIndexVersion} keeps answering searches until version {document.indexVersion} is ready.
            </Callout>
          ) : null}
          {processing ? (
            <ProcessingNotice
              queryKey={documentQuery(workspace.id, document.id).queryKey}
              documents={[document]}
              onRefresh={() => void detail.refetch()}
              refreshing={detail.isFetching}
            />
          ) : null}

          <dl className="divide-y divide-line/70 rounded-lg border border-line px-3.5">
            <DetailRow label="Searchable">
              {document.isSearchable ? (
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5 text-success-600" aria-hidden />
                  Yes · version {document.activeIndexVersion}
                </span>
              ) : (
                <Muted>{processing ? 'Not yet: the first run is in progress' : 'No'}</Muted>
              )}
            </DetailRow>
            <DetailRow label="Processing run">
              <span>
                Version {document.indexVersion}
                <Muted>{processing ? ' · in progress' : failed ? ' · failed' : ' · finished'}</Muted>
              </span>
            </DetailRow>
            <DetailRow label="Last status change">
              <span title={formatDateTime(document.lastStatusAt)}>
                <RelativeTime value={document.lastStatusAt} />
              </span>
            </DetailRow>
            <DetailRow label="Processed">
              {document.processingCompletedAt ? formatDateTime(document.processingCompletedAt) : <Muted>{processing ? 'In progress' : '—'}</Muted>}
            </DetailRow>
          </dl>
        </div>
      </DrawerSection>

      {/* ── Actions (gated per spec §3.5) ── */}
      <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3.5 sm:px-6">
        {edit.visible ? (
          <GatedButton reason={edit.reason} icon={<Pencil />} label="Edit details" onClick={() => setEditing(true)} disabled={editing} />
        ) : null}
        {edit.visible ? (
          <GatedButton reason={edit.reason} icon={<ShieldHalf />} label="Reclassify" onClick={() => reclassifyDialog.show(document)} />
        ) : null}
        {reindexGate.visible && !failed ? (
          <GatedButton
            reason={reindexGate.reason ?? (canReindexNow(document) ? null : 'Already being processed')}
            icon={<RotateCw />}
            label="Reindex"
            loading={reindexing}
            tooltip="Re-run extraction, chunking and embedding. The current version keeps answering searches until the new one is ready."
            onClick={() => reindex.mutate(document)}
          />
        ) : null}
        {download.visible ? (
          <GatedButton
            reason={download.reason}
            icon={<Download />}
            label={downloads.isPending(document.id) ? 'Downloading…' : 'Download original'}
            loading={downloads.isPending(document.id)}
            tooltip="The original file, byte for byte. Every download is recorded in the audit log."
            onClick={() => void downloads.download(document)}
          />
        ) : null}
        {del.visible ? (
          <GatedButton reason={del.reason} icon={<Trash2 />} label="Delete" variant="danger-outline" onClick={() => deleteDialog.show(document)} />
        ) : null}
        {!edit.visible && !reindexGate.visible && !download.visible && !del.visible ? (
          <p className="text-[13px] text-muted">You can read this document. Your role doesn't include changing it.</p>
        ) : null}
      </div>

      <DrawerSection title="Details">
        <dl className="divide-y divide-line/70">
          <DetailRow label="Original file">
            <span className="break-all">{document.originalFilename}</span>
          </DetailRow>
          <DetailRow label="Type">
            {TYPE_LABEL[document.fileType] ?? document.fileType}{' '}
            <span className="font-mono text-[11.5px] font-normal text-muted" title="Detected from the file's contents">
              {document.mimeType}
            </span>
          </DetailRow>
          <DetailRow label="Size">
            <span className="font-mono tabular">{formatBytes(document.sizeBytes)}</span>
          </DetailRow>
          <DetailRow label="Pages">{document.pageCount ?? <Muted>{document.fileType === 'PDF' ? '—' : 'Not paged'}</Muted>}</DetailRow>
          <DetailRow label="Language">{document.language ? document.language.toUpperCase() : <Muted>Not detected yet</Muted>}</DetailRow>
          <DetailRow label="Chunks">
            {document.isSearchable || document.chunkCount > 0 ? (
              <span className="font-mono tabular">{document.chunkCount.toLocaleString()}</span>
            ) : (
              <Muted>—</Muted>
            )}
          </DetailRow>
          <DetailRow label="Tokens">
            {document.tokenCount ? <span className="font-mono tabular">{document.tokenCount.toLocaleString()}</span> : <Muted>—</Muted>}
          </DetailRow>
          <DetailRow label="Embedding model">
            {document.embeddingModel ? <span className="font-mono text-[12px]">{document.embeddingModel}</span> : <Muted>—</Muted>}
          </DetailRow>
          <DetailRow label="Uploaded by">
            <UploadedBy userId={document.uploadedById} />
          </DetailRow>
          <DetailRow label="Added">{formatDateTime(document.createdAt)}</DetailRow>
          <DetailRow label="Last change">
            <RelativeTime value={document.updatedAt} />
          </DetailRow>
        </dl>
      </DrawerSection>

      <DrawerSection
        title="Description and tags"
        actions={
          edit.visible && !editing && !edit.reason ? (
            <Button variant="ghost" size="xs" onClick={() => setEditing(true)}>
              <Pencil />
              Edit
            </Button>
          ) : null
        }
      >
        {editing ? (
          <EditForm document={document} onDone={() => setEditing(false)} onGone={close} />
        ) : (
          <div className="grid gap-3">
            {document.description ? (
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink-soft">{document.description}</p>
            ) : (
              <p className="text-[13px] text-faint">No description.</p>
            )}
            {document.tags.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {document.tags.map((tag) => (
                  <li key={tag} className="inline-flex items-center gap-1 rounded-md border border-line bg-well px-1.5 py-0.5 text-[12px] text-ink-soft">
                    <Tag className="size-3 text-faint" aria-hidden />
                    {tag}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </DrawerSection>

      <ProcessingSection metrics={document.processingMetrics} />

      <DeleteDocumentDialog document={deleteDialog.target} open={deleteDialog.open} onOpenChange={deleteDialog.onOpenChange} onDeleted={close} />
      <ReclassifyDialog document={reclassifyDialog.target} open={reclassifyDialog.open} onOpenChange={reclassifyDialog.onOpenChange} onGone={close} />
    </>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="font-normal text-faint">{children}</span>;
}

function GatedButton({
  reason,
  icon,
  label,
  onClick,
  loading,
  disabled,
  tooltip,
  variant = 'secondary',
}: {
  reason: string | null;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  tooltip?: string;
  variant?: 'secondary' | 'danger-outline';
}) {
  const content = reason ?? tooltip;
  return (
    <Tooltip content={content} disabled={!content}>
      <span tabIndex={reason ? 0 : -1} className="inline-flex rounded-lg">
        <Button variant={variant} size="sm" onClick={onClick} disabled={!!reason || disabled || loading} loading={loading}>
          {loading ? null : icon}
          {label}
        </Button>
      </span>
    </Tooltip>
  );
}

/** Retry (P3-API-15): offered where it can help; otherwise "Retry anyway" with the reason. */
function RetryAction({
  visible,
  reason,
  retryHelps,
  pending,
  onRetry,
}: {
  visible: boolean;
  reason: string | null;
  retryHelps: boolean;
  pending: boolean;
  onRetry: () => void;
}) {
  if (!visible) {
    // They can see it failed but not reindex (e.g. a Viewer).
    return <p className="text-[12.5px] opacity-90">Ask someone who can reindex documents to retry it.</p>;
  }
  if (!retryHelps) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip content={reason ?? 'The file itself is the problem, so this will probably fail again.'}>
          <span tabIndex={0} className="inline-flex rounded-lg">
            <Button size="xs" variant="secondary" onClick={onRetry} disabled={!!reason || pending} loading={pending}>
              {pending ? null : <RotateCcw />}
              Try again anyway
            </Button>
          </span>
        </Tooltip>
        <span className="text-[12px] opacity-80">This will probably fail again.</span>
      </div>
    );
  }
  return (
    <Tooltip content={reason} disabled={!reason}>
      <span tabIndex={reason ? 0 : -1} className="inline-flex rounded-lg">
        <Button size="xs" variant="secondary" onClick={onRetry} disabled={!!reason || pending} loading={pending}>
          {pending ? null : <RotateCcw />}
          Retry
        </Button>
      </span>
    </Tooltip>
  );
}

/**
 * `uploadedById` is a user id: the uploader's name isn't returned (spec §6), so it
 * is resolved through the member directory, removed members included, where you
 * may read it.
 */
function UploadedBy({ userId }: { userId: string | null }) {
  const workspace = useWorkspace();
  const can = useCan();
  const { data: me } = useQuery(meQuery);
  const names = useQuery({ ...memberNamesQuery(workspace.id), enabled: !!userId && userId !== me?.id && can('member:read') });

  if (!userId) return <Muted>An API key, or an account that was erased</Muted>;
  if (userId === me?.id) return <>You</>;
  if (!can('member:read')) return <Muted>Another member</Muted>;
  if (names.isPending) return <Muted>…</Muted>;
  const entry = names.data?.get(userId);
  if (!entry) return <Muted>Unknown member</Muted>;
  return (
    <>
      {entry.name}
      {entry.removed ? <Muted> · no longer a member</Muted> : null}
    </>
  );
}

// ── Editing (P3-API-14) ─────────────────────────────────────────────────────

function EditForm({ document, onDone, onGone }: { document: VaultDocument; onDone: () => void; onGone: () => void }) {
  const update = useUpdateDocument(document.id);
  const [baseline] = useState(document);
  const [title, setTitle] = useState(document.title);
  const [description, setDescription] = useState(document.description ?? '');
  const [tags, setTags] = useState<string[]>(document.tags);
  const [errors, setErrors] = useState<{ title?: string; description?: string; tags?: string; form?: string }>({});

  // Only what this form changed, relative to the copy it opened with (spec §9.4).
  const sameTags = tags.length === baseline.tags.length && tags.every((tag, index) => tag === baseline.tags[index]);
  const body: UpdateDocumentRequest = {};
  if (title.trim() !== baseline.title) body.title = title.trim();
  if (description.trim() !== (baseline.description ?? '')) body.description = description.trim() || null;
  if (!sameTags) body.tags = tags;
  const dirty = Object.keys(body).length > 0;
  // Someone else saved while this form was open.
  const changedElsewhere =
    dirty &&
    (document.title !== baseline.title ||
      document.description !== baseline.description ||
      document.tags.join('\u0000') !== baseline.tags.join('\u0000'));

  const submit = () => {
    const problems: typeof errors = {};
    if (!title.trim()) problems.title = 'Give the document a title.';
    else if (title.trim().length > UPLOAD_TITLE_MAX) problems.title = `Use no more than ${UPLOAD_TITLE_MAX} characters.`;
    if (description.length > UPLOAD_DESCRIPTION_MAX) problems.description = `Use no more than ${UPLOAD_DESCRIPTION_MAX} characters.`;
    setErrors(problems);
    if (Object.keys(problems).length) return;
    if (!dirty) return onDone();

    update.mutate(body, {
      onSuccess: () => {
        toast.success('Document saved');
        onDone();
      },
      onError: (error) => {
        if (isApiError(error) && error.code === 'DOCUMENT_NOT_FOUND') return onGone();
        if (isApiError(error) && error.code === 'VALIDATION_FAILED') {
          const fields = error.fieldErrors({ fields: ['title', 'description', 'tags'] });
          setErrors({ title: fields.title, description: fields.description, tags: fields.tags, form: fields._form });
          return;
        }
        setErrors({ form: messageFor(error) });
      },
    });
  };

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {changedElsewhere ? (
        <Callout tone="warning" title="This document changed while you were editing">
          Saving sends only the fields you changed; the rest keeps the newer values.
        </Callout>
      ) : null}
      <Field label="Title" error={errors.title}>
        <Input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={UPLOAD_TITLE_MAX + 20} />
      </Field>
      <Field
        label="Description"
        optional
        error={errors.description}
        hint={<span className="tabular">{description.length}/{UPLOAD_DESCRIPTION_MAX} · Leave empty to remove it.</span>}
      >
        <Textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      <Field
        label="Tags"
        optional
        error={errors.tags}
        hint={`Up to ${UPLOAD_TAGS_MAX} tags of ${UPLOAD_TAG_MAX_LENGTH} characters, stored in lower case. Saving replaces the tags; removing them all clears them.`}
      >
        <TagInput
          value={tags}
          onChange={setTags}
          max={UPLOAD_TAGS_MAX}
          normalize={(entry) => entry.trim().toLowerCase()}
          validate={(entry) => (entry.length > UPLOAD_TAG_MAX_LENGTH ? `Tags are at most ${UPLOAD_TAG_MAX_LENGTH} characters.` : null)}
          placeholder="Add a tag"
        />
      </Field>
      <FormError message={errors.form} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone} disabled={update.isPending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!dirty} loading={update.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}

// ── Processing metrics (keys are open, spec §5) ─────────────────────────────

const KNOWN_SEGMENTS: ReadonlyArray<{ key: string; label: string; color: string }> = [
  { key: 'queueWaitMs', label: 'Queue', color: 'bg-line-strong' },
  { key: 'downloadMs', label: 'Download', color: 'bg-[#c9b48a]' },
  { key: 'parseMs', label: 'Text extraction', color: 'bg-info-500' },
  { key: 'persistMs', label: 'Chunks saved', color: 'bg-[#8b74b3]' },
  { key: 'embedMs', label: 'Embedding', color: 'bg-brand-500' },
  { key: 'indexMs', label: 'Indexing', color: 'bg-warning-500' },
];
const KNOWN_KEYS = new Set(['totalMs', 'attempts', 'embeddingTokens', ...KNOWN_SEGMENTS.map((segment) => segment.key)]);

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** "chunkTokensMax" → "Chunk tokens max"; a duration when the key ends in Ms. */
function humanizeMetric(key: string): string {
  const words = key.replace(/Ms$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function ProcessingSection({ metrics }: { metrics: DocumentProcessingMetrics }) {
  const [open, setOpen] = useState(false);
  const values = Object.entries(metrics ?? {}).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]));
  const value = (key: string) => values.find(([name]) => name === key)?.[1];
  const present = KNOWN_SEGMENTS.filter((segment) => value(segment.key) !== undefined);
  const sum = present.reduce((total, segment) => total + (value(segment.key) ?? 0), 0);
  const total = value('totalMs') ?? sum;
  const attempts = value('attempts');
  const others = values.filter(([key]) => !KNOWN_KEYS.has(key));
  if (values.length === 0) return null;

  return (
    <section className="border-b border-line px-5 py-5 last:border-b-0 sm:px-6">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-md text-left"
      >
        <span>
          <span className="block text-[13.5px] font-semibold text-ink">Timings</span>
          <span className="mt-0.5 block text-[13px] text-muted">
            {total ? `${formatMs(total)} in total` : 'Timings of the last run'}
            {attempts ? ` · ${pluralize(attempts, 'attempt')}` : null}
          </span>
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-faint transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden />
      </button>
      {present.length && sum > 0 ? (
        <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-well-strong" aria-hidden>
          {present.map((segment) => (
            <span key={segment.key} className={segment.color} style={{ width: `${((value(segment.key) ?? 0) / sum) * 100}%` }} />
          ))}
        </div>
      ) : null}
      {open ? (
        <dl className="mt-3 grid gap-1.5 text-[12.5px] sm:grid-cols-2">
          {present.map((segment) => (
            <MetricRow key={segment.key} label={segment.label} value={formatMs(value(segment.key) ?? 0)} swatch={segment.color} />
          ))}
          {value('embeddingTokens') !== undefined ? (
            <MetricRow label="Embedding tokens" value={(value('embeddingTokens') ?? 0).toLocaleString()} />
          ) : null}
          {attempts !== undefined ? <MetricRow label="Attempts" value={String(attempts)} /> : null}
          {others.map(([key, metric]) => (
            <MetricRow key={key} label={humanizeMetric(key)} value={key.endsWith('Ms') ? formatMs(metric) : metric.toLocaleString()} />
          ))}
        </dl>
      ) : null}
    </section>
  );
}

function MetricRow({ label, value, swatch }: { label: string; value: string; swatch?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-well/50 px-2.5 py-1.5">
      <dt className="flex items-center gap-2 text-muted">
        {swatch ? <span className={cn('size-2 rounded-sm', swatch)} aria-hidden /> : null}
        {label}
      </dt>
      <dd className="font-mono text-ink-soft tabular">{value}</dd>
    </div>
  );
}
