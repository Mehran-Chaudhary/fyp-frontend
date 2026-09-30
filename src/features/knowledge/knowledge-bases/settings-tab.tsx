import { Lock, RotateCw, Trash2, TriangleAlert, Users } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { UnsavedChangesDialog } from '@/components/feedback/unsaved-changes-dialog';
import { useUnsavedChanges } from '@/components/feedback/use-unsaved-changes';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tooltip } from '@/components/ui/tooltip';
import { hasCode } from '@/lib/api/errors';
import type { KnowledgeBase, KnowledgeBaseAccessMode } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { toast } from '@/lib/toast';
import { pluralize } from '@/lib/utils';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { ACCESS_LEVEL_META } from '../shared/meta';
import { useActionGate } from '../shared/use-action-gate';
import { useKnowledgeAccess } from '../shared/use-knowledge-access';
import { useKnowledgeBaseContext } from './kb-context';
import { changesChunking, toUpdateRequest } from './kb-form-model';
import { forgetKnowledgeBase, kbFormErrors, useDeleteKnowledgeBase, useUpdateKnowledgeBase } from './kb-mutations';
import { KnowledgeBaseForm } from './knowledge-base-form';
import { useReindexAll } from './use-reindex-all';

/** The Settings tab (§6.6): edit, or read-only below MANAGE + knowledgebase:update. */
export function KnowledgeBaseSettingsTab() {
  const { knowledgeBase } = useKnowledgeBaseContext();
  const access = useKnowledgeAccess();
  const navigate = useNavigate();
  const workspace = useWorkspace();
  const update = useUpdateKnowledgeBase(knowledgeBase);
  const reindexAll = useReindexAll(knowledgeBase);
  const gate = useActionGate();
  const editable = access.can('editKnowledgeBase', knowledgeBase);
  const [dirty, setDirty] = useState(false);
  const { blocker, allowNavigation } = useUnsavedChanges(dirty && editable);
  const [offerReindex, setOfferReindex] = useState(false);

  // The access-mode switch asks first (§6.6); the form awaits the answer.
  const [switching, setSwitching] = useState<KnowledgeBaseAccessMode | null>(null);
  const answer = useRef<((ok: boolean) => void) | null>(null);
  const confirmSwitch = (to: KnowledgeBaseAccessMode) =>
    new Promise<boolean>((resolve) => {
      answer.current = resolve;
      setSwitching(to);
    });
  const settle = (ok: boolean) => {
    answer.current?.(ok);
    answer.current = null;
    setSwitching(null);
  };

  const reindexGate = gate('reindex', knowledgeBase);

  return (
    <div className="grid gap-6">
      {offerReindex ? (
        <Callout
          tone="info"
          icon={<RotateCw className="size-4" />}
          title="New chunk settings apply to documents processed from now on"
          action={
            reindexGate.visible ? (
              <div className="flex gap-2">
                <Button size="xs" variant="secondary" loading={reindexAll.running} disabled={!!reindexGate.reason} onClick={reindexAll.run}>
                  Reindex all documents
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setOfferReindex(false)}>
                  Not now
                </Button>
              </div>
            ) : null
          }
        >
          Documents already in {knowledgeBase.name} keep their old chunks until they're reindexed.
          {reindexGate.visible ? null : ' Ask someone who can reindex documents to do it.'}
        </Callout>
      ) : null}

      {/* Keyed by version: a save (or someone else's) resets the form to the server's copy. */}
      <KnowledgeBaseForm
        key={knowledgeBase.updatedAt}
        knowledgeBase={knowledgeBase}
        readOnly={!editable}
        readOnlyReason={readOnlyReason(knowledgeBase, access.lacks('editKnowledgeBase'))}
        submitLabel="Save changes"
        pending={update.isPending}
        onDirtyChange={setDirty}
        onSubmit={async (values) => {
          const body = toUpdateRequest(values, knowledgeBase);
          if (Object.keys(body).length === 0) return;
          if (body.accessMode && !(await confirmSwitch(body.accessMode))) return;
          try {
            const updated = await update.mutateAsync(body);
            toast.success(`Saved ${updated.name}`);
            if (changesChunking(body) && updated.stats.documents > 0) setOfferReindex(true);
            if (body.accessMode === 'RESTRICTED') {
              // Saved: leaving isn't losing anything. Next, grant roles access (§6.6).
              allowNavigation();
              await navigate(`/w/${workspace.slug}/knowledge-bases/${updated.id}/access`);
            }
          } catch (error) {
            if (hasCode(error, 'KNOWLEDGE_BASE_NOT_FOUND')) {
              toast.info("This knowledge base doesn't exist any more, or you lost access to it");
              allowNavigation();
              await navigate(`/w/${workspace.slug}/knowledge-bases`);
              return;
            }
            return kbFormErrors(error);
          }
        }}
      />

      {reindexGate.visible && !offerReindex ? (
        <Card>
          <CardHeader
            icon={<RotateCw />}
            title="Reindex all documents"
            description="Re-run extraction, chunking and embedding for every processed document, for example after changing the chunk settings. Documents keep answering searches meanwhile."
            actions={
              <Tooltip content={reindexGate.reason} disabled={!reindexGate.reason}>
                <span tabIndex={reindexGate.reason ? 0 : -1} className="inline-flex rounded-lg">
                  <Button variant="secondary" size="sm" loading={reindexAll.running} disabled={!!reindexGate.reason} onClick={reindexAll.run}>
                    Reindex all
                  </Button>
                </span>
              </Tooltip>
            }
          />
        </Card>
      ) : null}

      <DangerZone knowledgeBase={knowledgeBase} />

      <ConfirmDialog
        open={switching !== null}
        onOpenChange={(open) => (open ? undefined : settle(false))}
        icon={switching === 'RESTRICTED' ? <Lock /> : <Users />}
        tone="warning"
        size="md"
        title={switching === 'RESTRICTED' ? `Restrict ${knowledgeBase.name}?` : `Open ${knowledgeBase.name} to the workspace?`}
        description={
          switching === 'RESTRICTED'
            ? `Only people and roles with a grant will see ${knowledgeBase.name} and its documents.${access.isOwner ? '' : " You'll get Manage access automatically."}`
            : `Everyone with document permissions will see ${knowledgeBase.name} and its documents up to their clearance. Existing grants are kept but have no effect while the base is open to the workspace.`
        }
        confirmLabel={switching === 'RESTRICTED' ? 'Restrict access' : 'Open to the workspace'}
        confirmVariant="primary"
        onConfirm={() => settle(true)}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}

