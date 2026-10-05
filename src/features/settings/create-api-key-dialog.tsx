import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';
import { ArrowLeft, Info, KeyRound, Lock, TriangleAlert } from 'lucide-react';
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
import { isApiError, isOutcomeUnknown } from '@/lib/api/errors';
import type { CreateApiKeyRequest, CreatedApiKey, PermissionDefinition } from '@/lib/api/types';
import { detailList, messageFor } from '@/lib/errors';
import { apiKeyScopesQuery, permissionCatalogueQuery } from '@/lib/queries';
import { cn, formatDateTime, timestamp } from '@/lib/utils';
import { invalidateApiKeys } from '@/lib/workspace/cache';
import { isValidCidr } from '@/lib/workspace/ip';
import { useAccess } from '@/features/workspaces/use-access';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { PERMISSION_CATEGORIES } from '@/features/team/permission-categories';

type Expiry = '30' | '90' | 'default' | 'custom';

/** A creation whose answer never arrived: the key may exist, its secret is gone (spec P2-API-29). */
export interface UncertainCreation {
  name: string;
  sentAt: number;
  error: unknown;
}

const schema = z
  .object({
    name: z.string().trim().min(1, 'Give the key a name.').max(120, 'Use no more than 120 characters.'),
    description: z.string().trim().max(500, 'Use no more than 500 characters.'),
    scopes: z.array(z.string()).min(1, 'Choose at least one scope.').max(50, 'Use at most 50 scopes.'),
    expiry: z.enum(['30', '90', 'default', 'custom']),
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

/** The request for these values. Expiry is computed now, so it is in the future when sent. */
function toRequest(values: Values): CreateApiKeyRequest {
  const expiresAt =
    values.expiry === 'custom'
      ? new Date(`${values.customDate}T23:59:59`).toISOString()
      : values.expiry === 'default'
        ? undefined // the server applies its default lifetime
        : addDays(new Date(), Number(values.expiry)).toISOString();
  return {
    name: values.name.trim(),
    ...(values.description.trim() ? { description: values.description.trim() } : {}),
    scopes: [...new Set(values.scopes)],
    ...(expiresAt ? { expiresAt } : {}),
    ...(values.allowedIps.length ? { allowedIps: values.allowedIps } : {}),
  };
}

/**
 * Create an API key (P2-API-29): details, then a review, then one request. The
 * secret goes straight to `onCreated` and is never stored. A lost answer is never
 * retried: `onUncertain` lets the page find (and revoke) a key that may exist.
 */
export function CreateApiKeyDialog({
  open,
  onOpenChange,
  onCreated,
  onUncertain,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: CreatedApiKey) => void;
  onUncertain: (attempt: UncertainCreation) => void;
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
          onUncertain={(attempt) => {
            close();
            onUncertain(attempt);
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
  onUncertain,
}: {
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onCreated: (created: CreatedApiKey) => void;
  onUncertain: (attempt: UncertainCreation) => void;
}) {
  const workspace = useWorkspace();
  const workspaceId = workspace.id;
  const access = useAccess();
  const scopes = useQuery(apiKeyScopesQuery(workspaceId));
  const catalogue = useQuery(permissionCatalogueQuery);
  const [step, setStep] = useState<'details' | 'review'>('details');
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', description: '', scopes: [], expiry: 'default', customDate: '', allowedIps: [] },
  });
  const { errors } = form.formState;
  const expiry = useWatch({ control: form.control, name: 'expiry' });

  const toReview = form.handleSubmit(() => setStep('review'));

  const submit = async () => {
    const values = form.getValues();
    // Re-checked at send time: a custom date may have passed while reviewing.
    const valid = await form.trigger();
    if (!valid) {
      setStep('details');
      return;
    }
    const body = toRequest(values);
    const sentAt = timestamp();
    setSubmitting(true);
    onBusyChange(true);
    try {
      const created = await apiKeysApi.create(workspaceId, body);
      void invalidateApiKeys(workspaceId);
      onCreated(created);
    } catch (error) {
      if (isOutcomeUnknown(error)) {
        onUncertain({ name: body.name, sentAt, error });
        return;
      }
      setStep('details');
      if (!isApiError(error)) {
        form.setError('root.server', { message: messageFor(error) });
      } else if (error.code === 'CANNOT_ESCALATE_PRIVILEGES') {
        const denied = detailList(error, 'deniedScopes');
        form.setError('scopes', {
          message: denied.length ? `You don't hold these, so a key can't have them: ${denied.join(', ')}.` : error.message,
        });
      } else if (error.code === 'BAD_REQUEST') {
        const unsupported = detailList(error, 'unsupportedScopes');
        if (unsupported.length) {
          form.setError('scopes', { message: `These scopes can't be given to an API key: ${unsupported.join(', ')}.` });
        } else if (/ip|range|cidr/i.test(error.message)) {
          form.setError('allowedIps', { message: error.message });
        } else {
          form.setError('root.server', { message: error.message });
        }
      } else if (error.code === 'VALIDATION_FAILED') {
        const fields = error.fieldErrors();
        for (const [field, message] of Object.entries(fields)) {
          const base = field.split('.')[0];
          if (base === 'expiresAt') form.setError(values.expiry === 'custom' ? 'customDate' : 'expiry', { message });
          else if (base === 'name' || base === 'description' || base === 'scopes' || base === 'allowedIps') {
            form.setError(base, { message });
          } else form.setError('root.server', { message });
        }
      } else {
        form.setError('root.server', { message: messageFor(error) });
      }
    } finally {
      setSubmitting(false);
      onBusyChange(false);
    }
  };

  const describe = new Map<string, PermissionDefinition>((catalogue.data?.permissions ?? []).map((permission) => [permission.key, permission]));
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');

  if (step === 'review') {
    const values = form.getValues();
    const body = toRequest(values);
    return (
      <>
        <DialogHeader
          icon={<KeyRound />}
          title="Review the new key"
          description="Check what it can do and where it can be used. The secret is shown once, right after this."
        />
        <DialogBody className="grid gap-4">
          <dl className="grid gap-x-6 gap-y-3 rounded-lg border border-line bg-well/40 px-4 py-3.5 text-[13px] sm:grid-cols-[9rem_minmax(0,1fr)]">
            <dt className="text-muted">Name</dt>
            <dd className="font-medium text-ink">{body.name}</dd>
            {body.description ? (
              <>
                <dt className="text-muted">Description</dt>
                <dd className="text-ink-soft">{body.description}</dd>
              </>
            ) : null}
            <dt className="text-muted">Scopes</dt>
            <dd className="flex flex-wrap gap-1">
              {body.scopes.map((scope) => (
                <code key={scope} className="rounded border border-line bg-surface px-1 font-mono text-[11.5px] leading-[18px] text-ink-soft">
                  {scope}
                </code>
              ))}
            </dd>
            <dt className="text-muted">Expires</dt>
            <dd className="text-ink-soft">
              {body.expiresAt ? formatDateTime(body.expiresAt) : 'The server’s default lifetime (one year in the current backend)'}
            </dd>
            <dt className="text-muted">Networks</dt>
            <dd className="text-ink-soft">
              {body.allowedIps?.length ? (
                <span className="font-mono text-[12px]">{body.allowedIps.join(', ')}</span>
              ) : (
                'Any network (workspace IP rules still apply)'
              )}
            </dd>
          </dl>
          {body.allowedIps?.length ? (
            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
              <Info className="mt-px size-3.5 shrink-0" aria-hidden />
              Pins apply to the address the calling machine's traffic leaves from, which may not be your browser's.
            </p>
          ) : null}
          <FormError message={errors.root?.server?.message} />
        </DialogBody>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={() => setStep('details')} disabled={submitting}>
            <ArrowLeft />
            Back
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} loading={submitting}>
              Create key
            </Button>
          </div>
        </DialogFooter>
      </>
    );
  }

  return (
    <form onSubmit={toReview} noValidate className="contents">
      <DialogHeader
        icon={<KeyRound />}
        title="Create an API key"
        description="A key works only in this workspace and only with its scopes. You can only give it scopes you hold."
      />
      <DialogBody className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={errors.name?.message}>
            <Input autoFocus maxLength={120} placeholder="Research ingestion worker" {...form.register('name')} />
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
                <ScopePicker scopes={scopes.data} describe={describe} held={access.myPermissions} value={field.value} onChange={field.onChange} />
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
                  { value: 'default', label: 'Server default', description: 'One year today' },
                  { value: 'custom', label: 'Custom date' },
                ]}
              />
            )}
          />
        </Field>
        {expiry === 'custom' ? (
          <Field label="Expiry date" error={errors.customDate?.message} hint="The key stops working at the end of this day (your time).">
            <Input type="date" min={tomorrow} className="w-52" {...form.register('customDate')} />
          </Field>
        ) : null}
        <p className="-mt-2 text-xs text-muted">There's no “never”: every new key expires, so a leaked one can't live forever.</p>

        <Field
          label="Pin to networks"
          optional
          error={errors.allowedIps?.message}
          hint="Addresses or ranges such as 10.0.0.0/8, for the machine that will use the key (its outgoing address, not necessarily this browser's). Leave empty for no key-specific pin."
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
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={scopes.isPending || scopes.isError}>
          Review
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * The supported scope vocabulary (P2-API-27), narrower than roles: no wildcards,
 * no reveal or read-all scopes. Only scopes you hold can be ticked.
 */
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

  const toggle = (scope: string, next: boolean) => onChange(next ? [...value, scope] : value.filter((item) => item !== scope));

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="tabular" aria-live="polite">
          {value.length} of {scopes.length} selected
          {available.length < scopes.length ? ` · ${scopes.length - available.length} you don't hold` : null}
        </span>
        <span className="flex gap-3">
          <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => onChange(available)}>
            Select all you hold
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
