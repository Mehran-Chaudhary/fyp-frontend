import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight, KeyRound, Lock, Mail, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams, type NavigateFunction } from 'react-router';
import { z } from 'zod';
import { RateLimitNotice } from '@/components/feedback/global-states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { OtpInput } from '@/components/ui/otp-input';
import { PasswordInput } from '@/components/ui/password-input';
import { authApi } from '@/lib/api/endpoints';
import { isApiError } from '@/lib/api/errors';
import { isMfaRequired, type MfaChallenge } from '@/lib/api/types';
import { completeSignIn } from '@/lib/auth/session';
import { applyServerErrors, messageFor } from '@/lib/errors';
import { useCountdown, useDocumentTitle } from '@/lib/hooks';
import { mfaQuery } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast } from '@/lib/toast';
import { formatCountdown, formatTime } from '@/lib/utils';
import { emailField, existingPasswordField, normaliseTotp, TOTP_PATTERN } from '@/lib/validation/schemas';
import { AuthCard, AuthHeading, AuthTabs } from './auth-layout';
import { ReasonBanner } from './reason-banner';

type Step =
  | { kind: 'password' }
  | { kind: 'mfa'; challenge: MfaChallenge; expiresAt: number; email: string };

/** Sign in (spec §7.1) with the two-step verification step (§7.2). */
export function SignInPage() {
  useDocumentTitle('Sign in');
  const [params] = useSearchParams();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);

  const backToPassword = (message?: string) => {
    setStep({ kind: 'password' });
    setNotice(message ?? null);
  };

  return (
    <>
      {step.kind === 'password' ? <AuthTabs active="sign-in" /> : null}
      <AuthCard>
        {step.kind === 'password' ? (
          <PasswordStep
            initialEmail={email}
            reason={notice ? null : params.get('reason')}
            notice={notice}
            lockedUntil={lockedUntil}
            onLocked={setLockedUntil}
            onUnlocked={() => setLockedUntil(null)}
            onMfaRequired={(challenge, serverTime, signInEmail) => {
              setEmail(signInEmail);
              setNotice(null);
              // Compute expiry relative to the server's clock so a skewed client
              // clock cannot shorten or stretch the countdown.
              const lifetime = Date.parse(challenge.expiresAt) - Date.parse(serverTime);
              const expiresAt = Date.now() + (Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 5 * 60_000);
              setStep({ kind: 'mfa', challenge, expiresAt, email: signInEmail });
            }}
          />
        ) : (
          <MfaStep
            challenge={step.challenge}
            expiresAt={step.expiresAt}
            email={step.email}
            onBack={backToPassword}
            onLocked={(until) => {
              setLockedUntil(until);
              backToPassword();
            }}
          />
        )}
      </AuthCard>
      {step.kind === 'password' ? (
        <p className="mt-6 text-center text-[13px] text-muted">
          New to AgentVault?{' '}
          <Link
            to={`/auth/sign-up${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`}
            className="font-medium text-brand-700 underline decoration-brand-200 underline-offset-4 hover:decoration-brand-500"
          >
            Create an account
          </Link>
        </p>
      ) : null}
    </>
  );
}

// ── Password step ───────────────────────────────────────────────────────────

const passwordSchema = z.object({
  email: emailField,
  password: existingPasswordField,
});
type PasswordValues = z.infer<typeof passwordSchema>;

