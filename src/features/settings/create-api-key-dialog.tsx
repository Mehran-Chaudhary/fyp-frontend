import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';
import { KeyRound, Lock, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { ErrorState } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckboxBox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { RadioGroup } from '@/components/ui/radio-group';
import { TagInput } from '@/components/ui/tag-input';
import { Tooltip } from '@/components/ui/tooltip';
import { apiKeysApi } from '@/lib/api/endpoints';
import { isApiError } from '@/lib/api/errors';
import type { CreatedApiKey, PermissionDefinition } from '@/lib/api/types';
import { detailList, messageFor } from '@/lib/errors';
import { apiKeyScopesQuery, permissionCatalogueQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { invalidateApiKeys } from '@/lib/workspace/cache';
import { isValidCidr } from '@/lib/workspace/ip';
import { useAccess } from '@/features/workspaces/use-access';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { PERMISSION_CATEGORIES } from '@/features/team/permission-categories';

type Expiry = '30' | '90' | '365' | 'custom';

const schema = z
  .object({
    name: z.string().trim().min(1, 'Give the key a name.').max(120, 'Use no more than 120 characters.'),
    description: z.string().trim().max(500, 'Use no more than 500 characters.'),
    scopes: z.array(z.string()).min(1, 'Choose at least one scope.'),
    expiry: z.enum(['30', '90', '365', 'custom']),
    customDate: z.string(),
    allowedIps: z.array(z.string()).max(20, 'Use at most 20 networks.'),
  })
  .superRefine((values, ctx) => {
    if (values.expiry !== 'custom') return;
    const date = values.customDate ? new Date(`${values.customDate}T23:59:59`) : null;
    if (!date || Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: 'custom', path: ['customDate'], message: 'Choose a date.' });
    } else if (date.getTime() <= Date.now()) {
      ctx.addIssue({ code: 'custom', path: ['customDate'], message: 'The expiry must be in the future.' });
    }
  });
type Values = z.infer<typeof schema>;

