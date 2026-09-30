import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Copy, Info, Lock, ShieldCheck, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { z } from 'zod';
import { NoAccessState } from '@/components/feedback/no-access';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { UnsavedChangesDialog } from '@/components/feedback/unsaved-changes-dialog';
import { useUnsavedChanges } from '@/components/feedback/use-unsaved-changes';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/card';
import { Field, FormError } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { useDialogTarget } from '@/components/ui/use-dialog-target';
import { rolesApi } from '@/lib/api/endpoints';
import { hasCode, isApiError } from '@/lib/api/errors';
import type { PermissionCatalogue, Role, UpdateRoleRequest } from '@/lib/api/types';
import { ROLE_COLOR_PRESETS, isHexColor, normaliseHex } from '@/lib/color';
import { applyServerErrors, detailList, messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { expandPermissions } from '@/lib/permissions/expand';
import { permissionCatalogueQuery, queryKeys, roleMemberCountQuery, roleQuery, rolesQuery } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { maxRolePriority } from '@/lib/rbac/rules';
import { toast } from '@/lib/toast';
import { cn, formatDate, pluralize } from '@/lib/utils';
import { invalidateRoles } from '@/lib/workspace/cache';
import { useAccess, type WorkspaceAccess } from '@/features/workspaces/use-access';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { ColorField } from './color-field';
import { isUuid } from './member-helpers';
import { PermissionGrid } from './permission-grid';
import { PriorityField } from './priority-field';
import { DeleteRoleDialog } from './role-dialogs';

/**
 * Role editor (spec §5.6): /team/roles/new (optionally ?from=<roleId> to
 * duplicate) and /team/roles/:roleId. Built-in roles, roles at or above your
 * rank, and roles you lack role:update for open read-only.
 */
export function RoleEditorPage() {
  const { roleId } = useParams();
  const workspace = useWorkspace();
  const can = useCan();
  const creating = roleId === undefined;
  useDocumentTitle(creating ? 'New role' : 'Role');

  const needed = creating ? 'role:create' : 'role:read';
  if (!can(needed)) {
    return (
      <EditorFrame>
        <Card>
          <NoAccessState permissions={[needed]} workspaceName={workspace.name} />
        </Card>
      </EditorFrame>
    );
  }
  return <RoleEditorLoader roleId={roleId} />;
}

function EditorFrame({ children }: { children: ReactNode }) {
  const workspace = useWorkspace();
  return (
    <div className="grid gap-6">
      <Link
        to={`/w/${workspace.slug}/team/roles`}
        className="inline-flex w-fit items-center gap-1.5 rounded-md text-[13px] font-medium text-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        Roles
      </Link>
      {children}
    </div>
  );
}

function RoleEditorLoader({ roleId }: { roleId: string | undefined }) {
  const workspace = useWorkspace();
  const can = useCan();
  const [params] = useSearchParams();
  const sourceId = roleId ? null : params.get('from');
  const detailId = roleId ?? (isUuid(sourceId) ? sourceId : null);

  const catalogue = useQuery(permissionCatalogueQuery);
  const canReadRoles = can('role:read');
  const roles = useQuery({ ...rolesQuery(workspace.id), enabled: canReadRoles });
  const detail = useQuery({ ...roleQuery(workspace.id, detailId ?? ''), enabled: isUuid(detailId) && canReadRoles });

  if (roleId && (!isUuid(roleId) || hasCode(detail.error, 'ROLE_NOT_FOUND'))) {
    return (
      <EditorFrame>
        <Card>
          <EmptyState
            icon={<Info />}
            title="This role doesn't exist"
            description="It may have been deleted, or the link is wrong."
            action={
              <Button asChild variant="secondary" size="sm">
                <Link to={`/w/${workspace.slug}/team/roles`}>Back to roles</Link>
              </Button>
            }
          />
        </Card>
      </EditorFrame>
    );
  }

  const failed = catalogue.error ?? (canReadRoles ? roles.error : null) ?? (roleId ? detail.error : null);
  if (failed) {
    return (
      <EditorFrame>
        <Card>
          <ErrorState
            error={failed}
            title="We couldn't load this role"
            onRetry={() => {
              void catalogue.refetch();
              void roles.refetch();
              void detail.refetch();
            }}
          />
        </Card>
      </EditorFrame>
    );
  }

  const waitingForDetail = isUuid(detailId) && canReadRoles && detail.isPending && !(sourceId && detail.isError);
  if (!catalogue.data || (canReadRoles && roles.isPending) || waitingForDetail) return <EditorSkeleton />;

  return (
    <RoleEditor
      key={roleId ?? `new:${sourceId ?? ''}`}
      role={roleId ? detail.data : undefined}
      source={roleId ? undefined : detail.data}
      catalogue={catalogue.data}
      roles={roles.data ?? []}
    />
  );
}

// ── The editor ──────────────────────────────────────────────────────────────

interface Values {
  name: string;
  description: string;
  color: string;
  priority: number;
}

interface Baseline {
  values: Values;
  /** Concrete keys, wildcards expanded (spec §5.6). */
  permissions: string[];
}

function makeSchema(maxPriority: number) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(2, 'Use at least 2 characters.')
      .max(60, 'Use no more than 60 characters.')
      .refine((value) => /[\p{L}\p{N}]/u.test(value), 'Role name must contain at least one letter or number.'),
    description: z.string().trim().max(500, 'Use no more than 500 characters.'),
    color: z.string().refine(isHexColor, 'Use a hex colour such as #22d3ee.'),
    priority: z
      .number({ error: 'Enter a number.' })
      .int('Use a whole number.')
      .min(0, 'Use 0 or more.')
      .max(maxPriority, maxPriority < 0 ? "Your rank is too low to create roles." : `Must be below your rank: at most ${maxPriority}.`),
  });
}

