import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Asterisk, Copy, Info, Lock, RefreshCw, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { z } from 'zod';
import { NoAccessState } from '@/components/feedback/no-access';
import { OutcomeUnknown } from '@/components/feedback/outcome-unknown';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { UnsavedChangesDialog } from '@/components/feedback/unsaved-changes-dialog';
import { useUnsavedChanges } from '@/components/feedback/use-unsaved-changes';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardBody, CardHeader, DetailRow } from '@/components/ui/card';
import { Checkbox, CheckboxBox } from '@/components/ui/checkbox';
import { Field, FormError } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { useDialogTarget } from '@/components/ui/use-dialog-target';
import { rolesApi } from '@/lib/api/endpoints';
import { hasCode, isApiError, isOutcomeUnknown } from '@/lib/api/errors';
import type { PermissionCatalogue, Role, UpdateRoleRequest } from '@/lib/api/types';
import { ROLE_COLOR_PRESETS, isHexColor, normaliseHex } from '@/lib/color';
import { applyServerErrors, detailList, messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { permissionCatalogueQuery, queryKeys, roleMemberCountQuery, roleQuery, rolesQuery } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { analyseGrants, diffKeys, type KeyDiff } from '@/lib/rbac/grants';
import { maxRolePriority } from '@/lib/rbac/rules';
import { toast } from '@/lib/toast';
import { cn, formatDate, pluralize } from '@/lib/utils';
import { invalidateRoles, refreshMyAccess } from '@/lib/workspace/cache';
import { useAccess, type WorkspaceAccess } from '@/features/workspaces/use-access';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { ColorField } from './color-field';
import { isUuid } from './member-helpers';
import { PermissionGrid } from './permission-grid';
import { PriorityField } from './priority-field';
import { DeleteRoleDialog } from './role-dialogs';

/**
 * Role editor (P2-API-22–25): /team/roles/new (optionally ?from=<roleId> to
 * duplicate) and /team/roles/:roleId. Built-in roles, roles at or above your
 * rank, and roles you lack role:update for open read-only.
 *
 * A role's stored grants may contain wildcards (`document:*`). They are shown as
 * stored and previewed as the permissions they cover today; a metadata save never
 * sends permissions, and replacing wildcards with a fixed list needs an explicit
 * confirmation (spec §3 "Permission editor behavior", P2-T49).
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
  const can = useCan();
  return (
    <div className="grid gap-6">
      {can('role:read') ? (
        <Link
          to={`/w/${workspace.slug}/team/roles`}
          className="inline-flex w-fit items-center gap-1.5 rounded-md text-[13px] font-medium text-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" />
          Roles
        </Link>
      ) : null}
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
  // Always re-read before a long-lived edit (spec P2-API-22).
  const detail = useQuery({
    ...roleQuery(workspace.id, detailId ?? ''),
    enabled: isUuid(detailId) && canReadRoles,
    refetchOnMount: 'always',
  });

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
  if (failed && !(roleId && detail.data)) {
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
      recheck={() => detail.refetch()}
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
  /** The grants as stored on the server, wildcards included (empty for a new role). */
  stored: string[];
  /** Concrete keys those grants amount to: what the checkboxes start from. */
  permissions: string[];
}

function makeSchema(maxPriority: number) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(2, 'Use at least 2 characters.')
      .max(60, 'Use no more than 60 characters.')
      // The slug is derived from the name and must keep at least one letter or digit.
      .refine((value) => /[a-z0-9]/i.test(value), 'Role names need at least one letter (a–z) or digit.'),
    description: z.string().trim().max(500, 'Use no more than 500 characters.'),
    color: z.string().refine(isHexColor, 'Use a hex colour such as #22d3ee.'),
    priority: z
      .number({ error: 'Enter a number.' })
      .int('Use a whole number.')
      .min(0, 'Use 0 or more.')
      .max(maxPriority, maxPriority < 0 ? 'Your rank is too low to create roles.' : `Must be below your rank: at most ${maxPriority}.`),
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
      stored: [...role.permissionKeys],
      permissions: analyseGrants(role.permissionKeys, catalogueKeys).expanded,
    };
  }
  if (source) {
    // Duplicate: the concrete permissions the source covers today, minus what you don't hold.
    return {
      values: {
        name: `Copy of ${source.name}`.slice(0, 60),
        description: source.description ?? '',
        color: isHexColor(source.color) ? normaliseHex(source.color) : ROLE_COLOR_PRESETS[0],
        priority: Math.max(0, Math.min(source.priority, maxPriority)),
      },
      stored: [],
      permissions: analyseGrants(source.permissionKeys, catalogueKeys).expanded.filter(
        (key) => access.myPermissions.has(key) && catalogueKeys.includes(key),
      ),
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
    stored: [],
    permissions: [],
  };
}

