import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { RateLimitNotice } from '@/components/feedback/global-states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FormError } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/password-input';
import { authApi } from '@/lib/api/endpoints';
import { isApiError } from '@/lib/api/errors';
import { credentialsChanged, hasActiveSession, refreshAccessToken } from '@/lib/api/token-manager';
import { applyServerErrors, messageFor } from '@/lib/errors';
import { queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast } from '@/lib/toast';
import { pluralize } from '@/lib/utils';
import { existingPasswordField, newPasswordField } from '@/lib/validation/schemas';
import { PasswordStrength } from '@/features/auth/password-strength';

const schema = z
  .object({
    currentPassword: existingPasswordField,
    newPassword: newPasswordField,
    confirmPassword: z.string().min(1, 'Confirm your new password.'),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ['confirmPassword'],
    message: "The passwords don't match.",
  });
type Values = z.infer<typeof schema>;

/** Change password (P1-API-18). */
export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">{open ? <ChangePasswordForm onDone={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  const [finishing, setFinishing] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const newPassword = useWatch({ control: form.control, name: 'newPassword' });

  const onSubmit = form.handleSubmit(async ({ currentPassword, newPassword: next }) => {
    let revoked: number;
    try {
      const result = await authApi.changePassword({ currentPassword, newPassword: next });
      revoked = result.revokedSessions;
    } catch (error) {
      if (!isApiError(error)) {
        form.setError('root.server', { message: messageFor(error) });
        return;
      }
      switch (error.code) {
        case 'AUTH_PASSWORD_MISMATCH':
          // Wrong input, not an expired session: never refresh or sign out here.
          form.setError('currentPassword', { message: 'Current password is incorrect.' }, { shouldFocus: true });
          break;
        case 'AUTH_PASSWORD_REUSED':
          form.setError('newPassword', { message: 'Must differ from your current password.' }, { shouldFocus: true });
          break;
        case 'AUTH_PASSWORD_BREACHED':
          form.setError('newPassword', { message: messageFor(error) }, { shouldFocus: true });
          break;
        case 'RATE_LIMIT_EXCEEDED':
          setRateLimitedUntil(error.retryDeadline());
          break;
        default:
          applyServerErrors(form, error, {
            passwordField: 'newPassword',
            fields: ['currentPassword', 'newPassword'],
          });
      }
      return;
    }

    // The server cut off every access token issued before the change, this tab's
    // included. The refresh cookie's family was kept, so one explicit, coordinated
    // refresh renews this session (spec §4 "Credential changes"); other tabs of
    // this browser learn the old token is dead and renew on their next request.
    setFinishing(true);
    form.reset();
    credentialsChanged();
    let renewed: string | null = null;
    try {
      renewed = await refreshAccessToken();
    } catch {
      // Offline or throttled: the session is kept and renews on the next request.
    }
    if (renewed === null && !hasActiveSession()) {
      // The refresh was refused (no cookie travelled): sign in with the new password.
      return;
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    toast.success('Password changed', {
      description:
        revoked > 0
          ? `${pluralize(revoked, 'other device')} ${revoked === 1 ? 'was' : 'were'} signed out.`
          : 'This device stays signed in.',
    });
    onDone();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="contents">
      <DialogHeader
        icon={<KeyRound />}
        title="Change password"
        description="Other devices will be signed out. This one stays signed in."
      />
      <DialogBody className="grid gap-4">
        <Field label="Current password" error={errors.currentPassword?.message}>
          <PasswordInput autoComplete="current-password" autoFocus {...form.register('currentPassword')} />
        </Field>
        <Field label="New password" error={errors.newPassword?.message}>
          <PasswordInput autoComplete="new-password" {...form.register('newPassword')} />
        </Field>
        <PasswordStrength password={newPassword ?? ''} className="-mt-1" />
        <Field label="Confirm new password" error={errors.confirmPassword?.message}>
          <PasswordInput autoComplete="new-password" {...form.register('confirmPassword')} />
        </Field>
        <RateLimitNotice until={rateLimitedUntil} onDone={() => setRateLimitedUntil(null)} />
        <FormError message={errors.root?.server?.message} />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onDone} disabled={isSubmitting || finishing}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting || finishing} disabled={!!rateLimitedUntil}>
          {finishing ? 'Securing session…' : 'Change password'}
        </Button>
      </DialogFooter>
    </form>
  );
}
