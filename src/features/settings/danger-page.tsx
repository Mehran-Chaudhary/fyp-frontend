import { useMutation, useQuery } from '@tanstack/react-query';
import { Crown, DoorOpen, Info, RefreshCw, Trash2, TriangleAlert, UserRoundCog } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { OutcomeUnknown } from '@/components/feedback/outcome-unknown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { workspaceApi } from '@/lib/api/endpoints';
import { isOutcomeUnknown } from '@/lib/api/errors';
import type { Organization } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { meQuery } from '@/lib/queries';
import { toast } from '@/lib/toast';
import { forgetWorkspace } from '@/lib/workspace/cache';
import { isWorkspaceStillListed } from '@/lib/workspace/reconcile';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { TransferOwnershipDialog } from './transfer-ownership-dialog';
import { WorkspaceDetailsGate } from './workspace-details-gate';

/**
 * Settings → Danger zone (spec §4 `/settings/danger`, P2-API-02/03). Both actions
 * need their permission AND the actual owner: holding a role named Owner isn't
 * enough, so ownership is read from `ownerId` (spec §3).
 */
export function DangerZonePage() {
  useDocumentTitle('Danger zone');
  return (
    <WorkspaceDetailsGate what="the workspace" skeleton={[16]}>
      {(organization) => <DangerZone organization={organization} />}
    </WorkspaceDetailsGate>
  );
}

function DangerZone({ organization }: { organization: Organization }) {
  const workspace = useWorkspace();
  const can = useCan();
  const { data: me } = useQuery(meQuery);
  const [transferOpen, setTransferOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isOwner = !!me && organization.ownerId === me.id;
  const canTransfer = isOwner && can('workspace:transfer');
  const canDelete = isOwner && can('workspace:delete');

  return (
    <div className="grid gap-6">
      {!isOwner ? (
        <Callout tone="neutral" icon={<Info className="size-4" />} title="Only the owner can do these">
          Transferring ownership and deleting {organization.name} need the workspace's actual owner, whatever roles
          you hold. You can still{' '}
          <Link to={`/w/${workspace.slug}/my-workspace-profile`} className="font-medium text-brand-700 underline underline-offset-4">
            leave the workspace
          </Link>
          .
        </Callout>
      ) : null}

      <Card className="border-danger-200">
        <CardHeader
          icon={<TriangleAlert />}
          title={
            <span className="flex items-center gap-2">
              Danger zone
              <Badge tone="brand">
                <Crown />
                Owner only
              </Badge>
            </span>
          }
          description="Each action names what it changes and asks for confirmation. Neither can be undone from the app."
        />
        <div className="border-t border-danger-200/70">
          <DangerRow
            icon={<UserRoundCog />}
            title="Transfer ownership"
            description="Hand the workspace to another active member. Their roles are replaced by Owner and yours by Administrator."
            action={
              <Button variant="secondary" size="sm" disabled={!canTransfer} onClick={() => setTransferOpen(true)}>
                Transfer…
              </Button>
            }
            unavailable={isOwner && !can('workspace:transfer') ? 'workspace:transfer' : undefined}
          />
          <DangerRow
            icon={<Trash2 />}
            title="Delete workspace"
            description="Members lose access at once. The workspace and its memberships are marked deleted; there is no restore option in the app."
            action={
              <Button variant="danger" size="sm" disabled={!canDelete} onClick={() => setDeleteOpen(true)}>
                Delete…
              </Button>
            }
            unavailable={isOwner && !can('workspace:delete') ? 'workspace:delete' : undefined}
          />
          {isOwner ? (
            <DangerRow
              icon={<DoorOpen />}
              title="Leave workspace"
              description="As the owner you can't leave. Transfer ownership first; then you can leave from your workspace profile."
            />
          ) : null}
        </div>
      </Card>

      {canTransfer ? <TransferOwnershipDialog organization={organization} open={transferOpen} onOpenChange={setTransferOpen} /> : null}
      {canDelete ? <DeleteWorkspaceDialog organization={organization} open={deleteOpen} onOpenChange={setDeleteOpen} /> : null}
    </div>
  );
}

function DangerRow({
  icon,
  title,
  description,
  action,
  unavailable,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  unavailable?: string;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-danger-200/50 px-5 py-4 first:border-t-0 sm:flex-row sm:items-center sm:px-6">
      <span className="hidden size-8 shrink-0 items-center justify-center rounded-lg border border-danger-200 bg-danger-50 text-danger-600 sm:inline-flex [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{description}</p>
        {unavailable ? (
          <p className="mt-1 text-xs text-warning-700">
            Your roles don't include <code className="font-mono text-[11.5px]">{unavailable}</code>.
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** P2-API-02, with an explicit check after a lost answer instead of a second DELETE. */
function DeleteWorkspaceDialog({
  organization,
  open,
  onOpenChange,
}: {
  organization: Organization;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  // The workspace tree remounts on a switch, so this id can't change under the dialog.
  const target = { id: organization.id, name: organization.name };
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);

  const leaveDeletedWorkspace = async (message: string, description: string) => {
    toast.success(message, { description });
    onOpenChange(false);
    // Out of the workspace first, so nothing under it refetches what is dropped next.
    await navigate('/workspaces', { replace: true });
    await forgetWorkspace(target.id);
  };

  const remove = useMutation({
    mutationFn: () => workspaceApi.remove(target.id),
    onSuccess: () =>
      leaveDeletedWorkspace(`Deleted ${target.name}`, 'Its members lost access. You are still signed in.'),
    onError: (err) => {
      if (isOutcomeUnknown(err)) setUncertain(err);
      else setError(messageFor(err));
    },
  });

  const reconcile = async () => {
    setChecking(true);
    setError(null);
    try {
      if (await isWorkspaceStillListed(target.id)) {
        setUncertain(null);
        setError(`${target.name} still exists, so it wasn't deleted. You can try again.`);
      } else {
        await leaveDeletedWorkspace(`${target.name} is no longer in your workspaces`, 'It was deleted, or your access to it ended.');
      }
    } catch (readError) {
      setError(`We still couldn't check: ${messageFor(readError)}`);
    } finally {
      setChecking(false);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (checking) return;
        onOpenChange(next);
        if (!next) window.setTimeout(() => setError(null), 200);
      }}
      icon={<Trash2 />}
      tone="danger"
      size="md"
      title={`Delete ${target.name}?`}
      description={
        <>
          Every member loses access at once. The workspace and its memberships are marked deleted rather than erased,
          and this app has no way to restore them. You stay signed in.
        </>
      }
      typeToConfirm={target.name}
      typeToConfirmLabel={
        <>
          Type the workspace name <span className="font-semibold text-ink">{target.name}</span> to confirm
        </>
      }
      confirmLabel="Delete workspace"
      confirmDisabled={!!uncertain || checking}
      pending={remove.isPending}
      error={error}
      onConfirm={() => {
        setError(null);
        remove.mutate();
      }}
    >
      {uncertain ? (
        <OutcomeUnknown
          error={uncertain}
          action={
            <Button size="xs" variant="secondary" loading={checking} onClick={() => void reconcile()}>
              {checking ? null : <RefreshCw />}
              Check whether it still exists
            </Button>
          }
        >
          The deletion may have happened. Check before trying again.
        </OutcomeUnknown>
      ) : null}
    </ConfirmDialog>
  );
}