const sameKeys = (a: ReadonlySet<string>, b: readonly string[]) => a.size === b.length && b.every((key) => a.has(key));

/** What a concurrent edit could change, to notice one. */
const signature = (role: Role) =>
  JSON.stringify([role.name, role.description, role.color, role.priority, [...role.permissionKeys].sort()]);

type ReadOnlyReason = 'builtin' | 'rank' | 'permission';
type Uncertain = { kind: 'create'; name: string; error: unknown } | { kind: 'update'; error: unknown };

function RoleEditor({
  role,
  source,
  catalogue,
  roles,
  recheck,
}: {
  /** The latest copy from the server (it may change while you edit). */
  role: Role | undefined;
  source: Role | undefined;
  catalogue: PermissionCatalogue;
  roles: Role[];
  recheck: () => Promise<unknown>;
}) {
  const workspace = useWorkspace();
  const workspaceId = workspace.id;
  const can = useCan();
  const access = useAccess();
  const navigate = useNavigate();
  const listPath = `/w/${workspace.slug}/team/roles`;
  const creating = !role;
  const catalogueKeys = useMemo(() => catalogue.permissions.map((permission) => permission.key), [catalogue]);
  const maxPriority = maxRolePriority(access.myPriority);
  useDocumentTitle(role ? role.name : 'New role');

  // The copy of the role this edit started from.
  const [baseRole, setBaseRole] = useState<Role | undefined>(role);
  const shown = baseRole ?? role;
  const readOnly: ReadOnlyReason | null = !shown
    ? null
    : shown.isSystem
      ? 'builtin'
      : shown.priority >= access.myPriority
        ? 'rank'
        : !can('role:update')
          ? 'permission'
          : null;
  const editable = readOnly === null;

  const [baseline, setBaseline] = useState<Baseline>(() => baselineFor(role, source, catalogueKeys, access, roles));
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(baseline.permissions));
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState<Uncertain | null>(null);
  const [checking, setChecking] = useState(false);

  const analysis = useMemo(() => analyseGrants(baseline.stored, catalogueKeys), [baseline.stored, catalogueKeys]);
  // Editing a role that grants something you don't hold: details yes, permissions no.
  const missing = baseline.permissions.filter((key) => !access.myPermissions.has(key));
  const permissionsLocked = !creating && editable && missing.length > 0;

  const schema = useMemo(() => makeSchema(maxPriority), [maxPriority]);
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: baseline.values });
  const { errors, dirtyFields, isDirty } = form.formState;
  const [watchName, watchColor] = useWatch({ control: form.control, name: ['name', 'color'] });

  const permissionsChanged = !sameKeys(selected, baseline.permissions);
  const grantDiff = diffKeys(baseline.permissions, selected);
  // Saving changed permissions sends a full explicit list: wildcards would become fixed keys.
  const convertsWildcards = !creating && permissionsChanged && analysis.wildcards.length > 0;
  const dirty = editable && (isDirty || permissionsChanged);
  const { blocker, allowNavigation } = useUnsavedChanges(dirty && !saving);
  const changedElsewhere = !!role && !!baseRole && signature(role) !== signature(baseRole);
  const outsideCatalogue = [...selected].filter((key) => !catalogueKeys.includes(key)).sort();

  const memberCount = useQuery({
    ...roleMemberCountQuery(workspaceId, shown?.id ?? ''),
    enabled: !!shown && !shown.isSystem && can('member:read'),
  });
  const deleteDialog = useDialogTarget<Role>();
  const deletable = !!shown && !shown.isSystem && shown.priority < access.myPriority && can('role:delete');

  const rebase = (next: Role) => {
    const fresh = baselineFor(next, undefined, catalogueKeys, access, roles);
    setBaseRole(next);
    setBaseline(fresh);
    form.reset(fresh.values);
    setSelected(new Set(fresh.permissions));
    setReplaceConfirmed(false);
    setPermissionError(null);
  };

  const discard = () => {
    form.reset(baseline.values);
    setSelected(new Set(baseline.permissions));
    setReplaceConfirmed(false);
    setPermissionError(null);
  };

  const handleError = (error: unknown, body?: UpdateRoleRequest) => {
    if (!isApiError(error)) {
      form.setError('root.server', { message: messageFor(error) });
      return;
    }
    switch (error.code) {
      case 'ROLE_ALREADY_EXISTS':
        form.setError(
          'name',
          { message: 'A role with this name, or one that gives the same slug, already exists.' },
          { shouldFocus: true },
        );
        break;
      case 'CANNOT_ESCALATE_PRIVILEGES': {
        // Your own access may have changed since the page loaded.
        void refreshMyAccess(workspaceId);
        const denied = detailList(error, 'deniedPermissions');
        const yours = error.details?.yourPriority;
        if (denied.length) {
          setPermissionError(`You can't grant: ${denied.join(', ')}.`);
        } else if (typeof error.details?.requestedPriority === 'number' && typeof yours === 'number') {
          form.setError('priority', { message: `Must be below your rank (${yours}).` }, { shouldFocus: true });
        } else if (typeof error.details?.rolePriority === 'number') {
          form.setError('root.server', { message: 'This role now ranks at or above you, so you can no longer change it.' });
        } else if (body?.priority !== undefined) {
          form.setError('priority', { message: 'You can only set a priority below your own rank.' }, { shouldFocus: true });
        } else {
          form.setError('root.server', { message: error.message });
        }
        break;
      }
      case 'ROLE_IMMUTABLE':
        form.setError('root.server', { message: "Built-in roles can't be changed." });
        void invalidateRoles(workspaceId);
        break;
      case 'PERMISSION_NOT_FOUND':
        setPermissionError(messageFor(error));
        void queryClient.invalidateQueries({ queryKey: queryKeys.permissionCatalogue });
        break;
      case 'BAD_REQUEST':
        form.setError('name', { message: error.message || 'Role names need at least one letter (a–z) or digit.' }, { shouldFocus: true });
        break;
      case 'ROLE_NOT_FOUND':
        toast.info('This role was deleted', { description: 'Someone removed it while you were editing.' });
        void invalidateRoles(workspaceId);
        allowNavigation();
        navigate(listPath);
        break;
      case 'VALIDATION_FAILED': {
        const fields = error.fieldErrors();
        const permissionMessage = Object.entries(fields).find(([key]) => key.startsWith('permissionKeys'))?.[1];
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
      setPermissionError('Choose at least one permission. A role must grant something.');
      return;
    }
    if (convertsWildcards && !replaceConfirmed) {
      setPermissionError('Confirm that the wildcard grants should be replaced by this explicit list, or discard the permission changes.');
      return;
    }
    const permissionKeys = [...selected].sort();
    setSaving(true);
    try {
      if (!role) {
        const created = await rolesApi.create(workspaceId, {
          name: values.name.trim(),
          ...(values.description.trim() ? { description: values.description.trim() } : {}),
          permissionKeys,
          priority: values.priority,
          color: normaliseHex(values.color),
        });
        toast.success(`Created the ${created.name} role`, {
          description: 'Nobody holds it yet: assign it from a member’s roles.',
        });
        void invalidateRoles(workspaceId);
        allowNavigation();
        navigate(can('role:read') ? listPath : `/w/${workspace.slug}`, { state: { highlight: created.id } });
        return;
      }

      // Only what changed. Permissions only when the grant set was deliberately replaced.
      const body: UpdateRoleRequest = {};
      if (dirtyFields.name && values.name.trim() !== baseline.values.name) body.name = values.name.trim();
      if (dirtyFields.description && values.description.trim() !== baseline.values.description) {
        body.description = values.description.trim();
      }
      if (dirtyFields.color && values.color !== baseline.values.color) body.color = normaliseHex(values.color);
      if (dirtyFields.priority && values.priority !== baseline.values.priority) body.priority = values.priority;
      if (permissionsChanged && !permissionsLocked) body.permissionKeys = permissionKeys;
      if (Object.keys(body).length === 0) {
        discard();
        return;
      }

      try {
        const updated = await rolesApi.update(workspaceId, role.id, body);
        queryClient.setQueryData(queryKeys.roleDetail(workspaceId, updated.id), updated);
        rebase(updated);
        toast.success('Role saved', {
          description:
            body.permissionKeys || body.priority !== undefined
              ? `Everyone who holds ${updated.name} was recomputed on the server.`
              : undefined,
        });
        // Holders' permissions were recomputed, possibly yours: gate what comes next on re-read access.
        void invalidateRoles(workspaceId);
      } catch (error) {
        if (isOutcomeUnknown(error)) {
          setUncertain({ kind: 'update', error });
          return;
        }
        handleError(error, body);
      }
    } catch (error) {
      if (isOutcomeUnknown(error)) {
        setUncertain({ kind: 'create', name: values.name.trim(), error });
        return;
      }
      handleError(error);
    } finally {
      setSaving(false);
    }
  });

  /** After a lost answer: look before saving again (spec §8, never replay a mutation blindly). */
  const reconcile = async () => {
    if (!uncertain) return;
    setChecking(true);
    try {
      if (uncertain.kind === 'create') {
        const latest = await queryClient.fetchQuery({ ...rolesQuery(workspaceId), staleTime: 0 });
        const found = latest.find((candidate) => candidate.name.trim().toLowerCase() === uncertain.name.toLowerCase());
        if (found) {
          toast.success(`The ${found.name} role was created`);
          allowNavigation();
          navigate(`${listPath}/${found.id}`);
          return;
        }
        setUncertain(null);
        form.setError('root.server', { message: "It wasn't created. You can create it now." });
      } else {
        await recheck();
        setUncertain(null);
        // If the save went through, the "changed since you opened it" notice now shows.
      }
    } catch (error) {
      form.setError('root.server', { message: `We still couldn't check: ${messageFor(error)}` });
    } finally {
      setChecking(false);
    }
  };

  const color = isHexColor(watchColor) ? watchColor : undefined;
  const title = shown ? shown.name : watchName?.trim() || (source ? `Copy of ${source.name}` : 'New role');
  const sourceHadWildcards = !!source && source.permissionKeys.some((key) => key.includes('*'));

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
                {shown ? (
                  <>
                    <code className="font-mono text-faint">{shown.slug}</code>
                    {shown.isSystem ? <Badge tone="outline">Built-in</Badge> : null}
                    {shown.isDefault ? <Badge tone="info">Default for invitations</Badge> : null}
                    {!shown.isSystem ? <span>· Created {formatDate(shown.createdAt)}</span> : null}
                    {memberCount.data !== undefined ? <span>· Held by {pluralize(memberCount.data, 'member')}</span> : null}
                  </>
                ) : source ? (
                  <>
                    A custom role based on {source.name}. Permissions you don't hold were left out
                    {sourceHadWildcards ? '; its wildcards became the explicit permissions they cover today' : ''}.
                  </>
                ) : (
                  <>A custom role: a named set of permissions you can give to members.</>
                )}
              </p>
            </div>
          </div>
          {shown ? (
            <div className="flex shrink-0 flex-wrap gap-2">
              {can('role:create') ? (
                <Button asChild variant="secondary">
                  <Link to={`${listPath}/new?from=${shown.id}`}>
                    <Copy />
                    {shown.isSystem ? 'Duplicate as custom role' : 'Duplicate'}
                  </Link>
                </Button>
              ) : null}
              {deletable ? (
                <Button
                  variant="danger-outline"
                  disabled={!!memberCount.data}
                  title={memberCount.data ? `Assigned to ${pluralize(memberCount.data, 'member')}. Reassign them first.` : undefined}
                  onClick={() => deleteDialog.show(shown)}
                >
                  <Trash2 />
                  Delete
                </Button>
              ) : null}
            </div>
          ) : null}
        </header>

        {changedElsewhere && role ? (
          <Callout
            tone="warning"
            title="This role changed since you opened it"
            action={
              <Button size="xs" variant="secondary" onClick={() => rebase(role)}>
                <RefreshCw />
                {dirty ? 'Load the latest and discard my edits' : 'Load the latest'}
              </Button>
            }
          >
            Someone saved it in the meantime. Saving now would overwrite their change to any field you also changed,
            and a permission change always replaces the whole set.
          </Callout>
        ) : null}
        {readOnly && shown ? <ReadOnlyNotice reason={readOnly} role={shown} myPriority={access.myPriority} /> : null}
        {deletable && memberCount.data ? (
          <p className="-mt-3 text-xs text-muted">
            Assigned to {pluralize(memberCount.data, 'member')}.{' '}
            <Link to={`/w/${workspace.slug}/team?role=${shown!.id}`} className="font-medium text-brand-700 hover:underline hover:underline-offset-4">
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
                    hint={creating ? 'Its slug is derived from the name now and never changes, even if you rename it.' : `Slug stays “${shown?.slug}”.`}
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
                          currentRoleId={shown?.id}
                        />
                      )}
                    />
                  </Field>
                </>
              ) : (
                <dl className="-mt-2 divide-y divide-line/70">
                  <DetailRow label="Name">{shown!.name}</DetailRow>
                  <DetailRow label="Description">
                    <span className="font-normal text-ink-soft">{shown!.description ?? '—'}</span>
                  </DetailRow>
                  <DetailRow label="Colour">
                    <span className="inline-flex items-center gap-2 font-mono text-xs">
                      <span className="size-3 rounded-full border border-black/10" style={{ backgroundColor: color }} />
                      {shown!.color ?? '—'}
                    </span>
                  </DetailRow>
                  <DetailRow label="Priority">
                    <span className="font-mono tabular">{shown!.priority}</span>
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
                  ? 'Tick what this role allows. You can only grant permissions you hold; the rest are locked.'
                  : 'What this role allows today.'
              }
            />
            <CardBody className="grid gap-4">
              {!creating && (analysis.wildcards.length > 0 || analysis.unknown.length > 0) ? (
                <StoredGrants stored={baseline.stored} inert={analysis.inertWildcards} unknown={analysis.unknown} covers={analysis.expanded.length} />
              ) : null}
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
              {editable && !permissionsLocked && outsideCatalogue.length > 0 ? (
                <OutsideCatalogue
                  keys={outsideCatalogue}
                  onRemove={(key) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      next.delete(key);
                      return next;
                    })
                  }
                />
              ) : null}
              <FormError message={permissionError ?? undefined} />
            </CardBody>
          </Card>
        </div>

        {editable ? (
          <div className="sticky bottom-4 z-20">
            <div
              className={cn(
                'grid gap-3 rounded-xl border bg-surface/95 px-4 py-3 shadow-pop backdrop-blur-md transition-colors',
                dirty ? 'border-brand-200' : 'border-line',
              )}
            >
              {!creating && permissionsChanged ? <GrantChanges diff={grantDiff} /> : null}
              {convertsWildcards ? (
                <Checkbox
                  labelClassName="font-normal"
                  checked={replaceConfirmed}
                  onCheckedChange={(next) => {
                    setReplaceConfirmed(next);
                    setPermissionError(null);
                  }}
                  label={
                    <span className="text-[13px] leading-snug text-ink-soft">
                      Replace the wildcard grants ({analysis.wildcards.join(', ')}) with these{' '}
                      {pluralize(selected.size, 'explicit permission')}. Permissions added to the platform later won't be
                      included automatically.
                    </span>
                  }
                />
              ) : null}
              {uncertain ? (
                <OutcomeUnknown
                  error={uncertain.error}
                  action={
                    <Button size="xs" variant="secondary" loading={checking} onClick={() => void reconcile()}>
                      {checking ? null : <RefreshCw />}
                      {uncertain.kind === 'create' ? 'Check the role list' : 'Check the saved role'}
                    </Button>
                  }
                >
                  {uncertain.kind === 'create'
                    ? 'The role may have been created. Check before creating it again, so you don’t end up with two.'
                    : 'The change may have been saved. Your edits are kept; check the saved role before saving again.'}
                </OutcomeUnknown>
              ) : null}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                      <Link to={can('role:read') ? listPath : `/w/${workspace.slug}`}>Cancel</Link>
                    </Button>
                  ) : (
                    <Button variant="ghost" onClick={discard} disabled={!dirty || saving}>
                      Discard
                    </Button>
                  )}
                  <Button
                    type="submit"
                    loading={saving}
                    disabled={
                      (!creating && !dirty) ||
                      (creating && maxPriority < 0) ||
                      (convertsWildcards && !replaceConfirmed) ||
                      !!uncertain ||
                      checking
                    }
                  >
                    {creating ? 'Create role' : 'Save changes'}
                  </Button>
                </div>
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