/** Create an API key (spec §5.9, E58). The secret is handed to `onCreated` and never stored. */
export function CreateApiKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: CreatedApiKey) => void;
}) {
  const [session, setSession] = useState(0);
  const [busy, setBusy] = useState(false);
  const close = () => {
    onOpenChange(false);
    window.setTimeout(() => setSession((value) => value + 1), 200);
  };
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : !busy && close())}>
      <DialogContent size="xl" onInteractOutside={(event) => event.preventDefault()}>
        <CreateKeyForm
          key={session}
          onClose={close}
          onBusyChange={setBusy}
          onCreated={(created) => {
            close();
            onCreated(created);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function CreateKeyForm({
  onClose,
  onBusyChange,
  onCreated,
}: {
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onCreated: (created: CreatedApiKey) => void;
}) {
  const workspace = useWorkspace();
  const access = useAccess();
  const scopes = useQuery(apiKeyScopesQuery(workspace.id));
  const catalogue = useQuery(permissionCatalogueQuery);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', description: '', scopes: [], expiry: '365', customDate: '', allowedIps: [] },
  });
  const { errors } = form.formState;
  const expiry = useWatch({ control: form.control, name: 'expiry' });

  const onSubmit = form.handleSubmit(async (values) => {
    // 1 year is the server's default: omit expiresAt (spec §5.9).
    const expiresAt =
      values.expiry === 'custom'
        ? new Date(`${values.customDate}T23:59:59`).toISOString()
        : values.expiry === '365'
          ? undefined
          : addDays(new Date(), Number(values.expiry)).toISOString();

    setSubmitting(true);
    onBusyChange(true);
    try {
      const created = await apiKeysApi.create(workspace.id, {
        name: values.name.trim(),
        ...(values.description.trim() ? { description: values.description.trim() } : {}),
        scopes: values.scopes,
        ...(expiresAt ? { expiresAt } : {}),
        ...(values.allowedIps.length ? { allowedIps: values.allowedIps } : {}),
      });
      void invalidateApiKeys(workspace.id);
      onCreated(created);
    } catch (error) {
      if (!isApiError(error)) {
        form.setError('root.server', { message: messageFor(error) });
      } else if (error.code === 'CANNOT_ESCALATE_PRIVILEGES') {
        const denied = detailList(error, 'deniedScopes');
        form.setError('scopes', { message: denied.length ? `You can't grant: ${denied.join(', ')}.` : error.message });
      } else if (error.code === 'BAD_REQUEST') {
        const unsupported = detailList(error, 'unsupportedScopes');
        if (unsupported.length) {
          form.setError('scopes', { message: `These scopes can't be given to an API key: ${unsupported.join(', ')}.` });
        } else if (/ip range/i.test(error.message)) {
          form.setError('allowedIps', { message: error.message });
        } else {
          form.setError('root.server', { message: error.message });
        }
      } else if (error.code === 'VALIDATION_FAILED') {
        const fields = error.fieldErrors({ fields: ['name', 'description', 'scopes', 'expiresAt', 'allowedIps'] });
        for (const [field, message] of Object.entries(fields)) {
          if (field === 'expiresAt') form.setError(values.expiry === 'custom' ? 'customDate' : 'expiry', { message });
          else if (field === '_form') form.setError('root.server', { message });
          else form.setError(field as keyof Values, { message });
        }
      } else {
        form.setError('root.server', { message: messageFor(error) });
      }
    } finally {
      setSubmitting(false);
      onBusyChange(false);
    }
  });

  const describe = new Map<string, PermissionDefinition>((catalogue.data?.permissions ?? []).map((permission) => [permission.key, permission]));
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');

  return (
    <form onSubmit={onSubmit} noValidate className="contents">
      <DialogHeader
        icon={<KeyRound />}
        title="Create an API key"
        description="A key acts only in this workspace, only with its scopes, and never with more than you can do."
      />
      <DialogBody className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={errors.name?.message}>
            <Input autoFocus maxLength={120} placeholder="AI service (production)" {...form.register('name')} />
          </Field>
          <Field label="Description" optional error={errors.description?.message}>
            <Input maxLength={500} placeholder="What uses this key" {...form.register('description')} />
          </Field>
        </div>

        <Field label="Scopes" error={errors.scopes?.message}>
          <Controller
            control={form.control}
            name="scopes"
            render={({ field }) =>
              scopes.isPending ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {Array.from({ length: 6 }, (_, index) => (
                    <Skeleton key={index} className="h-12 rounded-lg" />
                  ))}
                </div>
              ) : scopes.isError ? (
                <ErrorState compact error={scopes.error} title="We couldn't load the scopes" onRetry={() => void scopes.refetch()} />
              ) : (
                <ScopePicker
                  scopes={scopes.data}
                  describe={describe}
                  held={access.myPermissions}
                  value={field.value}
                  onChange={field.onChange}
                />
              )
            }
          />
        </Field>

        <Field label="Expires" error={errors.expiry?.message}>
          <Controller
            control={form.control}
            name="expiry"
            render={({ field }) => (
              <RadioGroup<Expiry>
                aria-label="Expiry"
                value={field.value}
                onValueChange={field.onChange}
                orientation="horizontal"
                variant="cards"
                options={[
                  { value: '30', label: '30 days' },
                  { value: '90', label: '90 days' },
                  { value: '365', label: '1 year', description: 'Default' },
                  { value: 'custom', label: 'Custom date' },
                ]}
              />
            )}
          />
        </Field>
        {expiry === 'custom' ? (
          <Field label="Expiry date" error={errors.customDate?.message} hint="The key stops working at the end of this day.">
            <Input type="date" min={tomorrow} className="w-52" {...form.register('customDate')} />
          </Field>
        ) : null}
        <p className="-mt-2 text-xs text-muted">There's no “never”: every key expires, so a leaked one can't live forever.</p>

        <Field
          label="Restrict to networks"
          optional
          error={errors.allowedIps?.message}
          hint="Addresses or ranges such as 10.0.0.0/8. From anywhere else the key is refused. Leave empty to allow any network."
        >
          <Controller
            control={form.control}
            name="allowedIps"
            render={({ field }) => (
              <TagInput
                value={field.value}
                onChange={field.onChange}
                validate={(entry) => (entry.length > 64 ? 'Use no more than 64 characters.' : isValidCidr(entry) ? null : `"${entry}" isn't a valid address or range.`)}
                max={20}
                placeholder="10.0.0.0/8"
                mono
              />
            )}
          />
        </Field>

        <FormError message={errors.root?.server?.message} />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting} disabled={scopes.isPending}>
          Create key
        </Button>
      </DialogFooter>
    </form>
  );
}

