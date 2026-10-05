import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BadgeCheck, ImageIcon, Lock, MailWarning, ShieldCheck } from 'lucide-react';
import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { ErrorState, PageHeader } from '@/components/feedback/states';
import { UnsavedChangesDialog } from '@/components/feedback/unsaved-changes-dialog';
import { useUnsavedChanges } from '@/components/feedback/use-unsaved-changes';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Avatar, Skeleton } from '@/components/ui/misc';
import { authApi } from '@/lib/api/endpoints';
import type { CurrentUser, UpdateProfileRequest } from '@/lib/api/types';
import { applyServerErrors } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { meQuery, queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast } from '@/lib/toast';
import { safeImageUrl } from '@/lib/utils';
import { nameField } from '@/lib/validation/schemas';

const schema = z.object({
  firstName: nameField('First name'),
  lastName: nameField('Last name'),
  displayName: z.string().trim().max(255, 'Use no more than 255 characters.'),
  avatarUrl: z
    .string()
    .trim()
    .max(2048, 'Use no more than 2048 characters.')
    .refine((value) => value === '' || safeImageUrl(value) !== null, 'Use a full web address starting with https:// (or http://).'),
});
type Values = z.infer<typeof schema>;
const FIELDS = ['firstName', 'lastName', 'displayName', 'avatarUrl'] as const;

function valuesFrom(me: CurrentUser): Values {
  const fullName = `${me.firstName} ${me.lastName}`.trim();
  return {
    firstName: me.firstName,
    lastName: me.lastName,
    // The server shows your full name when the display name is empty.
    displayName: me.displayName === fullName || me.displayName === me.email ? '' : me.displayName,
    avatarUrl: me.avatarUrl ?? '',
  };
}

/**
 * Account → Profile (P1-API-12, P1-API-13). Global: it needs a session, not a
 * workspace. Email is read-only (no email-change endpoint exists) and the avatar
 * is a link to an image, not an upload.
 */
export function ProfilePage() {
  useDocumentTitle('Profile');
  const me = useQuery(meQuery);
  if (me.data) return <ProfileForm me={me.data} />;
  if (me.isError) {
    return (
      <Card>
        <ErrorState error={me.error} title="We couldn't load your profile" onRetry={() => void me.refetch()} retrying={me.isFetching} />
      </Card>
    );
  }
  return (
    <div className="grid gap-6" aria-busy="true">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-28 rounded-xl" />
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}

function ProfileForm({ me }: { me: CurrentUser }) {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: valuesFrom(me) });
  const { errors, isDirty, dirtyFields } = form.formState;
  const [firstName, lastName, displayName, avatarUrl] = useWatch({
    control: form.control,
    name: ['firstName', 'lastName', 'displayName', 'avatarUrl'],
  });
  const { blocker } = useUnsavedChanges(isDirty);

  // Keep the form in step with the server copy (another tab may have saved).
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(valuesFrom(me));
  }, [me, form]);

  const save = useMutation({
    mutationFn: (body: UpdateProfileRequest) => authApi.updateMe(body),
    onSuccess: async () => {
      // The answer is only { id, displayName }: re-read the full identity, and the
      // workspace views that show your name.
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'ws' && ['membership', 'members', 'member'].includes(String(query.queryKey[2])),
      });
      form.reset(form.getValues());
      toast.success('Profile saved');
    },
    // Recoverable: the form keeps what was typed.
    onError: (error) => applyServerErrors(form, error, { fields: FIELDS }),
  });

  const onSubmit = form.handleSubmit((values) => {
    // Send only what changed; '' clears the display name and the avatar.
    const body: UpdateProfileRequest = {};
    if (dirtyFields.firstName) body.firstName = values.firstName;
    if (dirtyFields.lastName) body.lastName = values.lastName;
    if (dirtyFields.displayName) body.displayName = values.displayName;
    if (dirtyFields.avatarUrl) body.avatarUrl = values.avatarUrl;
    if (Object.keys(body).length === 0) return;
    save.mutate(body);
  });

  const fullName = `${firstName ?? ''} ${lastName ?? ''}`.trim();
  const previewName = (displayName ?? '').trim() || fullName || me.email;
  const previewUrl = errors.avatarUrl ? null : safeImageUrl(avatarUrl);

  return (
    <div className="grid gap-6">
      <PageHeader title="Profile" description="How you appear to people in your workspaces." />

      <Card>
        <CardBody className="flex flex-col gap-5 pt-6 sm:flex-row sm:items-center">
          <Avatar name={me.displayName} src={me.avatarUrl} size="xl" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold text-ink">{me.displayName}</p>
            <p className="truncate text-sm text-muted">{me.email}</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {me.emailVerified ? (
                <Badge tone="success">
                  <BadgeCheck />
                  Email verified
                </Badge>
              ) : (
                <Badge tone="warning">
                  <MailWarning />
                  Email not verified
                </Badge>
              )}
              <Badge tone={me.status === 'ACTIVE' ? 'neutral' : 'warning'} dot>
                {me.status === 'ACTIVE' ? 'Active' : me.status === 'PENDING' ? 'Pending verification' : me.status.toLowerCase()}
              </Badge>
              {me.mfaEnabled ? (
                <Badge tone="brand">
                  <ShieldCheck />
                  Two-step verification on
                </Badge>
              ) : null}
              {me.isPlatformAdmin ? (
                <Badge tone="info">
                  <ShieldCheck />
                  Platform administrator
                </Badge>
              ) : null}
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <form onSubmit={onSubmit} noValidate>
          <CardHeader title="Personal details" description="Your name and picture are shown to members of your workspaces." />
          <CardBody className="grid gap-5">
            <Field label="Email" hint="Your email address is your sign-in and can't be changed here.">
              <Input value={me.email} readOnly leading={<Lock />} aria-readonly />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="First name" error={errors.firstName?.message}>
                <Input autoComplete="given-name" maxLength={100} {...form.register('firstName')} />
              </Field>
              <Field label="Last name" error={errors.lastName?.message}>
                <Input autoComplete="family-name" maxLength={100} {...form.register('lastName')} />
              </Field>
            </div>
            <Field
              label="Display name"
              optional
              error={errors.displayName?.message}
              hint="Leave empty to use your full name."
            >
              <Input autoComplete="nickname" maxLength={255} placeholder={fullName || 'Your full name'} {...form.register('displayName')} />
            </Field>
            <Field
              label="Profile picture"
              optional
              error={errors.avatarUrl?.message}
              hint="A link to an image that's already online. Leave empty to show your initials."
            >
              <div className="flex items-center gap-3">
                <Avatar name={previewName} src={previewUrl} size="lg" />
                <Input
                  type="url"
                  inputMode="url"
                  autoComplete="photo"
                  spellCheck={false}
                  maxLength={2048}
                  placeholder="https://…/me.png"
                  leading={<ImageIcon />}
                  className="flex-1"
                  {...form.register('avatarUrl')}
                />
              </div>
            </Field>
            <FormError message={errors.root?.server?.message} />
          </CardBody>
          <CardFooter>
            <Button variant="ghost" disabled={!isDirty || save.isPending} onClick={() => form.reset(valuesFrom(me))}>
              Discard
            </Button>
            <Button type="submit" disabled={!isDirty} loading={save.isPending}>
              Save changes
            </Button>
          </CardFooter>
        </form>
      </Card>
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}