function baselineFor(
  role: Role | undefined,
  source: Role | undefined,
  catalogueKeys: readonly string[],
  access: WorkspaceAccess,
  roles: readonly Role[],
): Baseline {
  const maxPriority = maxRolePriority(access.myPriority);
  if (role) {
    return {
      values: {
        name: role.name,
        description: role.description ?? '',
        color: isHexColor(role.color) ? normaliseHex(role.color) : ROLE_COLOR_PRESETS[0],
        priority: role.priority,
      },
      permissions: expandPermissions(role.permissionKeys, catalogueKeys),
    };
  }
  if (source) {
    // Duplicate: same permissions minus what you don't hold, at the highest rank you may give.
    return {
      values: {
        name: `Copy of ${source.name}`.slice(0, 60),
        description: source.description ?? '',
        color: isHexColor(source.color) ? normaliseHex(source.color) : ROLE_COLOR_PRESETS[0],
        priority: Math.max(0, maxPriority),
      },
      permissions: expandPermissions(source.permissionKeys, catalogueKeys).filter((key) => access.myPermissions.has(key)),
    };
  }
  const used = new Set(roles.map((existing) => (existing.color ? normaliseHex(existing.color) : '')));
  return {
    values: {
      name: '',
      description: '',
      color: ROLE_COLOR_PRESETS.find((preset) => !used.has(preset)) ?? ROLE_COLOR_PRESETS[0],
      priority: Math.max(0, Math.min(40, maxPriority)),
    },
    permissions: [],
  };
}

const sameKeys = (a: ReadonlySet<string>, b: readonly string[]) => a.size === b.length && b.every((key) => a.has(key));

type ReadOnlyReason = 'builtin' | 'rank' | 'permission';