/** The grants exactly as stored, when they aren't just a list of catalogue keys. */
function StoredGrants({ stored, inert, unknown, covers }: { stored: string[]; inert: string[]; unknown: string[]; covers: number }) {
  return (
    <div className="grid gap-2 rounded-lg border border-line bg-well/40 px-3.5 py-3">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
        <Asterisk className="size-3.5 text-muted" aria-hidden />
        Stored grants
        <span className="font-normal text-muted">· cover {pluralize(covers, 'permission')} today</span>
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {stored.map((key) => (
          <li key={key}>
            <code
              className={cn(
                'rounded border px-1.5 font-mono text-[11.5px] leading-5',
                key.includes('*') ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-line bg-surface text-ink-soft',
                (inert.includes(key) || unknown.includes(key)) && 'border-warning-200 bg-warning-50 text-warning-700',
              )}
            >
              {key}
            </code>
          </li>
        ))}
      </ul>
      <p className="text-xs leading-relaxed text-muted">
        Wildcards keep covering matching permissions, including ones added later. The checklist below shows what they
        cover now; saving details alone leaves the stored grants as they are.
      </p>
      {inert.length ? (
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-warning-700">
          <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
          {inert.join(', ')} {inert.length === 1 ? 'matches' : 'match'} nothing: only whole-resource wildcards such as
          “pii:*” work, not prefixes like “pii:policy:*”.
        </p>
      ) : null}
      {unknown.length ? (
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-warning-700">
          <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden />
          {unknown.join(', ')} {unknown.length === 1 ? "isn't" : "aren't"} in the permission catalogue.
        </p>
      ) : null}
    </div>
  );
}

