import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Archive, Building2, Crown, DoorOpen, FileStack, ImageOff, Trash2, TriangleAlert, UserRoundCog } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { NoAccessState } from '@/components/feedback/no-access';
import { ErrorState } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader, DetailRow } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CopyButton } from '@/components/ui/copy-button';
import { Field, FormError } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Skeleton, WorkspaceTile } from '@/components/ui/misc';
import { RadioGroup } from '@/components/ui/radio-group';
import { Segmented } from '@/components/ui/segmented';
import { membersApi, workspaceApi } from '@/lib/api/endpoints';
import { hasCode, isApiError } from '@/lib/api/errors';
import type { Organization, UpdateOrganizationRequest } from '@/lib/api/types';
import { applyServerErrors, messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { meQuery, workspaceDetailsQuery } from '@/lib/queries';
import { toast } from '@/lib/toast';
import { cn, formatDate, pluralize } from '@/lib/utils';
import { workspaceDescriptionField, workspaceNameField } from '@/lib/validation/schemas';
import { forgetWorkspace } from '@/lib/workspace/cache';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { TransferOwnershipDialog } from './transfer-ownership-dialog';
import { useUpdateWorkspace } from './use-update-workspace';

/** Settings → General (spec §5.7). */
export function GeneralSettingsPage() {
  const workspace = useWorkspace();
  const can = useCan();
  useDocumentTitle('Settings');
  const details = useQuery({ ...workspaceDetailsQuery(workspace.id), enabled: can('workspace:read') });

  if (!can('workspace:read')) {
    return (
      <Card>
        <NoAccessState permissions={['workspace:read']} workspaceName={workspace.name} />
      </Card>
    );
  }
  if (details.isPending) return <PageSkeleton />;
  if (details.isError) {
    return (
      <Card>
        <ErrorState error={details.error} title="We couldn't load the settings" onRetry={() => void details.refetch()} retrying={details.isFetching} />
      </Card>
    );
  }

  const organization = details.data;
  const settings = organization.settings;
  return (
    <div className="grid gap-6">
      <WorkspaceCard organization={organization} />
      <RetentionCard key={`retention:${settings.auditRetentionDays ?? 'forever'}`} organization={organization} />
      <ProcessingCard
        key={`chunks:${settings.defaultChunkSize ?? 'default'}:${settings.defaultChunkOverlap ?? 'default'}`}
        organization={organization}
      />
      <LeaveCard organization={organization} />
      <DangerZone organization={organization} />
    </div>
  );
}

function ReadOnlyHint() {
  return (
    <p className="text-xs text-muted">
      You can view these settings. Changing them needs <code className="font-mono text-[11.5px]">workspace:update</code>.
    </p>
  );
}

// ── Workspace profile ───────────────────────────────────────────────────────

const HTTP_URL = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

const profileSchema = z.object({
  name: workspaceNameField,
  description: workspaceDescriptionField,
  logoUrl: z
    .string()
    .trim()
    .max(2048, 'Use no more than 2048 characters.')
    .refine((value) => value === '' || HTTP_URL.test(value), 'Enter a full address, such as https://example.com/logo.png.'),
});
type ProfileValues = z.infer<typeof profileSchema>;

const profileValues = (organization: Organization): ProfileValues => ({
  name: organization.name,
  description: organization.description ?? '',
  logoUrl: organization.logoUrl ?? '',
});

function WorkspaceCard({ organization }: { organization: Organization }) {
  const can = useCan();
  const editable = can('workspace:update');
  const save = useUpdateWorkspace();
  const form = useForm<ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: profileValues(organization) });
  const { errors, dirtyFields, isDirty } = form.formState;
  const logoUrl = useWatch({ control: form.control, name: 'logoUrl' });
  const name = useWatch({ control: form.control, name: 'name' });
  const workspaceUrl = `${window.location.origin}/w/${organization.slug}`;

  // Keep in step with the server copy (another admin or tab may have saved).
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(profileValues(organization));
  }, [organization, form]);

  const onSubmit = form.handleSubmit((values) => {
    const body: UpdateOrganizationRequest = {};
    if (dirtyFields.name) body.name = values.name;
    if (dirtyFields.description) body.description = values.description;
    if (dirtyFields.logoUrl) body.logoUrl = values.logoUrl; // '' removes the logo
    if (Object.keys(body).length === 0) return;
    save.mutate(body, {
      onSuccess: (updated) => {
        form.reset(profileValues(updated));
        toast.success('Workspace saved');
      },
      onError: (error) => applyServerErrors(form, error, { fields: ['name', 'description', 'logoUrl'] }),
    });
  });

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <CardHeader icon={<Building2 />} title="Workspace" description="How this workspace appears to its members." />
        <CardBody className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="grid content-start gap-5">
            <Field label="Name" error={errors.name?.message}>
              <Input maxLength={120} readOnly={!editable} {...form.register('name')} />
            </Field>
            <Field label="Description" optional error={errors.description?.message}>
              <Textarea rows={3} maxLength={2000} readOnly={!editable} placeholder="What this workspace is for" {...form.register('description')} />
            </Field>
            <Field
              label="Logo URL"
              optional
              error={errors.logoUrl?.message}
              hint="A link to an image. There's no upload; leave empty to use the initials."
            >
              <div className="flex items-center gap-3">
                <LogoPreview url={errors.logoUrl ? '' : logoUrl} name={name || organization.name} seed={organization.slug} />
                <Input
                  className="flex-1"
                  type="url"
                  inputMode="url"
                  maxLength={2048}
                  readOnly={!editable}
                  placeholder="https://example.com/logo.png"
                  {...form.register('logoUrl')}
                />
              </div>
            </Field>
            <FormError message={errors.root?.server?.message} />
          </div>
          <dl className="grid content-start gap-0 self-start rounded-lg border border-line bg-well/40 px-4 py-1 divide-y divide-line/70">
            <DetailRow label="URL" className="flex-col items-start gap-1">
              <span className="flex items-center gap-1">
                <span className="font-mono text-xs break-all text-ink-soft">/w/{organization.slug}</span>
                <CopyButton value={workspaceUrl} iconOnly variant="ghost" label="Copy workspace URL" className="size-7" />
              </span>
            </DetailRow>
            <DetailRow label="Workspace ID" className="flex-col items-start gap-1">
              <span className="flex items-center gap-1">
                <span className="font-mono text-[11px] break-all text-ink-soft">{organization.id}</span>
                <CopyButton value={organization.id} iconOnly variant="ghost" label="Copy workspace ID" className="size-7" />
              </span>
            </DetailRow>
            <DetailRow label="Plan">
              <Badge tone="neutral">{organization.plan.charAt(0) + organization.plan.slice(1).toLowerCase()}</Badge>
            </DetailRow>
            <DetailRow label="Members">{pluralize(organization.memberCount, 'active member')}</DetailRow>
            <DetailRow label="Created">{formatDate(organization.createdAt)}</DetailRow>
          </dl>
        </CardBody>
        <CardFooter className="justify-between">
          {editable ? <p className="text-xs text-muted">The workspace URL can't be changed.</p> : <ReadOnlyHint />}
          {editable ? (
            <div className="flex gap-2">
              <Button variant="ghost" disabled={!isDirty || save.isPending} onClick={() => form.reset(profileValues(organization))}>
                Discard
              </Button>
              <Button type="submit" disabled={!isDirty} loading={save.isPending}>
                Save changes
              </Button>
            </div>
          ) : null}
        </CardFooter>
      </form>
    </Card>
  );
}

