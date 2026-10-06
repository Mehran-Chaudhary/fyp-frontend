import { Lock, RefreshCw, RotateCw, Trash2, TriangleAlert, Users } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { OutcomeUnknown } from '@/components/feedback/outcome-unknown';
import { UnsavedChangesDialog } from '@/components/feedback/unsaved-changes-dialog';
import { useUnsavedChanges } from '@/components/feedback/use-unsaved-changes';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tooltip } from '@/components/ui/tooltip';
import { knowledgeBasesApi } from '@/lib/api/endpoints';
import { hasCode, isOutcomeUnknown } from '@/lib/api/errors';
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
import { ReindexAllDialog } from './reindex-all-dialog';

/** The Settings tab (spec §5 "Knowledge bases"): edit, or read-only below MANAGE + knowledgebase:update. */
export function KnowledgeBaseSettingsTab() {
  const { knowledgeBase } = useKnowledgeBaseContext();
  const access = useKnowledgeAccess();
  const navigate = useNavigate();
  const workspace = useWorkspace();
  const update = useUpdateKnowledgeBase(knowledgeBase);
  const gate = useActionGate();
  const editable = access.can('editKnowledgeBase', knowledgeBase);
  const [dirty, setDirty] = useState(false);
  const { blocker, allowNavigation } = useUnsavedChanges(dirty && editable);
  const [offerReindex, setOfferReindex] = useState(false);
  const [reindexOpen, setReindexOpen] = useState(false);
  const [uncertain, setUncertain] = useState<unknown>(null);

  // The copy the form was opened with. A newer server copy replaces it only while
  // nothing is being edited; otherwise it's announced (spec §9.4).
  const [snapshot, setSnapshot] = useState<KnowledgeBase>(knowledgeBase);
  const [formKey, setFormKey] = useState(0);
  const newer = knowledgeBase.updatedAt !== snapshot.updatedAt;
  if (newer && !dirty) setSnapshot(knowledgeBase);
  const loadLatest = () => {
    setSnapshot(knowledgeBase);
    setFormKey((value) => value + 1);
    setDirty(false);
  };

  // The access-mode switch asks first; the form awaits the answer.
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
    <div className="grid grid-cols-1 gap-6">
      {offerReindex ? (
        <Callout
          tone="info"
          icon={<RotateCw className="size-4" />}
          title="New chunk settings apply to documents processed from now on"
          action={
            reindexGate.visible ? (
              <div className="flex gap-2">
                <Button size="xs" variant="secondary" disabled={!!reindexGate.reason} onClick={() => setReindexOpen(true)}>
                  Reindex all documents…
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

      {newer && dirty ? (
        <Callout
          tone="warning"
          title="This knowledge base changed since you opened it"
          action={
            <Button size="xs" variant="secondary" onClick={loadLatest}>
              <RefreshCw />
              Load the latest and discard my edits
            </Button>
          }
        >
          Someone saved new settings while you were editing. Saving now sends only the fields you changed; the rest keeps the newer
          values.
        </Callout>
      ) : null}

      {uncertain ? (
        <OutcomeUnknown error={uncertain}>
          No answer arrived, so the changes may have been saved. The settings were re-read; check them before saving again.
        </OutcomeUnknown>
      ) : null}

      <KnowledgeBaseForm
        key={`${snapshot.updatedAt}:${formKey}`}
        knowledgeBase={snapshot}
        readOnly={!editable}
        readOnlyReason={readOnlyReason(knowledgeBase, access.lacks('editKnowledgeBase'))}
        submitLabel="Save changes"
        pending={update.isPending}
        onDirtyChange={setDirty}
        onSubmit={async (values) => {
          // Only what this form changed, relative to the copy it was opened with.
          const body = toUpdateRequest(values, snapshot);
          if (Object.keys(body).length === 0) return;
          if (body.accessMode && !(await confirmSwitch(body.accessMode))) return;
          setUncertain(null);
          try {
            const updated = await update.mutateAsync(body);
            setSnapshot(updated);
            toast.success(`Saved ${updated.name}`);
            if (changesChunking(body) && updated.stats.documents > 0) setOfferReindex(true);
            if (body.accessMode === 'RESTRICTED') {
              // Saved: leaving isn't losing anything. Next, grant roles or people access.
              allowNavigation();
              await navigate(`/w/${workspace.slug}/knowledge-bases/${updated.id}/access`);
            }
          } catch (error) {
            if (hasCode(error, 'KNOWLEDGE_BASE_NOT_FOUND')) {
              toast.info("This knowledge base doesn't exist or you don't have access to it any more");
              allowNavigation();
              await navigate(`/w/${workspace.slug}/knowledge-bases`);
              return;
            }
            if (isOutcomeUnknown(error)) {
              setUncertain(error);
              return;
            }
            return kbFormErrors(error);
          }
        }}
      />

      {reindexGate.visible ? (
        <Card>
          <CardHeader
            icon={<RotateCw />}
            title="Reindex all documents"
            description="Re-run extraction, chunking and embedding for every processed document, for example after changing the chunk settings. Documents keep answering searches meanwhile."
            actions={
              <Tooltip content={reindexGate.reason} disabled={!reindexGate.reason}>
                <span tabIndex={reindexGate.reason ? 0 : -1} className="inline-flex rounded-lg">
                  <Button variant="secondary" size="sm" disabled={!!reindexGate.reason} onClick={() => setReindexOpen(true)}>
                    Reindex all…
                  </Button>
                </span>
              </Tooltip>
            }
          />
        </Card>
      ) : null}

      <DangerZone knowledgeBase={knowledgeBase} onLeaving={allowNavigation} />

      <ReindexAllDialog knowledgeBase={knowledgeBase} open={reindexOpen} onOpenChange={setReindexOpen} />

      <ConfirmDialog
        open={switching !== null}
        onOpenChange={(open) => (open ? undefined : settle(false))}
        icon={switching === 'RESTRICTED' ? <Lock /> : <Users />}
        tone="warning"
        size="md"
        title={switching === 'RESTRICTED' ? `Restrict ${knowledgeBase.name}?` : `Open ${knowledgeBase.name} to the workspace?`}
        description={
          switching === 'RESTRICTED'
            ? `Only people, roles and API keys with a grant (and the workspace owner) will see ${knowledgeBase.name} and its documents; to everyone else it won't exist. ${access.isOwner ? 'As the owner you keep seeing it.' : "You'll get Manage access automatically, so you won't be locked out."}`
            : `Everyone with document permissions will see ${knowledgeBase.name} and its documents up to their clearance, at Manage level; their role permissions still decide what they can do. Existing grants are kept but have no effect while it's open to the workspace.`
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
      You have {ACCESS_LEVEL_META[knowledgeBase.access].label} access to {knowledgeBase.name}. Changing its settings needs Manage
      access.
    </>
  );
}

function DangerZone({ knowledgeBase, onLeaving }: { knowledgeBase: KnowledgeBase; onLeaving: () => void }) {
  const workspace = useWorkspace();
  const access = useKnowledgeAccess();
  const gate = useActionGate();
  const navigate = useNavigate();
  const remove = useDeleteKnowledgeBase();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);
  const del = gate('deleteKnowledgeBase', knowledgeBase);
  if (!del.visible) return null;

  // The count covers only what you can see: say "at least" below the top clearance (spec §3.4).
  const count = knowledgeBase.stats.documents;
  const atLeast = access.clearance !== 'RESTRICTED';
  const documents = count === 0 && !atLeast ? 'no documents' : `${atLeast ? 'at least ' : ''}${pluralize(count, 'document')}`;

  const onDeleted = async () => {
    setOpen(false);
    onLeaving();
    toast.success(`Deleted ${knowledgeBase.name}`, { description: 'Its documents were destroyed and can’t be recovered.' });
    // Leave first, so this page isn't around to refetch what's being dropped.
    await navigate(`/w/${workspace.slug}/knowledge-bases`, { replace: true });
    await forgetKnowledgeBase(workspace.id, knowledgeBase.id);
  };

  /** A lost answer: read the base back. 404 means it's gone (spec §8 P3-API-05). */
  const check = async () => {
    setChecking(true);
    try {
      await knowledgeBasesApi.get(workspace.id, knowledgeBase.id);
      setUncertain(null);
      setError("It's still there: the delete didn't go through. You can try again.");
    } catch (caught) {
      if (hasCode(caught, 'KNOWLEDGE_BASE_NOT_FOUND')) await onDeleted();
      else setError(`Couldn't check: ${messageFor(caught)}`);
    } finally {
      setChecking(false);
    }
  };

  return (
    <Card className="border-danger-200">
      <CardHeader
        icon={<TriangleAlert />}
        title="Danger zone"
        description="Deleting a knowledge base destroys every document in it immediately. There is no trash, no undo and no restore."
      />
      <div className="flex flex-col gap-3 border-t border-danger-200/70 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
        <span className="hidden size-8 shrink-0 items-center justify-center rounded-lg border border-danger-200 bg-danger-50 text-danger-600 sm:inline-flex">
          <Trash2 className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-ink">Delete this knowledge base</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
            Each document's encryption key is destroyed in the same step, so the content is unrecoverable, backups included. Stored
            files and search vectors are purged in the background. The name can be reused straight away.
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
                setUncertain(null);
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
            Deleting {knowledgeBase.name} destroys its {documents} immediately. They disappear from lists, downloads and search at once.{' '}
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
        confirmDisabled={!!uncertain}
        pending={remove.isPending}
        error={error}
        onConfirm={() => {
          setError(null);
          remove.mutate(knowledgeBase, {
            onSuccess: () => void onDeleted(),
            onError: (err) => {
              // Already gone: that's what was asked for.
              if (hasCode(err, 'KNOWLEDGE_BASE_NOT_FOUND')) return void onDeleted();
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
    </Card>
  );
}