function PasswordStep({
  initialEmail,
  reason,
  notice,
  lockedUntil,
  onLocked,
  onUnlocked,
  onMfaRequired,
}: {
  initialEmail: string;
  reason: string | null;
  notice: string | null;
  lockedUntil: number | null;
  onLocked: (until: number) => void;
  onUnlocked: () => void;
  onMfaRequired: (challenge: MfaChallenge, serverTime: string, email: string) => void;
}) {
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const lockRemaining = useCountdown(lockedUntil, onUnlocked);
  const locked = !!lockedUntil && lockRemaining > 0;

  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { email: initialEmail, password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setBlocked(null);
    try {
      const { data, meta } = await authApi.login(values);
      if (isMfaRequired(data)) {
        onMfaRequired(data.challenge, meta.timestamp, values.email);
        return;
      }
      await completeSignIn(data);
      // The public-only guard now routes to `next` or the default landing.
    } catch (error) {
      if (!isApiError(error)) {
        form.setError('root.server', { message: messageFor(error) });
        return;
      }
      switch (error.code) {
        case 'AUTH_INVALID_CREDENTIALS':
          // Same message for unknown emails, by design. Keep the email.
          form.setValue('password', '');
          form.setError('root.server', { message: 'Invalid email address or password.' });
          form.setFocus('password');
          break;
        case 'ACCOUNT_LOCKED':
          onLocked(error.lockDeadline());
          form.setValue('password', '');
          break;
        case 'ACCOUNT_SUSPENDED':
        case 'ACCOUNT_DEACTIVATED':
          setBlocked(error.message);
          break;
        case 'RATE_LIMIT_EXCEEDED':
          setRateLimitedUntil(error.retryDeadline());
          break;
        default:
          applyServerErrors(form, error, { fields: ['email', 'password'] });
      }
    }
  });

  const rateLimited = !!rateLimitedUntil && rateLimitedUntil > 0;

  return (
    <form onSubmit={onSubmit} noValidate>
      <AuthHeading title="Welcome back" description="Sign in to your secure AI workspace." />
      <ReasonBanner reason={reason} />
      {notice ? (
        <Callout tone="warning" className="mb-5" role="status">
          {notice}
        </Callout>
      ) : null}

      <div className="grid gap-4">
        <Field label="Work email" error={errors.email?.message}>
          <Input
            type="email"
            autoComplete="username"
            inputMode="email"
            autoFocus={!initialEmail}
            leading={<Mail />}
            placeholder="you@company.com"
            {...form.register('email')}
          />
        </Field>
        <Field
          label="Password"
          error={errors.password?.message}
          labelAside={
            <Link
              to="/auth/forgot-password"
              className="rounded-sm text-[13px] font-medium text-brand-700 hover:text-brand-800 hover:underline hover:underline-offset-4"
            >
              Forgot password?
            </Link>
          }
        >
          <PasswordInput
            autoComplete="current-password"
            autoFocus={!!initialEmail}
            leading={<Lock />}
            placeholder="Your password"
            {...form.register('password')}
          />
        </Field>

        {locked ? (
          <Callout tone="danger" role="alert" title="Too many failed attempts.">
            Try again at {formatTime(lockedUntil)}{' '}
            <span className="font-mono tabular">({formatCountdown(lockRemaining)})</span>.
          </Callout>
        ) : null}
        {blocked ? (
          <Callout tone="danger" role="alert">
            {blocked}
          </Callout>
        ) : null}
        <RateLimitNotice
          until={rateLimitedUntil}
          message="Too many sign-in attempts."
          onDone={() => setRateLimitedUntil(null)}
        />
        <FormError message={errors.root?.server?.message} />

        <Button type="submit" size="lg" className="mt-1 w-full" loading={isSubmitting} disabled={locked || rateLimited}>
          Sign in to workspace
          {isSubmitting ? null : <ArrowRight />}
        </Button>
      </div>
    </form>
  );
}

// ── Two-step verification step ──────────────────────────────────────────────

