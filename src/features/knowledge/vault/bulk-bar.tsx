import { RotateCw, ShieldHalf, Trash2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import type { Classification, KnowledgeBase, VaultDocument } from '@/lib/api/types';
import { pluralize } from '@/lib/utils';
import { CLASSIFICATION_META } from '../shared/meta';
import { useKnowledgeAccess } from '../shared/use-knowledge-access';
import { useBulkActions, type BulkKind } from './use-bulk-actions';

/** The bar that appears over the table's foot when rows are selected (§5 "Document Vault"). */
export function BulkBar({
  selected,
  knowledgeBases,
  onClear,
  onDone,
}: {
  selected: readonly VaultDocument[];
  knowledgeBases: ReadonlyMap<string, KnowledgeBase>;
  onClear: () => void;
  onDone: (kind: BulkKind, succeeded: string[]) => void;
}) {
  const access = useKnowledgeAccess();
  const bulk = useBulkActions(knowledgeBases);
  const [dialog, setDialog] = useState<'reclassify' | 'delete' | null>(null);
  const [classification, setClassification] = useState<Classification>(access.assignable[access.assignable.length - 1] ?? 'PUBLIC');

  if (selected.length === 0) return null;
  const count = (kind: BulkKind) => bulk.eligible(kind, selected).length;
  const busy = bulk.running !== null;

  const start = async (kind: BulkKind) => {
    setDialog(null);
    const { succeeded } = await bulk.run(kind, selected, kind === 'reclassify' ? { classification } : {});
    onDone(kind, succeeded);
  };

  return (
    <>
      <div
        role="region"
        aria-label="Bulk actions"
        className="sticky bottom-3 z-20 mx-3 mb-3 flex flex-wrap items-center gap-1.5 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-ink shadow-pop animate-pop-in sm:mx-4"
      >
        <span className="px-1 text-[13px] font-medium text-brand-900 tabular">{pluralize(selected.length, 'document')} selected</span>
        <span className="mx-1 h-4 w-px bg-brand-200" aria-hidden />
        {!access.lacks('reindex') ? (
          <BarButton icon={<RotateCw />} label="Reindex" count={count('reindex')} disabled={busy} onClick={() => void start('reindex')} />
        ) : null}
        {!access.lacks('editDocument') ? (
          <BarButton icon={<ShieldHalf />} label="Reclassify" count={count('reclassify')} disabled={busy} onClick={() => setDialog('reclassify')} />
        ) : null}
        {!access.lacks('deleteDocument') ? (
          <BarButton icon={<Trash2 />} label="Delete" count={count('delete')} danger disabled={busy} onClick={() => setDialog('delete')} />
        ) : null}
        <button
          type="button"
          onClick={onClear}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] text-brand-800 hover:bg-brand-100"
        >
          <X className="size-3.5" aria-hidden />
          Clear
        </button>
      </div>

      <ConfirmDialog
        open={dialog === 'reclassify'}
        onOpenChange={(open) => setDialog(open ? 'reclassify' : null)}
        icon={<ShieldHalf />}
        tone="warning"
        size="md"
        title={`Reclassify ${pluralize(count('reclassify'), 'document')}`}
        description="People below the new level lose access immediately, including in search; lowering it makes the documents visible to more people."
        confirmLabel="Reclassify"
        confirmVariant="primary"
        onConfirm={() => void start('reclassify')}
      >
        <Field label="New classification" hint={skippedNote(selected.length, count('reclassify'), 'reclassify')}>
          <Select
            value={classification}
            onValueChange={setClassification}
            options={access.assignable.map((value) => ({
              value,
              label: CLASSIFICATION_META[value].label,
              description: CLASSIFICATION_META[value].description,
            }))}
          />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => setDialog(open ? 'delete' : null)}
        icon={<Trash2 />}
        tone="danger"
        size="md"
        title={`Delete ${pluralize(count('delete'), 'document')}?`}
        description={
          <>
            Their content is destroyed immediately and <span className="font-medium text-ink-soft">cannot be recovered</span>,
            including from backups. {skippedNote(selected.length, count('delete'), 'delete')}
          </>
        }
        confirmLabel={`Delete ${pluralize(count('delete'), 'document')}`}
        confirmDisabled={count('delete') === 0}
        typeToConfirm={count('delete') >= 5 ? 'delete' : undefined}
        onConfirm={() => void start('delete')}
      >
        <ul className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border border-line bg-well/40 px-3 py-2 text-[13px] text-ink-soft">
          {bulk
            .eligible('delete', selected)
            .slice(0, 8)
            .map((document) => (
              <li key={document.id} className="truncate">
                {document.title}
              </li>
            ))}
          {count('delete') > 8 ? <li className="text-muted">…and {count('delete') - 8} more</li> : null}
        </ul>
      </ConfirmDialog>
    </>
  );
}

function skippedNote(selected: number, eligible: number, verb: string): string {
  const skipped = selected - eligible;
  return skipped > 0 ? `${pluralize(skipped, 'selected document')} will be skipped: you can't ${verb} ${skipped === 1 ? 'it' : 'them'}.` : '';
}

function BarButton({
  icon,
  label,
  count,
  danger,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="xs"
      variant={danger ? 'danger-outline' : 'secondary'}
      disabled={disabled || count === 0}
      onClick={onClick}
    >
      {icon}
      {label}
      {count > 0 ? (
        <span className={danger ? 'rounded bg-danger-50 px-1 text-[10.5px] leading-4 tabular' : 'rounded bg-well px-1 text-[10.5px] leading-4 text-muted tabular'}>
          {count}
        </span>
      ) : null}
    </Button>
  );
}
