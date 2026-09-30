import { ArrowDown, ArrowUp, ShieldHalf, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Callout } from '@/components/ui/callout';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { hasCode } from '@/lib/api/errors';
import type { Classification, VaultDocument } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { rankOf } from '@/lib/knowledge/access';
import { toast } from '@/lib/toast';
import { ClassificationBadge } from '../shared/badges';
import { CLASSIFICATION_META, classificationLabel } from '../shared/meta';
import { useKnowledgeAccess } from '../shared/use-knowledge-access';
import { useDeleteDocument, useUpdateDocument } from './document-mutations';

/** E75: "Its content is destroyed immediately and cannot be recovered, including from backups." (§6.4) */
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
  const remove = useDeleteDocument();
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    onOpenChange(false);
    window.setTimeout(() => setError(null), 200);
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
          including from backups. It disappears from search at once.
        </>
      }
      confirmLabel="Delete document"
      pending={remove.isPending}
      error={error}
      onConfirm={() =>
        document &&
        remove.mutate(document, {
          onSuccess: () => {
            close();
            onDeleted?.();
          },
          onError: (err) => {
            if (hasCode(err, 'DOCUMENT_NOT_FOUND')) {
              toast.info('It was already deleted', { description: 'The list has been refreshed.' });
              close();
              onDeleted?.();
              return;
            }
            setError(messageFor(err));
          },
        })
      }
    />
  );
}

/** E73 `{ classification }`: applies to retrieval immediately (§6.4). */
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
  const access = useKnowledgeAccess();
  const update = useUpdateDocument(document.id);
  const [next, setNext] = useState<Classification>(document.classification);
  const [error, setError] = useState<string | null>(null);
  const direction = rankOf(next) - rankOf(document.classification);

  const close = () => onOpenChange(false);

  const submit = () => {
    if (direction === 0) return close();
    update.mutate(
      { classification: next },
      {
        onSuccess: (updated) => {
          toast.success(`Reclassified as ${classificationLabel(updated.classification)}`, {
            description: 'Search already follows the new classification.',
          });
          close();
        },
        onError: (err) => {
          if (hasCode(err, 'DOCUMENT_NOT_FOUND')) {
            close();
            onGone?.();
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
      confirmDisabled={direction === 0}
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
      {direction < 0 ? (
        <Callout tone="warning" icon={<ArrowDown className="size-4" />}>
          Lowering the classification makes this document visible to more people.
        </Callout>
      ) : direction > 0 ? (
        <Callout tone="warning" icon={<ArrowUp className="size-4" />}>
          People below {classificationLabel(next)} lose access immediately, including in search.
        </Callout>
      ) : null}
    </ConfirmDialog>
  );
}