function ScopePicker({
  scopes,
  describe,
  held,
  value,
  onChange,
}: {
  scopes: string[];
  describe: Map<string, PermissionDefinition>;
  held: ReadonlySet<string>;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const order = new Map(PERMISSION_CATEGORIES.map((category, index) => [category.key, index]));
  const label = new Map(PERMISSION_CATEGORIES.map((category) => [category.key, category.label]));
  const groups = new Map<string, string[]>();
  for (const scope of scopes) {
    const category = describe.get(scope)?.category ?? 'other';
    groups.set(category, [...(groups.get(category) ?? []), scope]);
  }
  const sorted = [...groups.entries()].sort(([a], [b]) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
  const available = scopes.filter((scope) => held.has(scope));
  const selected = new Set(value);

  const toggle = (scope: string, next: boolean) =>
    onChange(next ? [...value, scope] : value.filter((item) => item !== scope));

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="tabular">
          {value.length} of {scopes.length} selected
          {available.length < scopes.length ? ` · ${scopes.length - available.length} you don't hold` : null}
        </span>
        <span className="flex gap-3">
          <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => onChange(available)}>
            Select all available
          </button>
          <button type="button" className="font-medium text-muted hover:text-ink hover:underline" onClick={() => onChange([])}>
            Clear
          </button>
        </span>
      </div>
      <div className="scrollbar-thin max-h-72 overflow-y-auto rounded-lg border border-line">
        {sorted.map(([category, list], index) => (
          <div key={category} className={cn(index > 0 && 'border-t border-line')}>
            <p className="bg-well/55 px-3.5 py-1.5 text-[11px] font-medium tracking-[0.06em] text-muted uppercase">
              {label.get(category) ?? category}
            </p>
            <ul className="grid sm:grid-cols-2">
              {list.map((scope) => {
                const definition = describe.get(scope);
                const canGrant = held.has(scope);
                const id = `scope-${scope}`;
                return (
                  <li key={scope} className="flex items-start gap-2.5 border-t border-line/50 px-3.5 py-2.5">
                    <CheckboxBox id={id} checked={selected.has(scope)} disabled={!canGrant} onCheckedChange={(next) => toggle(scope, next)} />
                    <label htmlFor={id} className={cn('min-w-0 flex-1', canGrant ? 'cursor-pointer' : 'cursor-not-allowed')}>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <code className={cn('font-mono text-[12px]', canGrant ? 'text-ink' : 'text-muted')}>{scope}</code>
                        {definition?.isDangerous ? (
                          <Badge tone="warning">
                            <TriangleAlert />
                            Sensitive
                          </Badge>
                        ) : null}
                      </span>
                      {definition ? <span className="mt-0.5 block text-xs leading-snug text-muted">{definition.description}</span> : null}
                    </label>
                    {!canGrant ? (
                      <Tooltip content="You don't hold this permission, so a key you create can't have it.">
                        <span tabIndex={0} className="mt-0.5 rounded-sm text-faint" aria-label="You don't hold this permission">
                          <Lock className="size-3.5" />
                        </span>
                      </Tooltip>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
