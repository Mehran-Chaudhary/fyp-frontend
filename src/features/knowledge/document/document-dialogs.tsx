import { ArrowDown, ArrowUp, RefreshCw, ShieldHalf, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { OutcomeUnknown } from '@/components/feedback/outcome-unknown';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { documentsApi } from '@/lib/api/endpoints';
import { hasCode, isOutcomeUnknown } from '@/lib/api/errors';
import type { Classification, VaultDocument } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { rankOf } from '@/lib/knowledge/access';
import { afterDocumentGone, afterDocumentUpdated } from '@/lib/knowledge/cache';
import { toast } from '@/lib/toast';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { ClassificationBadge } from '../shared/badges';
import { CLASSIFICATION_META, classificationLabel } from '../shared/meta';
import { useKnowledgeAccess } from '../shared/use-knowledge-access';
import { useDeleteDocument, useUpdateDocument } from './document-mutations';

/**
 * P3-API-16 (spec §4.6): the document's key is destroyed in the same step, so the
 * content is unrecoverable at once, backups included. No trash, no undo. A lost
 * answer is never retried blindly: the document is read back first.
 */
export function DeleteDocumentDialog({
  document,
  open,
  onOpenChange,
  onDeleted,
}: {
  document: Pick<VaultDocument, 'id' | 'title'> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const workspace = useWorkspace();
  const remove = useDeleteDocument();
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);

  const close = () => {
    onOpenChange(false);
    window.setTimeout(() => {
      setError(null);
      setUncertain(null);
    }, 200);
  };

  const finished = () => {
    close();
    onDeleted?.();
  };

  /** Reads the document back: 404 means the delete went through. */
  const check = async () => {
    if (!document) return;
    setChecking(true);
    try {
      await documentsApi.get(workspace.id, document.id);
      setUncertain(null);
      setError("It's still there: the delete didn't go through. You can try again.");
    } catch (caught) {
      if (hasCode(caught, 'DOCUMENT_NOT_FOUND')) {
        void afterDocumentGone(workspace.id, document.id);
        toast.success(`Deleted “${document.title}”`, { description: 'Its content was destroyed and can’t be recovered.' });
        finished();
      } else {
        setError(`Couldn't check: ${messageFor(caught)}`);
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      icon={<Trash2 />}
      tone="danger"
      size="md"
      title={`Delete “${document?.title ?? 'this document'}”?`}
      description={
        <>
          Its content is destroyed immediately and <span className="font-medium text-ink-soft">cannot be recovered</span>,
          including from backups. There is no trash or undo. It disappears from search at once.
        </>
      }
      confirmLabel="Delete document"
      confirmDisabled={!!uncertain}
      pending={remove.isPending}
      error={error}
      onConfirm={() => {
        if (!document) return;
        setError(null);
        remove.mutate(document, {
          onSuccess: finished,
          onError: (err) => {
            if (hasCode(err, 'DOCUMENT_NOT_FOUND')) {
              toast.info('It was already deleted', { description: 'The list has been refreshed.' });
              finished();
              return;
            }
            if (isOutcomeUnknown(err)) {
              setUncertain(err);
              return;
            }
            setError(messageFor(err));
          },
        });
      }}
    >
      {uncertain ? (
        <OutcomeUnknown
          error={uncertain}
          action={
            <Button size="xs" variant="secondary" onClick={() => void check()} loading={checking}>
              {checking ? null : <RefreshCw />}
              Check whether it's gone
            </Button>
          }
        >
          No answer arrived, so it may already be deleted. Check before trying again.
        </OutcomeUnknown>
      ) : null}
    </ConfirmDialog>
  );
}

/** P3-API-14 `{ classification }`: applies to listing, reading and search immediately. */
export function ReclassifyDialog({
  document,
  open,
  onOpenChange,
  onGone,
}: {
  document: Pick<VaultDocument, 'id' | 'title' | 'classification'> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGone?: () => void;
}) {
  // A fresh form every time the dialog is reopened (after the close animation).
  const [session, setSession] = useState(0);
  const change = (next: boolean) => {
    onOpenChange(next);
    if (!next) window.setTimeout(() => setSession((value) => value + 1), 200);
  };
  if (!document) return null;
  return <ReclassifyForm key={`${document.id}:${session}`} document={document} open={open} onOpenChange={change} onGone={onGone} />;
}

function ReclassifyForm({
  document,
  open,
  onOpenChange,
  onGone,
}: {
  document: Pick<VaultDocument, 'id' | 'title' | 'classification'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGone?: () => void;
}) {
  const workspace = useWorkspace();
  const access = useKnowledgeAccess();
  const update = useUpdateDocument(document.id);
  // Assignable classifications only (spec §3.3); the old level is implied by being able to see it.
  const [next, setNext] = useState<Classification>(
    access.assignable.includes(document.classification) ? document.classification : (access.assignable[access.assignable.length - 1] ?? 'PUBLIC'),
  );
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);
  const direction = rankOf(next) - rankOf(document.classification);

  const close = () => onOpenChange(false);

  const succeeded = (classification: Classification) => {
    toast.success(`Reclassified as ${classificationLabel(classification)}`, {
      description: 'Lists and search already follow the new classification.',
    });
    close();
  };

  /** A lost answer: read the document back and compare. */
  const check = async () => {
    setChecking(true);
    try {
      const current = await documentsApi.get(workspace.id, document.id);
      void afterDocumentUpdated(workspace.id, current);
      setUncertain(null);
      if (current.classification === next) succeeded(next);
      else setError(`It's still ${classificationLabel(current.classification)}: the change didn't go through. You can try again.`);
    } catch (caught) {
      if (hasCode(caught, 'DOCUMENT_NOT_FOUND')) {
        close();
        onGone?.();
        return;
      }
      setError(`Couldn't check: ${messageFor(caught)}`);
    } finally {
      setChecking(false);
    }
  };

  const submit = () => {
    if (direction === 0) return close();
    setError(null);
    update.mutate(
      { classification: next },
      {
        onSuccess: (updated) => succeeded(updated.classification),
        onError: (err) => {
          if (hasCode(err, 'DOCUMENT_NOT_FOUND')) {
            close();
            onGone?.();
            return;
          }
          if (isOutcomeUnknown(err)) {
            setUncertain(err);
            return;
          }
          setError(messageFor(err));
        },
      },
    );
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(value) => (value ? onOpenChange(true) : close())}
      icon={<ShieldHalf />}
      tone="warning"
      size="md"
      title="Reclassify document"
      description={
        <>
          “{document.title}” is <ClassificationBadge classification={document.classification} className="mx-0.5 align-middle" />.
          People only see documents within their clearance.
        </>
      }
      confirmLabel="Reclassify"
      confirmVariant="primary"
      confirmDisabled={direction === 0 || !!uncertain}
      pending={update.isPending}
      error={error}
      onConfirm={submit}
    >
      <Field label="New classification" hint={`You can assign up to ${classificationLabel(access.clearance)}, your clearance.`}>
        <Select
          value={next}
          onValueChange={(value) => {
            setNext(value);
            setError(null);
          }}
          options={access.assignable.map((classification) => ({
            value: classification,
            label: CLASSIFICATION_META[classification].label,
            description: CLASSIFICATION_META[classification].description,
          }))}
        />
      </Field>
      {direction > 0 ? (
        <Callout tone="warning" icon={<ArrowUp className="size-4" />}>
          Members without {classificationLabel(next)} clearance lose access immediately, including in search.
        </Callout>
      ) : direction < 0 ? (
        <Callout tone="warning" icon={<ArrowDown className="size-4" />}>
          Members with {classificationLabel(next)} clearance can read it from now on, including in search.
        </Callout>
      ) : null}
      {uncertain ? (
        <OutcomeUnknown
          error={uncertain}
          action={
            <Button size="xs" variant="secondary" onClick={() => void check()} loading={checking}>
              {checking ? null : <RefreshCw />}
              Check its classification
            </Button>
          }
        >
          No answer arrived, so the change may have been made. Check before trying again.
        </OutcomeUnknown>
      ) : null}
    </ConfirmDialog>
  );
}
