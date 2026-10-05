import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, LinkIcon } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { RateLimitNotice } from '@/components/feedback/global-states';
import { Button } from '@/components/ui/button';
import { Field, FormError } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/password-input';
import { authApi } from '@/lib/api/endpoints';
import { isApiError } from '@/lib/api/errors';
import { hasActiveSession } from '@/lib/api/token-manager';
import { clearLinkToken, linkTokenFor } from '@/lib/auth/link-tokens';
import { endSessionLocally } from '@/lib/auth/session';
import { applyServerErrors, messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { newPasswordField } from '@/lib/validation/schemas';
import { AuthCard, AuthHeading } from './auth-layout';
import { PasswordStrength } from './password-strength';

const schema = z
  .object({
    password: newPasswordField,
    confirmPassword: z.string().min(1, 'Confirm your new password.'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: "The passwords don't match.",
  });
type Values = z.infer<typeof schema>;

/**
 * /auth/reset-password — the link the backend emails (P1-API-17). The loader
 * moved the token out of the address bar; it lives only for this flow and
 * survives a breached-password rejection so another password can be tried.
 */
export function ResetPasswordPage() {
  useDocumentTitle('Choose a new password');
  const [params] = useSearchParams();
  const token = linkTokenFor('reset-password', params);
  const navigate = useNavigate();
  const [linkInvalid, setLinkInvalid] = useState(!token);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const password = useWatch({ control: form.control, name: 'password' });

  const onSubmit = form.handleSubmit(async ({ password: newPassword }) => {
    if (!token) return;
    try {
      await authApi.resetPassword({ token, password: newPassword });
      clearLinkToken('reset-password');
      form.reset();
      // Every session was revoked and the cookie cleared. If this browser was
      // signed in, clean up locally (no API call).
      if (hasActiveSession()) endSessionLocally('password-reset');
      navigate('/auth/sign-in?reason=password-reset', { replace: true });
    } catch (error) {
      if (!isApiError(error)) {
        form.setError('root.server', { message: messageFor(error) });
        return;
      }
      if (error.is('TOKEN_NOT_FOUND', 'TOKEN_EXPIRED', 'TOKEN_ALREADY_USED')) {
        clearLinkToken('reset-password');
        setLinkInvalid(true);
      } else if (error.is('AUTH_PASSWORD_BREACHED')) {
        // The link stays usable: let them try another password.
        form.setError('password', { message: messageFor(error) }, { shouldFocus: true });
      } else if (error.is('RATE_LIMIT_EXCEEDED')) {
        setRateLimitedUntil(error.retryDeadline());
      } else {
        applyServerErrors(form, error, { passwordField: 'password', fields: ['password'] });
      }
    }
  });

  if (linkInvalid) {
    return (
      <AuthCard>
        <span className="inline-flex size-10 items-center justify-center rounded-xl border border-warning-200 bg-warning-50 text-warning-600">
          <LinkIcon className="size-5" />
        </span>
        <AuthHeading
          title={token ? 'This reset link is no longer valid' : 'This reset link is invalid'}
          description="Reset links work once and expire after an hour. Requesting a new link also cancels older ones."
        />
        <div className="grid gap-2">
          <Button asChild size="lg" className="w-full">
            <Link to="/auth/forgot-password">Request a new link</Link>
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link to="/auth/sign-in">Back to sign in</Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <span className="inline-flex size-10 items-center justify-center rounded-xl border border-brand-200 bg-brand-50 text-brand-700">
        <KeyRound className="size-5" />
      </span>
      <form onSubmit={onSubmit} noValidate>
        <AuthHeading
          title="Choose a new password"
          description="After the reset, every device signed in to your account is signed out."
        />
        <div className="grid gap-4">
          <Field label="New password" error={errors.password?.message}>
            <PasswordInput autoComplete="new-password" autoFocus {...form.register('password')} />
          </Field>
          <PasswordStrength password={password ?? ''} className="-mt-1" />
          <Field label="Confirm new password" error={errors.confirmPassword?.message}>
            <PasswordInput autoComplete="new-password" {...form.register('confirmPassword')} />
          </Field>
          <RateLimitNotice until={rateLimitedUntil} onDone={() => setRateLimitedUntil(null)} />
          <FormError message={errors.root?.server?.message} />
          <Button type="submit" size="lg" className="w-full" loading={isSubmitting} disabled={!!rateLimitedUntil}>
            Reset password
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
