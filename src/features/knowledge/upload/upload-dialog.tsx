import { CircleAlert, FilePlus2, Info, Lock, ShieldAlert, Upload, UploadCloud } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { TagInput } from '@/components/ui/tag-input';
import type { Classification, KnowledgeBase } from '@/lib/api/types';
import { defaultUploadClassification, withinClearance } from '@/lib/knowledge/access';
import { setVisibleBatch, uploadQueue, useUploadQueue } from '@/lib/knowledge/app-upload-queue';
import { ACCEPT_ATTRIBUTE, filenameStem, precheckFile } from '@/lib/knowledge/files';
import { itemsOfBatch, summarizeUploads } from '@/lib/knowledge/upload-queue';
import { cn, pluralize } from '@/lib/utils';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { ClassificationBadge } from '../shared/badges';
import { KnowledgeBaseDot } from '../shared/kb-identity';
import { CLASSIFICATION_META, classificationLabel } from '../shared/meta';
import { useKnowledgeAccess, useKnowledgeBases, useLayerGap } from '../shared/use-knowledge-access';
import { PickedFileRow, ProgressBar, UploadItemRow } from './upload-rows';

const TITLE_MAX = 255;
const DESCRIPTION_MAX = 2000;
const TAG_MAX = 40;
const TAGS_MAX = 20;

type Phase = { kind: 'compose' } | { kind: 'progress'; batchId: string };

/**
 * Upload documents (§5 "Upload"). The files live with the caller so files dropped on the
 * page while the dialog is open join the list. Once sent, the dialog follows the
 * batch; closing it leaves the uploads running in the background.
 */
