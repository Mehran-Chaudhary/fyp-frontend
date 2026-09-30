import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BadgeCheck, Lock, MailWarning, ShieldCheck } from 'lucide-react';
import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { PageHeader } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/misc';
import { authApi } from '@/lib/api/endpoints';
import type { CurrentUser, UpdateProfileRequest } from '@/lib/api/types';
import { applyServerErrors } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { meQuery, queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast } from '@/lib/toast';
import { nameField } from '@/lib/validation/schemas';

const schema = z.object({
  firstName: nameField('First name'),
  lastName: nameField('Last name'),
  displayName: z.string().trim().max(255, 'Use no more than 255 characters.'),
});
type Values = z.infer<typeof schema>;

function valuesFrom(me: CurrentUser): Values {
  const fullName = `${me.firstName} ${me.lastName}`.trim();
  return {
    firstName: me.firstName,
    lastName: me.lastName,
    // An empty display name means "use my full name" (spec §7.12).
    displayName: me.displayName === fullName ? '' : me.displayName,
  };
}

/** Account → Profile (spec §7.12, E8). */
export function ProfilePage() {
  useDocumentTitle('Profile');
  const { data: me } = useQuery(meQuery);
  if (!me) return null;
  return <ProfileForm me={me} />;
}

function ProfileForm({ me }: { me: CurrentUser }) {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: valuesFrom(me) });
  const { errors, isDirty, dirtyFields } = form.formState;
  const [firstName, lastName] = useWatch({ control: form.control, name: ['firstName', 'lastName'] });

  // Keep the form in step with the server copy (another tab may have saved).
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(valuesFrom(me));
  }, [me, form]);

  const save = useMutation({
    mutationFn: (body: UpdateProfileRequest) => authApi.updateMe(body),
    onSuccess: async (_result, body) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      form.reset({
        firstName: body.firstName ?? form.getValues('firstName'),
        lastName: body.lastName ?? form.getValues('lastName'),
        displayName: body.displayName ?? form.getValues('displayName'),
      });
      toast.success('Profile saved');
    },
    onError: (error) => applyServerErrors(form, error, { fields: ['firstName', 'lastName', 'displayName'] }),
  });

  const onSubmit = form.handleSubmit((values) => {
    // Send only what changed (spec §7.12).
    const body: UpdateProfileRequest = {};
    if (dirtyFields.firstName) body.firstName = values.firstName;
    if (dirtyFields.lastName) body.lastName = values.lastName;
    if (dirtyFields.displayName) body.displayName = values.displayName;
    if (Object.keys(body).length === 0) return;
    save.mutate(body);
  });

  const fullName = `${firstName ?? ''} ${lastName ?? ''}`.trim();

  return (
    <div className="grid gap-6">
      <PageHeader title="Profile" description="How you appear to people in your workspaces." />

      <Card>
        <CardBody className="flex flex-col gap-5 pt-6 sm:flex-row sm:items-center">
          <Avatar name={me.displayName} size="xl" />
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
          <CardHeader title="Personal details" description="Your name is shared with members of your workspaces." />
          <CardBody className="grid gap-5">
            <Field label="Email" hint="Your email address is your sign-in and can't be changed.">
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
    </div>
  );
}