/** Selected keys the catalogue doesn't list: kept unless removed on purpose. */
function OutsideCatalogue({ keys, onRemove }: { keys: string[]; onRemove: (key: string) => void }) {
  return (
    <div className="grid gap-2 rounded-lg border border-warning-200 bg-warning-50/50 px-3.5 py-3 text-[13px]">
      <p className="font-medium text-warning-700">Kept from the stored grants, not in the catalogue</p>
      <ul className="grid gap-1.5">
        {keys.map((key) => (
          <li key={key} className="flex items-center gap-2.5">
            <CheckboxBox checked onCheckedChange={() => onRemove(key)} aria-label={`Remove ${key}`} />
            <code className="font-mono text-[12px] text-ink">{key}</code>
          </li>
        ))}
      </ul>
      <p className="text-xs leading-relaxed text-warning-700">
        The server refuses keys it doesn't know (PERMISSION_NOT_FOUND). Untick them if saving the permissions fails.
      </p>
    </div>
  );
}

/** The before/after of a permission change, shown before saving (spec §3). */
function GrantChanges({ diff }: { diff: KeyDiff }) {
  return (
    <details className="group text-[13px]">
      <summary className="cursor-pointer list-none text-ink-soft select-none">
        <span className="font-medium text-ink">Permission changes:</span>{' '}
        <span className="text-success-700 tabular">+{diff.added.length}</span>{' '}
        <span className="text-danger-700 tabular">−{diff.removed.length}</span>{' '}
        <span className="text-xs text-muted underline underline-offset-2 group-open:hidden">Show</span>
      </summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <KeyList label="Granted after saving" keys={diff.added} tone="added" />
        <KeyList label="No longer granted" keys={diff.removed} tone="removed" />
      </div>
    </details>
  );
}

function KeyList({ label, keys, tone }: { label: string; keys: string[]; tone: 'added' | 'removed' }) {
  return (
    <div>
      <p className="mb-1 text-xs text-muted">{label}</p>
      {keys.length ? (
        <ul className="flex flex-wrap gap-1">
          {keys.map((key) => (
            <li key={key}>
              <code
                className={cn(
                  'rounded border px-1 font-mono text-[11px] leading-[18px]',
                  tone === 'added' ? 'border-success-200 bg-success-50 text-success-700' : 'border-danger-200 bg-danger-50 text-danger-700 line-through',
                )}
              >
                {key}
              </code>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-faint">None</p>
      )}
    </div>
  );
}

function ReadOnlyNotice({ reason, role, myPriority }: { reason: ReadOnlyReason; role: Role; myPriority: number }) {
  switch (reason) {
    case 'builtin':
      return (
        <Callout tone="neutral" icon={<Lock className="size-4" />} title="Built-in role">
          {role.name} is the same in every workspace and can't be changed or deleted. Duplicate it to start a custom
          role with similar permissions.
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
