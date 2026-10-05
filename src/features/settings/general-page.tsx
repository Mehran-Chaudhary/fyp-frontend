import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, ImageOff, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { OutcomeUnknown } from '@/components/feedback/outcome-unknown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardBody, CardFooter, CardHeader, DetailRow } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { Field, FormError } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { WorkspaceTile } from '@/components/ui/misc';
import { isOutcomeUnknown } from '@/lib/api/errors';
import type { Organization, UpdateOrganizationRequest } from '@/lib/api/types';
import { applyServerErrors } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast } from '@/lib/toast';
import { formatDate, pluralize, safeImageUrl } from '@/lib/utils';
import { workspaceDescriptionField, workspaceNameField } from '@/lib/validation/schemas';
import { useCan } from '@/features/workspaces/workspace-context';
import { useUpdateWorkspace } from './use-update-workspace';
import { ReadOnlyHint, WorkspaceDetailsGate } from './workspace-details-gate';

/** Settings → General (spec §4 `/settings/general`, P2-API-01). */
export function GeneralSettingsPage() {
  useDocumentTitle('Settings');
  return (
    <WorkspaceDetailsGate what="the workspace settings" skeleton={[18]}>
      {(organization) => <WorkspaceCard organization={organization} />}
    </WorkspaceDetailsGate>
  );
}

const profileSchema = z.object({
  name: workspaceNameField,
  description: workspaceDescriptionField,
  logoUrl: z
    .string()
    .trim()
    .max(2048, 'Use no more than 2048 characters.')
    // The server stores any string; only http(s) is ever rendered (spec §4 "safe URL schemes").
    .refine((value) => value === '' || safeImageUrl(value) !== null, 'Enter a full http(s) address, such as https://example.com/logo.png.'),
});
type ProfileValues = z.infer<typeof profileSchema>;

const profileValues = (organization: Organization): ProfileValues => ({
  name: organization.name,
  description: organization.description ?? '',
  logoUrl: organization.logoUrl ?? '',
});

const sameValues = (a: ProfileValues | undefined, b: ProfileValues) =>
  !!a && a.name === b.name && a.description === b.description && a.logoUrl === b.logoUrl;

function WorkspaceCard({ organization }: { organization: Organization }) {
  const can = useCan();
  const editable = can('workspace:update');
  const save = useUpdateWorkspace();
  const form = useForm<ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: profileValues(organization) });
  const { errors, dirtyFields, isDirty, defaultValues } = form.formState;
  const [logoUrl, name] = useWatch({ control: form.control, name: ['logoUrl', 'name'] });
  const [uncertain, setUncertain] = useState<unknown>(null);
  const workspaceUrl = `${window.location.origin}/w/${organization.slug}`;

  // Keep in step with the server copy while nothing is being edited.
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(profileValues(organization));
  }, [organization, form]);

  // Someone else (another admin or tab) saved while this form was dirty (spec §8).
  const changedElsewhere = isDirty && !sameValues(defaultValues as ProfileValues | undefined, profileValues(organization));

  const onSubmit = form.handleSubmit((values) => {
    // Only the fields this form changed: slug, plan, owner and policies are never resent.
    const body: UpdateOrganizationRequest = {};
    if (dirtyFields.name) body.name = values.name;
    if (dirtyFields.description) body.description = values.description;
    if (dirtyFields.logoUrl) body.logoUrl = values.logoUrl; // '' removes the logo
    if (Object.keys(body).length === 0) return;
    setUncertain(null);
    save.mutate(body, {
      onSuccess: (updated) => {
        form.reset(profileValues(updated));
        toast.success('Workspace saved');
      },
      onError: (error) => {
        if (isOutcomeUnknown(error)) {
          setUncertain(error);
          return;
        }
        applyServerErrors(form, error, { fields: ['name', 'description', 'logoUrl'] });
      },
    });
  });

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <CardHeader icon={<Building2 />} title="Workspace" description="How this workspace appears to its members." />
        <CardBody className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="grid content-start gap-5">
            {changedElsewhere ? (
              <Callout
                tone="warning"
                title="This workspace was changed elsewhere"
                action={
                  <Button size="xs" variant="secondary" onClick={() => form.reset(profileValues(organization))}>
                    <RefreshCw />
                    Load the latest and discard my edits
                  </Button>
                }
              >
                Someone saved new details while you were editing. Saving now replaces only the fields you changed.
              </Callout>
            ) : null}
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
              hint="A link to an image (http or https). There's no upload; leave empty to use the initials."
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
            {uncertain ? (
              <OutcomeUnknown
                error={uncertain}
                action={
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => {
                      setUncertain(null);
                      void queryClient.invalidateQueries({ queryKey: queryKeys.details(organization.id) });
                    }}
                  >
                    <RefreshCw />
                    Check the saved details
                  </Button>
                }
              >
                The save may have gone through. Your edits are kept here; check what's stored before saving again.
              </OutcomeUnknown>
            ) : null}
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
          {editable ? <p className="text-xs text-muted">The URL and plan can't be changed here.</p> : <ReadOnlyHint />}
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
  const safe = safeImageUrl(url);
  if (!safe) return <WorkspaceTile name={name} seed={seed} size="lg" />;
  if (failed === safe) {
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
      src={safe}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(safe)}
      className="size-11 shrink-0 rounded-xl border border-line bg-surface object-contain p-0.5"
    />
  );
}