export function UploadDialog({
  open,
  onOpenChange,
  files,
  onFilesChange,
  defaultKnowledgeBaseId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: File[];
  onFilesChange: (files: File[]) => void;
  defaultKnowledgeBaseId?: string | null;
}) {
  const [session, setSession] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: 'compose' });

  /** Back to a fresh form; `keepFiles` keeps files dropped while a batch was showing. */
  const compose = (keepFiles = false) => {
    setSession((value) => value + 1);
    setPhase({ kind: 'compose' });
    if (!keepFiles) onFilesChange([]);
  };
  const close = () => {
    onOpenChange(false);
    // After the close animation, so the dialog doesn't change under the user.
    window.setTimeout(() => compose(), 200);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent size="xl" onInteractOutside={(event) => phase.kind === 'compose' && files.length > 0 && event.preventDefault()}>
        {phase.kind === 'compose' ? (
          <ComposeForm
            key={session}
            files={files}
            onFilesChange={onFilesChange}
            defaultKnowledgeBaseId={defaultKnowledgeBaseId ?? null}
            onCancel={close}
            onStarted={(batchId) => {
              setPhase({ kind: 'progress', batchId });
              // The files are in the queue now; anything dropped from here on is a new upload.
              onFilesChange([]);
            }}
          />
        ) : (
          <ProgressView
            batchId={phase.batchId}
            newFiles={files.length}
            onClose={close}
            onUploadMore={() => compose(files.length > 0)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Compose ─────────────────────────────────────────────────────────────────

function ComposeForm({
  files,
  onFilesChange,
  defaultKnowledgeBaseId,
  onCancel,
  onStarted,
}: {
  files: File[];
  onFilesChange: (files: File[]) => void;
  defaultKnowledgeBaseId: string | null;
  onCancel: () => void;
  onStarted: (batchId: string) => void;
}) {
  const workspace = useWorkspace();
  const access = useKnowledgeAccess();
  const knowledgeBases = useKnowledgeBases();
  const layer = useLayerGap();
  const remaining = useUploadQueue((state) => state.remaining[workspace.id]);
  const picker = useRef<HTMLInputElement>(null);

  const uploadable = useMemo(
    () => knowledgeBases.list.filter((knowledgeBase) => access.can('upload', knowledgeBase)),
    [knowledgeBases.list, access],
  );
  const readOnly = useMemo(
    () => knowledgeBases.list.filter((knowledgeBase) => !access.can('upload', knowledgeBase)),
    [knowledgeBases.list, access],
  );

  // Choices the user made; until then, defaults follow the data (§5 "Upload").
  const [pickedKb, setPickedKb] = useState<string | null>(null);
  const [pickedClassification, setPickedClassification] = useState<Classification | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);

  const knowledgeBase: KnowledgeBase | undefined =
    uploadable.find((candidate) => candidate.id === pickedKb) ??
    uploadable.find((candidate) => candidate.id === defaultKnowledgeBaseId) ??
    (uploadable.length === 1 ? uploadable[0] : undefined);

  const suggested = knowledgeBase ? defaultUploadClassification(knowledgeBase, access.permissions) : null;
  // Follows the chosen base's default until the user picks one (§5 "Upload").
  const classification: Classification | null =
    pickedClassification && withinClearance(pickedClassification, access.clearance) ? pickedClassification : (suggested?.value ?? null);

  const checked = files.map((file) => ({ file, problem: precheckFile(file) }));
  const sendable = checked.filter((entry) => !entry.problem);
  const single = sendable.length === 1 ? sendable[0].file : null;

  const titleError = title.trim().length > TITLE_MAX ? `Use no more than ${TITLE_MAX} characters.` : undefined;
  const descriptionError = description.length > DESCRIPTION_MAX ? `Use no more than ${DESCRIPTION_MAX} characters.` : undefined;
  const blocked = layer.blocked('upload');
  const canSubmit = !!knowledgeBase && !!classification && sendable.length > 0 && !titleError && !descriptionError && !blocked;

  const submit = () => {
    setSubmitted(true);
    if (!canSubmit || !knowledgeBase || !classification) return;
    const batchId = uploadQueue.enqueue(
      workspace.id,
      sendable.map(({ file }) => ({
        knowledgeBaseId: knowledgeBase.id,
        knowledgeBaseName: knowledgeBase.name,
        file,
        fields: {
          // Always sent: an upload without one uses the base's default, which may be above your clearance.
          classification,
          title: single && title.trim() ? title.trim() : undefined,
          description: description.trim() || undefined,
          tags: tags.length ? tags : undefined,
        },
      })),
    );
    onStarted(batchId);
  };

  const header = (
    <DialogHeader
      icon={<UploadCloud />}
      title="Upload documents"
      description="Each file is encrypted before storage, then extracted, chunked and embedded. Personal data is masked before any model sees it."
    />
  );

  if (knowledgeBases.isPending) {
    return (
      <>
        {header}
        <DialogBody className="grid gap-4">
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </DialogBody>
      </>
    );
  }

  if (knowledgeBases.isError) {
    return (
      <>
        {header}
        <DialogBody>
          <ErrorState compact error={knowledgeBases.error} title="We couldn't load the knowledge bases" onRetry={() => void knowledgeBases.refetch()} retrying={knowledgeBases.isFetching} />
        </DialogBody>
      </>
    );
  }

  // §5 "Upload": "If none: replace the dialog with …"
  if (uploadable.length === 0) {
    return (
      <>
        {header}
        <DialogBody>
          <Callout tone="neutral" icon={<Lock className="size-4" />} title="You can't upload to any knowledge base">
            {access.lacks('upload')
              ? "Your role doesn't include uploading documents."
              : 'You have read-only access to every knowledge base you can see. Ask for write access.'}
          </Callout>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel}>
            Close
          </Button>
        </DialogFooter>
      </>
    );
  }

  const addFiles = (more: File[]) => onFilesChange([...files, ...more].slice(0, 100));

  return (
    <form
      noValidate
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {header}
      <DialogBody className="grid gap-5">
        {blocked ? (
          <Callout tone="info" title="Uploads aren't set up on this server yet">
            The server needs object storage, the vector store and the AI service before it can take documents.
          </Callout>
        ) : null}

        <section aria-label="Files" className="rounded-lg border border-line">
          <header className="flex items-center justify-between gap-3 border-b border-line px-3.5 py-2">
            <p className="text-[13px] font-medium text-ink-soft">
              {files.length === 0 ? 'No files yet' : pluralize(sendable.length, 'file') + ' to upload'}
              {checked.length > sendable.length ? (
                <span className="font-normal text-danger-700"> · {checked.length - sendable.length} can't be sent</span>
              ) : null}
            </p>
            <Button variant="ghost" size="xs" onClick={() => picker.current?.click()}>
              <FilePlus2 />
              {files.length ? 'Add more' : 'Choose files'}
            </Button>
            <input
              ref={picker}
              type="file"
              multiple
              accept={ACCEPT_ATTRIBUTE}
              className="hidden"
              onChange={(event) => {
                const picked = Array.from(event.target.files ?? []);
                event.target.value = '';
                if (picked.length) addFiles(picked);
              }}
            />
          </header>
          {files.length ? (
            <ul className="scrollbar-thin max-h-56 divide-y divide-line/70 overflow-y-auto px-3.5">
              {/* Files that can't be sent come first, so they're noticed before uploading. */}
              {checked
                .map((entry, index) => ({ ...entry, index }))
                .sort((a, b) => Number(!!b.problem) - Number(!!a.problem))
                .map(({ file, problem, index }) => (
                  <PickedFileRow
                    key={`${file.name}:${file.size}:${file.lastModified}:${index}`}
                    file={file}
                    problem={problem}
                    onRemove={() => onFilesChange(files.filter((_, at) => at !== index))}
                  />
                ))}
            </ul>
          ) : (
            <button
              type="button"
              onClick={() => picker.current?.click()}
              className="flex w-full flex-col items-center gap-1 px-4 py-6 text-center text-[13px] text-muted hover:bg-well/40"
            >
              <Upload className="size-5 text-faint" aria-hidden />
              Drop files anywhere, or click to choose them
              <span className="text-xs text-faint">PDF, Word (.docx), text or Markdown · up to 50 MB each</span>
            </button>
          )}
        </section>
        {submitted && sendable.length === 0 ? (
          <p className="-mt-3 flex items-center gap-1.5 text-[13px] text-danger-700" role="alert">
            <CircleAlert className="size-3.5" aria-hidden />
            Add at least one file that can be uploaded.
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Knowledge base"
            error={submitted && !knowledgeBase ? 'Choose where to upload.' : undefined}
            hint={
              readOnly.length ? (
                <>
                  You can't upload to {readOnly.length === 1 ? readOnly[0].name : `${readOnly.length} other bases`}: read-only
                  access.
                </>
              ) : undefined
            }
          >
            <Select
              value={knowledgeBase?.id}
              placeholder="Choose a knowledge base"
              onValueChange={(value) => setPickedKb(value)}
              options={uploadable.map((candidate) => ({
                value: candidate.id,
                label: candidate.name,
                leading: <KnowledgeBaseDot id={candidate.id} className="mt-[5px]" />,
                description: candidate.accessMode === 'RESTRICTED' ? 'Restricted' : undefined,
              }))}
            />
          </Field>
          <Field
            label="Classification"
            hint={
              suggested?.aboveClearance && knowledgeBase ? (
                <span className="flex items-start gap-1.5 text-warning-700">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  This knowledge base normally classifies uploads as {classificationLabel(knowledgeBase.defaultClassification)},
                  above your clearance.
                </span>
              ) : (
                'Who can read these files: only people cleared for this level.'
              )
            }
          >
            <Select
              value={classification ?? undefined}
              placeholder="Choose a knowledge base first"
              disabled={!knowledgeBase && !pickedClassification}
              onValueChange={(value) => setPickedClassification(value)}
              options={access.assignable.map((value) => ({
                value,
                label: CLASSIFICATION_META[value].label,
                description: CLASSIFICATION_META[value].description,
              }))}
            />
          </Field>
        </div>

        {single ? (
          <Field label="Title" optional error={titleError} hint="Leave empty to use the file name.">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={TITLE_MAX + 20} placeholder={filenameStem(single.name)} />
          </Field>
        ) : null}

        <Field
          label="Description"
          optional
          error={descriptionError}
          hint={
            <span className="tabular">
              {description.length}/{DESCRIPTION_MAX}
              {sendable.length > 1 ? ' · Applies to every file in this upload.' : null}
            </span>
          }
        >
          <Textarea rows={2} className="min-h-16" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What these documents are about" />
        </Field>

        <Field label="Tags" optional hint={`Up to ${TAGS_MAX} tags of ${TAG_MAX} characters. Stored in lower case.`}>
          <TagInput
            value={tags}
            onChange={setTags}
            max={TAGS_MAX}
            normalize={(entry) => entry.trim().toLowerCase()}
            validate={(entry) => (entry.length > TAG_MAX ? `Tags are at most ${TAG_MAX} characters.` : null)}
            placeholder="policy, 2026, remote-work"
          />
        </Field>

        {typeof remaining === 'number' && remaining < sendable.length ? (
          <Callout tone="warning" icon={<Info className="size-4" />}>
            You have {pluralize(Math.max(0, remaining), 'upload')} left this hour. The rest will wait until the limit
            resets.
          </Callout>
        ) : null}
      </DialogBody>
      <DialogFooter className="sm:justify-between">
        <p className="hidden items-center gap-2 text-xs text-muted sm:flex">
          {classification && knowledgeBase ? (
            <>
              <KnowledgeBaseDot id={knowledgeBase.id} />
              <span className="max-w-40 truncate">{knowledgeBase.name}</span>
              <span aria-hidden>·</span>
              <ClassificationBadge classification={classification} />
            </>
          ) : null}
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitted && !canSubmit}>
            <Upload />
            {sendable.length > 1 ? `Upload ${sendable.length} files` : 'Upload'}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

// ── Progress ────────────────────────────────────────────────────────────────

function ProgressView({
  batchId,
  newFiles,
  onClose,
  onUploadMore,
}: {
  batchId: string;
  /** Files dropped while this batch was showing, waiting to be set up. */
  newFiles: number;
  onClose: () => void;
  onUploadMore: () => void;
}) {
  const workspace = useWorkspace();
  const items = useUploadQueue((state) => state.items);
  const hold = useUploadQueue((state) => state.holds[workspace.id]);
  const batch = useMemo(() => itemsOfBatch(items, batchId), [items, batchId]);
  const summary = summarizeUploads(batch);
  const knowledgeBaseName = batch[0]?.knowledgeBaseName;

  // While this dialog shows the batch, its end isn't announced with a toast.
  useEffect(() => {
    setVisibleBatch(batchId);
    return () => setVisibleBatch(null);
  }, [batchId]);

  const title = summary.active
    ? `Uploading ${pluralize(summary.total - summary.cancelled, 'file')}`
    : summary.unknown
      ? 'Some uploads need checking'
      : summary.failed
        ? 'Upload finished with problems'
        : 'Upload complete';

  return (
    <>
      <DialogHeader
        icon={<UploadCloud />}
        title={title}
        description={
          knowledgeBaseName
            ? `To ${knowledgeBaseName}. ${summary.active ? 'You can close this window; uploads carry on in the background.' : 'Uploaded files are queued for processing and appear in the vault as they’re indexed.'}`
            : undefined
        }
      />
      <DialogBody className="grid gap-4">
        <div className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-ink-soft">
              <span className="font-medium text-ink tabular">{summary.done}</span> of {summary.total - summary.cancelled} uploaded
              {summary.failed ? <span className="text-danger-700"> · {summary.failed} failed</span> : null}
              {summary.unknown ? <span className="text-warning-700"> · {summary.unknown} to check</span> : null}
              {summary.cancelled ? <span className="text-muted"> · {summary.cancelled} cancelled</span> : null}
            </span>
            <span className="font-mono text-xs text-muted tabular">{Math.round(summary.progress * 100)}%</span>
          </div>
          <ProgressBar value={summary.progress} tone={!summary.active && summary.failed && !summary.done ? 'danger' : 'brand'} className="h-1.5" />
        </div>
        {summary.unknown && !summary.active ? (
          <Callout
            tone="warning"
            title={`${pluralize(summary.unknown, 'file')} got no answer`}
            action={
              <Button size="xs" variant="secondary" onClick={() => uploadQueue.checkAll(workspace.id)}>
                Check the vault
              </Button>
            }
          >
            The connection dropped or timed out after sending, so {summary.unknown === 1 ? 'it' : 'they'} may have been stored. Checking
            looks for {summary.unknown === 1 ? 'it' : 'them'} by title; only what isn't found can be sent again.
          </Callout>
        ) : null}
        {newFiles > 0 ? (
          <Callout
            tone="info"
            icon={<FilePlus2 className="size-4" />}
            title={`${pluralize(newFiles, 'more file')} dropped`}
            action={
              <Button size="xs" variant="secondary" onClick={onUploadMore}>
                Set {newFiles === 1 ? 'it' : 'them'} up
              </Button>
            }
          >
            Choose where {newFiles === 1 ? 'it goes' : 'they go'} and how {newFiles === 1 ? "it's" : "they're"} classified. This batch keeps
            uploading.
          </Callout>
        ) : null}
        <ul className={cn('scrollbar-thin max-h-80 divide-y divide-line/70 overflow-y-auto rounded-lg border border-line px-3.5')}>
          {batch.map((item) => (
            <UploadItemRow key={item.id} item={item} hold={hold} workspaceSlug={workspace.slug} onNavigate={onClose} />
          ))}
        </ul>
      </DialogBody>
      <DialogFooter>
        {summary.active ? (
          <Button variant="ghost" onClick={() => uploadQueue.cancelBatch(batchId)}>
            Cancel remaining
          </Button>
        ) : (
          <Button variant="ghost" onClick={onUploadMore}>
            Upload more
          </Button>
        )}
        <Button variant={summary.active ? 'secondary' : 'primary'} onClick={onClose}>
          {summary.active ? 'Hide' : 'Done'}
        </Button>
      </DialogFooter>
    </>
  );
}