function MfaStep({
  challenge,
  expiresAt,
  email,
  onBack,
  onLocked,
}: {
  challenge: MfaChallenge;
  expiresAt: number;
  email: string;
  onBack: (message?: string) => void;
  onLocked: (until: number) => void;
}) {
  const canUseRecovery = challenge.methods.includes('recovery_code');
  const [mode, setMode] = useState<'totp' | 'recovery'>(challenge.methods.includes('totp') ? 'totp' : 'recovery');
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  const navigate = useNavigate();

  const remaining = useCountdown(expiresAt, () => onBack('This sign-in attempt expired. Sign in again.'));

  const submit = async (value: string) => {
    if (submitting) return;
    setError(null);

    if (mode === 'totp' && !TOTP_PATTERN.test(value)) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    if (mode === 'recovery' && !value.trim()) {
      setError('Enter one of your recovery codes.');
      return;
    }

    setSubmitting(true);
    try {
      const auth = await authApi.verifyMfa(
        mode === 'totp'
          ? { challengeToken: challenge.token, code: normaliseTotp(value) }
          : { challengeToken: challenge.token, recoveryCode: value.trim() },
      );
      await completeSignIn(auth);
      if (mode === 'recovery') void warnIfFewRecoveryCodes(navigate);
    } catch (err) {
      setSubmitting(false);
      if (!isApiError(err)) {
        setError(messageFor(err));
        return;
      }
      switch (err.code) {
        case 'MFA_CODE_INVALID':
          setError(mode === 'totp' ? 'That code is not valid.' : 'That recovery code is not valid.');
          setCode('');
          setRecoveryCode('');
          setAttempt((n) => n + 1);
          break;
        case 'MFA_CHALLENGE_INVALID':
          onBack(err.message);
          break;
        case 'ACCOUNT_LOCKED':
          onLocked(err.lockDeadline());
          break;
        case 'ACCOUNT_SUSPENDED':
        case 'ACCOUNT_DEACTIVATED':
          onBack(err.message);
          break;
        case 'RATE_LIMIT_EXCEEDED':
          setRateLimitedUntil(err.retryDeadline());
          break;
        default:
          setError(messageFor(err));
      }
    }
  };

  const switchMode = () => {
    setMode((current) => (current === 'totp' ? 'recovery' : 'totp'));
    setError(null);
    setCode('');
    setRecoveryCode('');
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit(mode === 'totp' ? code : recoveryCode);
      }}
    >
      <button
        type="button"
        onClick={() => onBack()}
        className="-ml-1 mb-5 flex w-fit items-center gap-1.5 rounded-md px-1 py-0.5 text-[13px] font-medium text-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        Back
      </button>

      <span className="inline-flex size-10 items-center justify-center rounded-xl border border-brand-200 bg-brand-50 text-brand-700">
        {mode === 'totp' ? <Smartphone className="size-5" /> : <KeyRound className="size-5" />}
      </span>
      <AuthHeading
        title="Two-step verification"
        description={
          mode === 'totp' ? (
            <>
              Enter the 6-digit code from your authenticator app for <span className="text-ink-soft">{email}</span>.
            </>
          ) : (
            <>
              Enter one of the recovery codes you saved when you turned on two-step verification. Each code works
              once.
            </>
          )
        }
      />

      <div className="grid gap-4">
        {mode === 'totp' ? (
          <Field label="Authentication code" error={error ?? undefined}>
            <OtpInput
              key={attempt}
              value={code}
              onChange={setCode}
              onComplete={(value) => void submit(value)}
              autoFocus
              disabled={submitting}
            />
          </Field>
        ) : (
          <Field label="Recovery code" error={error ?? undefined}>
            <Input
              key={attempt}
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value)}
              placeholder="xxxxx-xxxxx"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={32}
              autoFocus
              inputClassName="font-mono tracking-wider"
              leading={<KeyRound />}
            />
          </Field>
        )}

        {error && mode === 'totp' ? (
          <p className="-mt-2 text-xs leading-relaxed text-muted">
            Each code works once. If you just used this one, wait for the next code.
          </p>
        ) : null}

        <RateLimitNotice until={rateLimitedUntil} message="Too many attempts." onDone={() => setRateLimitedUntil(null)} />

        <Button type="submit" size="lg" className="w-full" loading={submitting} disabled={!!rateLimitedUntil}>
          Verify and sign in
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
          {canUseRecovery ? (
            <button
              type="button"
              onClick={switchMode}
              className="rounded-sm font-medium text-brand-700 hover:text-brand-800 hover:underline hover:underline-offset-4"
            >
              {mode === 'totp' ? 'Use a recovery code instead' : 'Use your authenticator app'}
            </button>
          ) : (
            <span />
          )}
          <span className="text-faint tabular" aria-live="off">
            Expires in {formatCountdown(remaining)}
          </span>
        </div>
      </div>
    </form>
  );
}

/** After a recovery-code sign-in, nudge when few codes remain (spec §7.2). */
async function warnIfFewRecoveryCodes(navigate: NavigateFunction): Promise<void> {
  try {
    const status = await queryClient.fetchQuery({ ...mfaQuery, staleTime: 0 });
    if (status.enabled && status.recoveryCodesRemaining <= 3) {
      toast.warning(
        status.recoveryCodesRemaining === 0
          ? 'You have no recovery codes left'
          : `Only ${status.recoveryCodesRemaining} recovery code${status.recoveryCodesRemaining === 1 ? '' : 's'} left`,
        {
          description: 'Generate new recovery codes in Account → Security.',
          duration: 12_000,
          action: { label: 'Open', onClick: () => void navigate('/account/security') },
        },
      );
    }
  } catch {
    /* a nudge only */
  }
}