function RoleEditor({
  role,
  source,
  catalogue,
  roles,
}: {
  role: Role | undefined;
  source: Role | undefined;
  catalogue: PermissionCatalogue;
  roles: Role[];
}) {
  const workspace = useWorkspace();
  const can = useCan();
  const access = useAccess();
  const navigate = useNavigate();
  const listPath = `/w/${workspace.slug}/team/roles`;
  const creating = !role;
  const catalogueKeys = useMemo(() => catalogue.permissions.map((permission) => permission.key), [catalogue]);
  const maxPriority = maxRolePriority(access.myPriority);
  useDocumentTitle(role ? role.name : 'New role');

  const readOnly: ReadOnlyReason | null = !role
    ? null
    : role.isSystem
      ? 'builtin'
      : role.priority >= access.myPriority
        ? 'rank'
        : !can('role:update')
          ? 'permission'
          : null;
  const editable = readOnly === null;

  const [baseline, setBaseline] = useState<Baseline>(() => baselineFor(role, source, catalogueKeys, access, roles));
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(baseline.permissions));
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Editing a role that grants something you don't hold: details yes, permissions no (spec §5.6).
  const missing = baseline.permissions.filter((key) => !access.myPermissions.has(key));
  const permissionsLocked = !creating && editable && missing.length > 0;

  const schema = useMemo(() => makeSchema(maxPriority), [maxPriority]);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: baseline.values });
  const { errors, dirtyFields, isDirty } = form.formState;
  const [watchName, watchColor] = useWatch({ control: form.control, name: ['name', 'color'] });

  const permissionsChanged = !sameKeys(selected, baseline.permissions);
  const dirty = editable && (isDirty || permissionsChanged);
  const { blocker, allowNavigation } = useUnsavedChanges(dirty && !saving);

  const memberCount = useQuery({
    ...roleMemberCountQuery(workspace.id, role?.id ?? ''),
    enabled: !!role && !role.isSystem && can('member:read'),
  });
  const deleteDialog = useDialogTarget<Role>();
  const deletable = !!role && !role.isSystem && role.priority < access.myPriority && can('role:delete');

  const discard = () => {
    form.reset(baseline.values);
    setSelected(new Set(baseline.permissions));
    setPermissionError(null);
  };

  const handleError = (error: unknown) => {
    if (!isApiError(error)) {
      form.setError('root.server', { message: messageFor(error) });
      return;
    }
    switch (error.code) {
      case 'ROLE_ALREADY_EXISTS':
        form.setError('name', { message: 'A role with this name already exists.' }, { shouldFocus: true });
        break;
      case 'CANNOT_ESCALATE_PRIVILEGES': {
        const denied = detailList(error, 'deniedPermissions');
        const yours = error.details?.yourPriority;
        if (denied.length) {
          setPermissionError(`You can't grant: ${denied.join(', ')}.`);
        } else if (typeof error.details?.requestedPriority === 'number' && typeof yours === 'number') {
          form.setError('priority', { message: `Must be below ${yours}.` }, { shouldFocus: true });
        } else {
          form.setError('root.server', { message: error.message });
        }
        break;
      }
      case 'ROLE_IMMUTABLE':
        toast.error("Built-in roles can't be changed.");
        void invalidateRoles(workspace.id);
        break;
      case 'PERMISSION_NOT_FOUND':
        setPermissionError(messageFor(error));
        void queryClient.invalidateQueries({ queryKey: queryKeys.permissionCatalogue });
        break;
      case 'BAD_REQUEST':
        form.setError('name', { message: error.message || 'Role name must contain at least one letter or number.' }, { shouldFocus: true });
        break;
      case 'ROLE_NOT_FOUND':
        toast.info('This role was deleted', { description: 'Someone removed it while you were editing.' });
        void invalidateRoles(workspace.id);
        allowNavigation();
        navigate(listPath);
        break;
      case 'VALIDATION_FAILED': {
        const permissionMessage = error.fieldErrors({ fields: ['permissionKeys'] }).permissionKeys;
        if (permissionMessage) setPermissionError(permissionMessage);
        applyServerErrors(form, error, { fields: ['name', 'description', 'priority', 'color'] });
        break;
      }
      default:
        form.setError('root.server', { message: messageFor(error) });
    }
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setPermissionError(null);
    if (selected.size === 0) {
      setPermissionError('Choose at least one permission.');
      return;
    }
    const permissionKeys = [...selected].sort();
    setSaving(true);
    try {
      if (!role) {
        const created = await rolesApi.create(workspace.id, {
          name: values.name.trim(),
          ...(values.description.trim() ? { description: values.description.trim() } : {}),
          permissionKeys,
          priority: values.priority,
          color: values.color,
        });
        toast.success(`Created the ${created.name} role`, {
          description: 'Assign it to people from the Members list.',
        });
        void invalidateRoles(workspace.id);
        allowNavigation();
        navigate(listPath, { state: { highlight: created.id } });
        return;
      }

      // Only what changed: sending permissionKeys for a role that holds something
      // you lack is refused, while name/colour/description/priority succeed.
      const body: UpdateRoleRequest = {};
      if (dirtyFields.name && values.name.trim() !== baseline.values.name) body.name = values.name.trim();
      if (dirtyFields.description && values.description.trim() !== baseline.values.description) {
        body.description = values.description.trim();
      }
      if (dirtyFields.color && values.color !== baseline.values.color) body.color = values.color;
      if (dirtyFields.priority && values.priority !== baseline.values.priority) body.priority = values.priority;
      if (permissionsChanged && !permissionsLocked) body.permissionKeys = permissionKeys;
      if (Object.keys(body).length === 0) {
        discard();
        setSaving(false);
        return;
      }

      const updated = await rolesApi.update(workspace.id, role.id, body);
      queryClient.setQueryData(queryKeys.roleDetail(workspace.id, updated.id), updated);
      const next = baselineFor(updated, undefined, catalogueKeys, access, roles);
      setBaseline(next);
      form.reset(next.values);
      setSelected(new Set(next.permissions));
      toast.success('Role saved', {
        description:
          body.permissionKeys || body.priority !== undefined
            ? `Everyone with ${updated.name} has the new access now.`
            : undefined,
      });
      // Holders' permissions were recomputed, possibly yours.
      void invalidateRoles(workspace.id);
    } catch (error) {
      handleError(error);
    } finally {
      setSaving(false);
    }
  });

  const color = isHexColor(watchColor) ? watchColor : undefined;
  const title = role ? role.name : watchName?.trim() || (source ? `Copy of ${source.name}` : 'New role');

  return (
    <EditorFrame>
      <form onSubmit={onSubmit} noValidate className="grid gap-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span
              aria-hidden
              className={cn('mt-2.5 size-3 shrink-0 rounded-full', color ? null : 'bg-faint')}
              style={color ? { backgroundColor: color } : undefined}
            />
            <div className="min-w-0">
              <h1 className="truncate text-[22px] leading-tight font-semibold tracking-[-0.015em] text-ink">{title}</h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
                {role ? (
                  <>
                    <code className="font-mono text-faint">{role.slug}</code>
                    {role.isSystem ? <Badge tone="outline">Built-in</Badge> : null}
                    {role.isDefault ? <Badge tone="info">Default for invitations</Badge> : null}
                    {!role.isSystem ? <span>· Created {formatDate(role.createdAt)}</span> : null}
                    {memberCount.data !== undefined ? <span>· Held by {pluralize(memberCount.data, 'member')}</span> : null}
                  </>
                ) : source ? (
                  <>A custom role based on {source.name}. Permissions you don't hold were left out.</>
                ) : (
                  <>A custom role: a named set of permissions you can give to members.</>
                )}
              </p>
            </div>
          </div>
          {role ? (
            <div className="flex shrink-0 flex-wrap gap-2">
              {can('role:create') ? (
                <Button asChild variant="secondary">
                  <Link to={`${listPath}/new?from=${role.id}`}>
                    <Copy />
                    {role.isSystem ? 'Duplicate as custom role' : 'Duplicate'}
                  </Link>
                </Button>
              ) : null}
              {deletable ? (
                <Button
                  variant="danger-outline"
                  disabled={!!memberCount.data}
                  title={memberCount.data ? `Assigned to ${pluralize(memberCount.data, 'member')}. Reassign them first.` : undefined}
                  onClick={() => deleteDialog.show(role)}
                >
                  <Trash2 />
                  Delete
                </Button>
              ) : null}
            </div>
          ) : null}
        </header>

        {readOnly ? <ReadOnlyNotice reason={readOnly} role={role!} myPriority={access.myPriority} /> : null}
        {deletable && memberCount.data ? (
          <p className="-mt-3 text-xs text-muted">
            Assigned to {pluralize(memberCount.data, 'member')}.{' '}
            <Link to={`/w/${workspace.slug}/team?role=${role!.id}`} className="font-medium text-brand-700 hover:underline hover:underline-offset-4">
              Reassign them
            </Link>{' '}
            before deleting it.
          </p>
        ) : null}
        {creating && maxPriority < 0 ? (
          <Callout tone="warning" title="Your rank is too low to create roles">
            A new role must rank below you, and you're at priority {access.myPriority}.
          </Callout>
        ) : null}

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
          <Card className="xl:sticky xl:top-20">
            <CardHeader title="Details" />
            <CardBody className="grid gap-5">
              {editable ? (
                <>
                  <Field
                    label="Name"
                    error={errors.name?.message}
                    hint={creating ? 'Its slug is derived from the name now and never changes, even if you rename it.' : undefined}
                  >
                    <Input maxLength={60} autoFocus={creating} placeholder="Support Agent" {...form.register('name')} />
                  </Field>
                  <Field label="Description" optional error={errors.description?.message}>
                    <Textarea
                      rows={3}
                      maxLength={500}
                      className="min-h-20"
                      placeholder="What people with this role do"
                      {...form.register('description')}
                    />
                  </Field>
                  <Field label="Colour" error={errors.color?.message}>
                    <Controller
                      control={form.control}
                      name="color"
                      render={({ field }) => <ColorField value={field.value} onChange={field.onChange} />}
                    />
                  </Field>
                  <Field
                    label="Priority"
                    error={errors.priority?.message}
                    hint={`Members with this role can only be managed by people who rank higher. Up to ${Math.max(0, maxPriority)}.`}
                  >
                    <Controller
                      control={form.control}
                      name="priority"
                      render={({ field }) => (
                        <PriorityField
                          value={field.value}
                          onChange={field.onChange}
                          max={maxPriority}
                          myPriority={access.myPriority}
                          roles={roles}
                          currentRoleId={role?.id}
                        />
                      )}
                    />
                  </Field>
                </>
              ) : (
                <dl className="-mt-2 divide-y divide-line/70">
                  <DetailRow label="Name">{role!.name}</DetailRow>
                  <DetailRow label="Description">
                    <span className="font-normal text-ink-soft">{role!.description ?? '—'}</span>
                  </DetailRow>
                  <DetailRow label="Colour">
                    <span className="inline-flex items-center gap-2 font-mono text-xs">
                      <span className="size-3 rounded-full border border-black/10" style={{ backgroundColor: color }} />
                      {role!.color ?? '—'}
                    </span>
                  </DetailRow>
                  <DetailRow label="Priority">
                    <span className="font-mono tabular">{role!.priority}</span>
                  </DetailRow>
                </dl>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              icon={<ShieldCheck />}
              title="Permissions"
              description={
                editable && !permissionsLocked
                  ? "Tick what this role allows. You can only grant permissions you hold; the rest are locked."
                  : 'What this role allows. Wildcards such as document:* are shown expanded.'
              }
            />
            <CardBody className="grid gap-4">
              {permissionsLocked ? (
                <Callout tone="neutral" icon={<Lock className="size-4" />} title="Permissions are locked">
                  This role includes {missing.length === 1 ? 'a permission' : 'permissions'} you don't hold (
                  {missing.join(', ')}), so you can edit its details but not its permissions.
                </Callout>
              ) : null}
              <PermissionGrid
                permissions={catalogue.permissions}
                selected={selected}
                grantable={access.myPermissions}
                onChange={
                  editable && !permissionsLocked
                    ? (next) => {
                        setSelected(next);
                        setPermissionError(null);
                      }
                    : undefined
                }
              />
              <FormError message={permissionError ?? undefined} />
            </CardBody>
          </Card>
        </div>

        {editable ? (
          <div className="sticky bottom-4 z-20">
            <div
              className={cn(
                'flex flex-col gap-3 rounded-xl border bg-surface/95 px-4 py-3 shadow-pop backdrop-blur-md transition-colors sm:flex-row sm:items-center sm:justify-between',
                dirty ? 'border-brand-200' : 'border-line',
              )}
            >
              <div className="min-w-0">
                <FormError message={errors.root?.server?.message} className="mb-1" />
                <p className="text-[13px] text-muted" aria-live="polite">
                  {creating
                    ? `${pluralize(selected.size, 'permission')} selected.`
                    : dirty
                      ? 'You have unsaved changes.'
                      : 'No unsaved changes.'}
                  {!creating && dirty && permissionsChanged ? ' Saving updates everyone who holds this role at once.' : null}
                </p>
              </div>
              <div className="flex shrink-0 justify-end gap-2">
                {creating ? (
                  <Button asChild variant="ghost">
                    <Link to={listPath}>Cancel</Link>
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={discard} disabled={!dirty || saving}>
                    Discard
                  </Button>
                )}
                <Button type="submit" loading={saving} disabled={(!creating && !dirty) || (creating && maxPriority < 0)}>
                  {creating ? 'Create role' : 'Save changes'}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </form>

      <UnsavedChangesDialog blocker={blocker} />
      <DeleteRoleDialog
        role={deleteDialog.target}
        open={deleteDialog.open}
        onOpenChange={deleteDialog.onOpenChange}
        onDeleted={() => {
          allowNavigation();
          navigate(listPath);
        }}
      />
    </EditorFrame>
  );
}

function ReadOnlyNotice({ reason, role, myPriority }: { reason: ReadOnlyReason; role: Role; myPriority: number }) {
  switch (reason) {
    case 'builtin':
      return (
        <Callout tone="neutral" icon={<Lock className="size-4" />} title="Built-in role">
          {role.name} is the same in every workspace and can't be changed. Duplicate it to start a custom role with
          similar permissions.
        </Callout>
      );
    case 'rank':
      return (
        <Callout tone="neutral" icon={<Lock className="size-4" />} title="This role ranks at or above yours">
          Its priority is {role.priority} and yours is {myPriority}, so only someone who ranks higher can change it.
        </Callout>
      );
    case 'permission':
      return (
        <Callout tone="neutral" icon={<Lock className="size-4" />} title="Read-only">
          Your roles don't include <code className="font-mono text-[12px]">role:update</code>, so you can view this role but
          not change it.
        </Callout>
      );
  }
}

function EditorSkeleton() {
  return (
    <EditorFrame>
      <div className="grid gap-6" aria-busy="true">
        <div className="grid gap-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-3.5 w-72" />
        </div>
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-[32rem] rounded-xl" />
        </div>
      </div>
    </EditorFrame>
  );
}