function readOnlyReason(knowledgeBase: KnowledgeBase, lacksPermission: boolean): ReactNode {
  if (lacksPermission) return "Your role doesn't include changing knowledge bases, so these settings are read-only.";
  return (
    <>
      You have {ACCESS_LEVEL_META[knowledgeBase.access].label} access to this knowledge base. Changing its settings needs Manage
      access.
    </>
  );
}

function DangerZone({ knowledgeBase }: { knowledgeBase: KnowledgeBase }) {
  const workspace = useWorkspace();
  const access = useKnowledgeAccess();
  const gate = useActionGate();
  const navigate = useNavigate();
  const remove = useDeleteKnowledgeBase();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const del = gate('deleteKnowledgeBase', knowledgeBase);
  if (!del.visible) return null;

  // The count covers only what you can see: say "at least" below the top clearance (§6.6).
  const count = knowledgeBase.stats.documents;
  const atLeast = access.clearance !== 'RESTRICTED';
  const documents =
    count === 0 && !atLeast ? 'no documents' : `${atLeast ? 'at least ' : ''}${pluralize(count, 'document')}`;

  const onDeleted = async () => {
    setOpen(false);
    toast.success(`Deleted ${knowledgeBase.name}`, { description: 'Its documents were destroyed and can’t be recovered.' });
    // Leave first, so this page isn't around to refetch what's being dropped.
    await navigate(`/w/${workspace.slug}/knowledge-bases`, { replace: true });
    await forgetKnowledgeBase(workspace.id, knowledgeBase.id);
  };

  return (
    <Card className="border-danger-200">
      <CardHeader
        icon={<TriangleAlert />}
        title="Danger zone"
        description="Deleting a knowledge base destroys every document in it immediately. There is no trash and no undo."
      />
      <div className="flex flex-col gap-3 border-t border-danger-200/70 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
        <span className="hidden size-8 shrink-0 items-center justify-center rounded-lg border border-danger-200 bg-danger-50 text-danger-600 sm:inline-flex">
          <Trash2 className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-ink">Delete this knowledge base</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
            Each document's encryption key is destroyed in the same step, so the content is unrecoverable, backups included.
          </p>
        </div>
        <Tooltip content={del.reason} disabled={!del.reason}>
          <span tabIndex={del.reason ? 0 : -1} className="inline-flex rounded-lg">
            <Button
              variant="danger"
              size="sm"
              disabled={!!del.reason}
              onClick={() => {
                setError(null);
                setOpen(true);
              }}
            >
              Delete…
            </Button>
          </span>
        </Tooltip>
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        icon={<Trash2 />}
        tone="danger"
        size="md"
        title={`Delete ${knowledgeBase.name}?`}
        description={
          <>
            Deleting {knowledgeBase.name} destroys its {documents} immediately.{' '}
            <span className="font-medium text-ink-soft">This can't be undone.</span>
          </>
        }
        typeToConfirm={knowledgeBase.name}
        typeToConfirmLabel={
          <>
            Type the name <span className="font-mono font-semibold text-ink">{knowledgeBase.name}</span> to confirm
          </>
        }
        confirmLabel="Delete knowledge base"
        pending={remove.isPending}
        error={error}
        onConfirm={() =>
          remove.mutate(knowledgeBase, {
            onSuccess: () => void onDeleted(),
            onError: (err) => {
              // Already gone: that's what was asked for.
              if (hasCode(err, 'KNOWLEDGE_BASE_NOT_FOUND')) return void onDeleted();
              setError(messageFor(err));
            },
          })
        }
      />
    </Card>
  );
}
