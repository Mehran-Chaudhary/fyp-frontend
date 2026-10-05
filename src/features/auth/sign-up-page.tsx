import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Mail, MailCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import { RateLimitNotice } from '@/components/feedback/global-states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { authApi } from '@/lib/api/endpoints';
import { isApiError, isOutcomeUnknown } from '@/lib/api/errors';
import { safeNext } from '@/lib/auth/landing';
import { readLinkToken } from '@/lib/auth/link-tokens';
import { completeSignIn } from '@/lib/auth/session';
import { applyServerErrors, messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { toast } from '@/lib/toast';
import { evaluatePassword, PASSWORD_MAX_LENGTH } from '@/lib/validation/password-policy';
import { emailField, nameField } from '@/lib/validation/schemas';
import { AuthCard, AuthHeading, AuthTabs } from './auth-layout';
import { PasswordStrength } from './password-strength';

const schema = z
  .object({
    firstName: nameField('First name'),
    lastName: nameField('Last name'),
    email: emailField,
    password: z
      .string()
      .min(1, 'Choose a password.')
      .max(PASSWORD_MAX_LENGTH, `Use no more than ${PASSWORD_MAX_LENGTH} characters.`),
    confirmPassword: z.string().min(1, 'Confirm your password.'),
  })
  .superRefine((values, ctx) => {
    const evaluation = evaluatePassword(values.password, [values.email, values.firstName, values.lastName]);
    if (!evaluation.valid) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: 'This password does not meet every rule below.' });
    }
    if (values.password !== values.confirmPassword) {
      ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: "The passwords don't match." });
    }
  });

type Values = z.infer<typeof schema>;
const FIELDS = ['firstName', 'lastName', 'email', 'password'] as const;

/**
 * Create an account (P1-API-01). The user is signed in at once, with no
 * workspace yet: a pending invitation comes first, otherwise onboarding.
 * `confirmPassword` stays in the browser; only the four API fields are sent.
 */
export function SignUpPage() {
  useDocumentTitle('Create account');
  const [params] = useSearchParams();
  const [emailTaken, setEmailTaken] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { firstName: '', lastName: '', email: '', password: '', confirmPassword: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const [password, email, firstName, lastName] = useWatch({
    control: form.control,
    name: ['password', 'email', 'firstName', 'lastName'],
  });

  const onSubmit = form.handleSubmit(async ({ firstName, lastName, email, password }) => {
    const values = { firstName, lastName, email, password };
    setEmailTaken(false);
    setUncertain(false);
    try {
      const { data } = await authApi.register(values);
      toast.success('Account created', {
        description: `We sent a verification link to ${values.email}. Check your inbox to verify your email.`,
        duration: 8_000,
      });
      // Signs in and lets the public-only guard route: a new user has no
      // workspace yet, so they land on "Create workspace" (spec §6.3).
      await completeSignIn(data);
    } catch (error) {
      if (isOutcomeUnknown(error)) {
        // The account may exist now. Signing in tells; registering again would not.
        setUncertain(true);
        return;
      }
      if (!isApiError(error)) {
        form.setError('root.server', { message: messageFor(error) });
        return;
      }
      switch (error.code) {
        case 'ACCOUNT_ALREADY_EXISTS':
          setEmailTaken(true);
          form.setError('email', { message: 'An account with this email already exists.' }, { shouldFocus: true });
          break;
        case 'AUTH_PASSWORD_BREACHED':
          form.setError('password', { message: messageFor(error) }, { shouldFocus: true });
          break;
        case 'RATE_LIMIT_EXCEEDED':
          setRateLimitedUntil(error.retryDeadline());
          break;
        default:
          applyServerErrors(form, error, { passwordField: 'password', fields: FIELDS });
      }
    }
  });

  const next = params.get('next');
  const signInHref = `/auth/sign-in${next ? `?next=${encodeURIComponent(next)}` : ''}`;
  // From an invitation: the masked address it was sent to. A hint only: it is
  // never used as the email (spec §6 "Invitations").
  const invitation = readLinkToken('invitation');
  const hint = invitation?.meta?.maskedEmail ?? null;
  const fromInvitation = !!invitation || !!safeNext(next)?.startsWith('/invitations/accept');

  return (
    <>
      <AuthTabs active="sign-up" />
      <AuthCard>
        <form onSubmit={onSubmit} noValidate>
          <AuthHeading
            title="Create your account"
            description={
              fromInvitation
                ? "Create your account, then you'll be taken back to accept the invitation."
                : "Start a private workspace for your team's AI agents."
            }
          />
          {hint ? (
            <Callout tone="info" icon={<MailCheck className="size-4" />} className="mb-5">
              Your invitation was sent to <span className="font-mono font-semibold">{hint}</span>. Use that address so it
              can be accepted.
            </Callout>
          ) : null}
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name" error={errors.firstName?.message}>
                <Input autoComplete="given-name" autoFocus placeholder="Zara" {...form.register('firstName')} />
              </Field>
              <Field label="Last name" error={errors.lastName?.message}>
                <Input autoComplete="family-name" placeholder="Khan" {...form.register('lastName')} />
              </Field>
            </div>
            <Field
              label="Work email"
              error={errors.email?.message}
              hint={
                emailTaken ? (
                  <Link to={signInHref} className="font-medium text-brand-700 underline underline-offset-4">
                    Sign in instead
                  </Link>
                ) : undefined
              }
            >
              <Input
                type="email"
                autoComplete="email"
                inputMode="email"
                leading={<Mail />}
                placeholder="you@company.com"
                {...form.register('email')}
              />
            </Field>
            <Field label="Password" error={errors.password?.message}>
              <PasswordInput autoComplete="new-password" placeholder="At least 12 characters" {...form.register('password')} />
            </Field>
            <PasswordStrength password={password ?? ''} personalData={[email, firstName, lastName]} className="-mt-1" />
            <Field label="Confirm password" error={errors.confirmPassword?.message}>
              <PasswordInput autoComplete="new-password" placeholder="Type it again" {...form.register('confirmPassword')} />
            </Field>

            <RateLimitNotice
              until={rateLimitedUntil}
              message="Too many attempts from this network."
              onDone={() => setRateLimitedUntil(null)}
            />
            {uncertain ? (
              <Callout
                tone="warning"
                title="We couldn't confirm whether your account was created"
                action={
                  <Button asChild size="sm" variant="secondary">
                    <Link to={signInHref}>Sign in instead</Link>
                  </Button>
                }
              >
                The connection dropped before AgentVault answered. Try signing in with this email first; if that
                doesn't work, create the account again.
              </Callout>
            ) : null}
            <FormError message={errors.root?.server?.message} />

            <Button type="submit" size="lg" className="mt-1 w-full" loading={isSubmitting} disabled={!!rateLimitedUntil}>
              Create account
              {isSubmitting ? null : <ArrowRight />}
            </Button>
            <p className="text-center text-xs leading-relaxed text-faint">
              Passwords are checked against known data breaches without ever being sent in full.
            </p>
          </div>
        </form>
      </AuthCard>
      <p className="mt-6 text-center text-[13px] text-muted">
        Already have an account?{' '}
        <Link
          to={signInHref}
          className="font-medium text-brand-700 underline decoration-brand-200 underline-offset-4 hover:decoration-brand-500"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