function LogoPreview({ url, name, seed }: { url: string; name: string; seed: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const valid = HTTP_URL.test(url.trim());
  if (!valid) return <WorkspaceTile name={name} seed={seed} size="lg" />;
  if (failed === url) {
    return (
      <span
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-dashed border-warning-200 bg-warning-50 text-warning-600"
        title="This image couldn't be loaded"
      >
        <ImageOff className="size-4" aria-label="Image couldn't be loaded" />
      </span>
    );
  }
  return (
    <img
      src={url.trim()}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(url)}
      className="size-11 shrink-0 rounded-xl border border-line bg-surface object-contain p-0.5"
    />
  );
}

// ── Data retention ──────────────────────────────────────────────────────────

function RetentionCard({ organization }: { organization: Organization }) {
  const can = useCan();
  const editable = can('workspace:update');
  const current = organization.settings.auditRetentionDays ?? null;
  const [mode, setMode] = useState<'forever' | 'days'>(current === null ? 'forever' : 'days');
  const [days, setDays] = useState(String(current ?? 365));
  const [error, setError] = useState<string | null>(null);
  const save = useUpdateWorkspace();

  const parsed = Number(days);
  const valid = mode === 'forever' || (Number.isInteger(parsed) && parsed >= 30 && parsed <= 3650);
  const next = mode === 'forever' ? null : parsed;
  const dirty = next !== current;

  const submit = () => {
    setError(null);
    if (!valid) {
      setError('Enter a whole number of days between 30 and 3650.');
      return;
    }
    save.mutate(
      { settings: { auditRetentionDays: next } },
      {
        onSuccess: () =>
          toast.success('Retention saved', {
            description: next === null ? 'Audit records are kept forever.' : `Records older than ${pluralize(next, 'day')} will be archived.`,
          }),
        onError: (err) => {
          if (isApiError(err) && err.code === 'VALIDATION_FAILED') {
            setError(err.fieldErrors({ fields: ['settings.auditRetentionDays'] })['settings.auditRetentionDays'] ?? err.message);
          } else {
            setError(messageFor(err));
          }
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader
        icon={<Archive />}
        title="Data retention"
        description="Older audit records are archived to storage, then removed from the live log. The integrity chain is preserved."
      />
      <CardBody className="grid gap-4">
        <RadioGroup
          aria-label="Audit log retention"
          value={mode}
          onValueChange={(value) => {
            setMode(value);
            setError(null);
          }}
          disabled={!editable}
          variant="cards"
          orientation="horizontal"
          options={[
            { value: 'forever', label: 'Keep forever', description: 'The platform default. Nothing is removed.' },
            {
              value: 'days',
              label: 'Delete older records',
              description: 'Archive and remove records past a number of days.',
              children: (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={30}
                    max={3650}
                    value={days}
                    readOnly={!editable}
                    onChange={(event) => {
                      setDays(event.target.value);
                      setError(null);
                    }}
                    aria-label="Retention in days"
                    aria-invalid={!valid || undefined}
                    className="w-28"
                    inputClassName="font-mono tabular"
                  />
                  <span className="text-[13px] text-muted">days (30–3650)</span>
                </div>
              ),
            },
          ]}
        />
        <FormError message={error ?? undefined} />
      </CardBody>
      <CardFooter className="justify-between">
        {editable ? <span /> : <ReadOnlyHint />}
        {editable ? (
          <Button disabled={!dirty} loading={save.isPending} onClick={submit}>
            Save retention
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}

// ── Document processing ─────────────────────────────────────────────────────

function ProcessingCard({ organization }: { organization: Organization }) {
  const can = useCan();
  const editable = can('workspace:update');
  const settings = organization.settings;
  const [size, setSize] = useState<string>(settings.defaultChunkSize != null ? String(settings.defaultChunkSize) : '');
  const [overlap, setOverlap] = useState<string>(settings.defaultChunkOverlap != null ? String(settings.defaultChunkOverlap) : '');
  const [sizeMode, setSizeMode] = useState<'default' | 'custom'>(settings.defaultChunkSize != null ? 'custom' : 'default');
  const [overlapMode, setOverlapMode] = useState<'default' | 'custom'>(settings.defaultChunkOverlap != null ? 'custom' : 'default');
  const [errors, setErrors] = useState<{ size?: string; overlap?: string; form?: string }>({});
  const save = useUpdateWorkspace();

  const nextSize = sizeMode === 'default' ? null : Number(size);
  const nextOverlap = overlapMode === 'default' ? null : Number(overlap);
  const sizeChanged = nextSize !== (settings.defaultChunkSize ?? null);
  const overlapChanged = nextOverlap !== (settings.defaultChunkOverlap ?? null);

  const submit = () => {
    const problems: typeof errors = {};
    if (nextSize !== null && !(Number.isInteger(nextSize) && nextSize >= 64 && nextSize <= 4096)) {
      problems.size = 'Use a whole number between 64 and 4096.';
    }
    if (nextOverlap !== null && !(Number.isInteger(nextOverlap) && nextOverlap >= 0 && nextOverlap <= 1024)) {
      problems.overlap = 'Use a whole number between 0 and 1024.';
    }
    if (!problems.size && !problems.overlap && nextSize !== null && nextOverlap !== null && nextOverlap >= nextSize) {
      problems.overlap = `Must be smaller than the chunk size (${nextSize}).`;
    }
    setErrors(problems);
    if (Object.keys(problems).length) return;

    // Only what changed: settings are a partial update.
    const patch: NonNullable<UpdateOrganizationRequest['settings']> = {};
    if (sizeChanged) patch.defaultChunkSize = nextSize;
    if (overlapChanged) patch.defaultChunkOverlap = nextOverlap;
    save.mutate(
      { settings: patch },
      {
        onSuccess: () =>
          toast.success('Document processing saved', { description: 'Applies to documents processed or reindexed from now on.' }),
        onError: (err) => {
          if (isApiError(err) && err.code === 'VALIDATION_FAILED') {
            const fields = err.fieldErrors({ fields: ['settings.defaultChunkSize', 'settings.defaultChunkOverlap'] });
            setErrors({
              size: fields['settings.defaultChunkSize'],
              overlap: fields['settings.defaultChunkOverlap'],
              form: fields._form ?? (fields['settings.defaultChunkSize'] || fields['settings.defaultChunkOverlap'] ? undefined : err.message),
            });
          } else {
            setErrors({ form: messageFor(err) });
          }
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader
        icon={<FileStack />}
        title="Document processing"
        description="Defaults for knowledge bases that don't set their own. Applies to documents processed or reindexed after the change."
      />
      <CardBody className="grid gap-5 sm:grid-cols-2">
        <ChunkField
          label="Default chunk size"
          unit="tokens"
          range="64–4096"
          mode={sizeMode}
          onModeChange={(mode) => {
            setSizeMode(mode);
            if (mode === 'custom' && !size) setSize('512');
            setErrors({});
          }}
          value={size}
          onValueChange={(value) => {
            setSize(value);
            setErrors({});
          }}
          error={errors.size}
          disabled={!editable}
        />
        <ChunkField
          label="Default chunk overlap"
          unit="tokens"
          range="0–1024, below the size"
          mode={overlapMode}
          onModeChange={(mode) => {
            setOverlapMode(mode);
            if (mode === 'custom' && !overlap) setOverlap('64');
            setErrors({});
          }}
          value={overlap}
          onValueChange={(value) => {
            setOverlap(value);
            setErrors({});
          }}
          error={errors.overlap}
          disabled={!editable}
        />
        <FormError message={errors.form} className="sm:col-span-2" />
      </CardBody>
      <CardFooter className="justify-between">
        {editable ? <span /> : <ReadOnlyHint />}
        {editable ? (
          <Button disabled={!sizeChanged && !overlapChanged} loading={save.isPending} onClick={submit}>
            Save processing defaults
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}

function ChunkField({
  label,
  unit,
  range,
  mode,
  onModeChange,
  value,
  onValueChange,
  error,
  disabled,
}: {
  label: string;
  unit: string;
  range: string;
  mode: 'default' | 'custom';
  onModeChange: (mode: 'default' | 'custom') => void;
  value: string;
  onValueChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <Field label={label} error={error} hint={mode === 'custom' ? `${range} ${unit}.` : 'Uses the platform setting.'}>
      <div className="flex flex-wrap items-center gap-2">
        {disabled ? (
          <span className="text-[13px] text-ink-soft">{mode === 'default' ? 'Platform default' : `${value} ${unit}`}</span>
        ) : (
          <>
            <Segmented
              aria-label={`${label}: platform default or custom`}
              size="xs"
              value={mode}
              onValueChange={onModeChange}
              options={[
                { value: 'default', label: 'Platform default' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
            {mode === 'custom' ? (
              <span className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  value={value}
                  onChange={(event) => onValueChange(event.target.value)}
                  className="w-24"
                  inputClassName="h-9 font-mono tabular"
                />
                <span className="text-[13px] text-muted">{unit}</span>
              </span>
            ) : null}
          </>
        )}
      </div>
    </Field>
  );
}

// ── Leave ───────────────────────────────────────────────────────────────────

function LeaveCard({ organization }: { organization: Organization }) {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const { data: me } = useQuery(meQuery);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOwner = organization.ownerId === me?.id;

  const leave = useMutation({
    mutationFn: () => membersApi.leave(workspace.id),
    onSuccess: async () => {
      toast.success(`You left ${workspace.name}`, { description: 'API keys you created there were revoked.' });
      setOpen(false);
      await navigate('/workspaces', { replace: true });
      await forgetWorkspace(workspace.id);
    },
    onError: (err) => setError(hasCode(err, 'CANNOT_REMOVE_LAST_OWNER') ? 'You own this workspace. Transfer ownership before you can leave.' : messageFor(err)),
  });

  return (
    <Card>
      <CardHeader
        icon={<DoorOpen />}
        title="Leave workspace"
        description={
          isOwner
            ? 'You own this workspace. Transfer ownership before you can leave.'
            : "You'll lose access immediately. API keys you created here are revoked."
        }
        actions={
          isOwner ? null : (
            <Button
              variant="danger-outline"
              size="sm"
              onClick={() => {
                setError(null);
                setOpen(true);
              }}
            >
              Leave…
            </Button>
          )
        }
      />
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        icon={<DoorOpen />}
        tone="danger"
        title={`Leave ${workspace.name}?`}
        description="You lose access immediately and API keys you created here are revoked. To come back, someone has to invite you again."
        confirmLabel="Leave workspace"
        pending={leave.isPending}
        error={error}
        onConfirm={() => leave.mutate()}
      />
    </Card>
  );
}

// ── Danger zone (owner only) ────────────────────────────────────────────────

function DangerZone({ organization }: { organization: Organization }) {
  const { data: me } = useQuery(meQuery);
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const [transferOpen, setTransferOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: () => workspaceApi.remove(workspace.id),
    onSuccess: async () => {
      toast.success(`Deleted ${organization.name}`, {
        description: 'It is gone for everyone. Its documents and vectors are destroyed after 7 days.',
      });
      setDeleteOpen(false);
      await navigate('/workspaces', { replace: true });
      await forgetWorkspace(workspace.id);
    },
    onError: (err) => setDeleteError(messageFor(err)),
  });

  if (!me || organization.ownerId !== me.id) return null;

  return (
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
        description="Actions only the owner can take. Each asks for confirmation."
      />
      <div className="border-t border-danger-200/70">
        <DangerRow
          icon={<UserRoundCog />}
          title="Transfer ownership"
          description="Hand the workspace to another active member. They become the owner and you become an Administrator."
          action={
            <Button variant="secondary" size="sm" onClick={() => setTransferOpen(true)}>
              Transfer…
            </Button>
          }
        />
        <DangerRow
          icon={<Trash2 />}
          title="Delete workspace"
          description="Removes the workspace for everyone, immediately. Documents and vectors are permanently destroyed after 7 days; the audit log is kept."
          action={
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setDeleteError(null);
                setDeleteOpen(true);
              }}
            >
              Delete…
            </Button>
          }
        />
      </div>

      <TransferOwnershipDialog organization={organization} open={transferOpen} onOpenChange={setTransferOpen} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        icon={<Trash2 />}
        tone="danger"
        size="md"
        title={`Delete ${organization.name}?`}
        description={
          <>
            It disappears for every member at once. Its documents and vectors are permanently destroyed after 7 days. The
            audit log is kept. <span className="font-medium text-ink-soft">This can't be undone from the app.</span>
          </>
        }
        typeToConfirm={organization.slug}
        typeToConfirmLabel={
          <>
            Type the workspace URL name <span className="font-mono font-semibold text-ink">{organization.slug}</span> to
            confirm
          </>
        }
        confirmLabel="Delete workspace"
        pending={remove.isPending}
        error={deleteError}
        onConfirm={() => remove.mutate()}
      />
    </Card>
  );
}

function DangerRow({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-danger-200/50 px-5 py-4 first:border-t-0 sm:flex-row sm:items-center sm:px-6">
      <span className="hidden size-8 shrink-0 items-center justify-center rounded-lg border border-danger-200 bg-danger-50 text-danger-600 sm:inline-flex [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{description}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true">
      {[18, 11, 11].map((height, index) => (
        <div key={index} className={cn('rounded-xl border border-line bg-surface p-6 shadow-card')}>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-3 w-72 max-w-full" />
          <Skeleton className="mt-5 w-full" style={{ height: `${height * 4}px` }} />
        </div>
      ))}
    </div>
  );
}
