import { useQuery } from '@tanstack/react-query';
import { KeyRound, RefreshCw, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useState, type FormEvent } from 'react';
import { RateLimitNotice } from '@/components/feedback/global-states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { CopyButton } from '@/components/ui/copy-button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { OtpInput } from '@/components/ui/otp-input';
import { PasswordInput } from '@/components/ui/password-input';
import { authApi } from '@/lib/api/endpoints';
import { isApiError, type ApiError } from '@/lib/api/errors';
import { installToken } from '@/lib/api/token-manager';
import type { MfaSetup } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { meQuery, queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { normaliseTotp, TOTP_PATTERN } from '@/lib/validation/schemas';
import { RecoveryCodesPanel } from './recovery-codes';

function refreshMfaState() {
  void queryClient.invalidateQueries({ queryKey: queryKeys.mfa });
  void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
}

/** Shared handling for the throttle every MFA endpoint shares (spec §3.6). */
function useRateLimit() {
  const [until, setUntil] = useState<number | null>(null);
  return {
    until,
    clear: () => setUntil(null),
    catch: (error: unknown): boolean => {
      if (isApiError(error) && error.code === 'RATE_LIMIT_EXCEEDED') {
        setUntil(error.retryDeadline());
        return true;
      }
      return false;
    },
  };
}

// ── Enable (3-step wizard) ──────────────────────────────────────────────────

type SetupStep = { kind: 'password' } | { kind: 'scan'; setup: MfaSetup } | { kind: 'codes'; codes: string[] };

/** Turn on two-step verification (spec §7.13 card 2, E17 → E18). */
export function EnableMfaDialog({
  open,
  onOpenChange,
  onEnabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEnabled?: () => void;
}) {
  const [step, setStep] = useState<SetupStep>({ kind: 'password' });
  const [acknowledged, setAcknowledged] = useState(false);
  const locked = step.kind === 'codes' && !acknowledged;

  const close = (next: boolean) => {
    if (next) return onOpenChange(true);
    if (locked) return; // the codes are shown once: make sure they were saved
    onOpenChange(false);
    // Reset after the close animation.
    window.setTimeout(() => {
      setStep({ kind: 'password' });
      setAcknowledged(false);
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        size={step.kind === 'password' ? 'md' : 'lg'}
        hideClose={locked}
        onEscapeKeyDown={(event) => locked && event.preventDefault()}
        onInteractOutside={(event) => step.kind !== 'password' && event.preventDefault()}
      >
        <StepIndicator current={step.kind} />
        {step.kind === 'password' ? (
          <PasswordStep
            onCancel={() => close(false)}
            onReady={(setup) => setStep({ kind: 'scan', setup })}
            onAlreadyEnabled={() => {
              refreshMfaState();
              close(false);
            }}
          />
        ) : step.kind === 'scan' ? (
          <ScanStep
            setup={step.setup}
            onCancel={() => close(false)}
            onRestart={() => setStep({ kind: 'password' })}
            onAlreadyEnabled={() => {
              refreshMfaState();
              close(false);
            }}
            onEnabled={(codes) => {
              setStep({ kind: 'codes', codes });
              refreshMfaState();
              onEnabled?.();
            }}
          />
        ) : (
          <>
            <DialogHeader
              icon={<ShieldCheck />}
              title="Two-step verification is on"
              description="Your other devices were signed out; they'll need a code next time. Keep these recovery codes for when your phone isn't at hand."
            />
            <DialogBody>
              <RecoveryCodesPanel
                codes={step.codes}
                email={queryClient.getQueryData(meQuery.queryKey)?.email}
                acknowledged={acknowledged}
                onAcknowledgedChange={setAcknowledged}
              />
            </DialogBody>
            <DialogFooter>
              <Button
                disabled={!acknowledged}
                onClick={() => {
                  onOpenChange(false);
                  window.setTimeout(() => {
                    setStep({ kind: 'password' });
                    setAcknowledged(false);
                  }, 200);
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StepIndicator({ current }: { current: SetupStep['kind'] }) {
  const steps: Array<{ key: SetupStep['kind']; label: string }> = [
    { key: 'password', label: 'Confirm' },
    { key: 'scan', label: 'Scan' },
    { key: 'codes', label: 'Save codes' },
  ];
  const index = steps.findIndex((step) => step.key === current);
  return (
    <ol className="flex items-center gap-2 px-6 pt-5 text-[11px] font-medium text-faint" aria-label="Progress">
      {steps.map((step, i) => (
        <li key={step.key} className="flex items-center gap-2" aria-current={i === index ? 'step' : undefined}>
          <span
            className={cn(
              'inline-flex size-5 items-center justify-center rounded-full border text-[10px] tabular',
              i < index && 'border-brand-600 bg-brand-600 text-white',
              i === index && 'border-brand-500 text-brand-700',
              i > index && 'border-line-strong',
            )}
          >
            {i + 1}
          </span>
          <span className={cn(i === index && 'text-ink-soft')}>{step.label}</span>
          {i < steps.length - 1 ? <span className="h-px w-6 bg-line-strong" aria-hidden /> : null}
        </li>
      ))}
    </ol>
  );
}

function PasswordStep({
  onCancel,
  onReady,
  onAlreadyEnabled,
}: {
  onCancel: () => void;
  onReady: (setup: MfaSetup) => void;
  onAlreadyEnabled: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const rateLimit = useRateLimit();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password) {
      setError('Enter your password.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      onReady(await authApi.mfaSetup(password));
    } catch (err) {
      if (rateLimit.catch(err)) return;
      if (isApiError(err) && err.code === 'AUTH_PASSWORD_MISMATCH') setError('That password is incorrect.');
      else if (isApiError(err) && err.code === 'MFA_ALREADY_ENABLED') onAlreadyEnabled();
      else setError(messageFor(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="contents">
      <DialogHeader
        icon={<Smartphone />}
        title="Turn on two-step verification"
        description="You'll need an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password. First, confirm it's you."
      />
      <DialogBody className="grid gap-4">
        <Field label="Password" error={error ?? undefined}>
          <PasswordInput autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <RateLimitNotice until={rateLimit.until} onDone={rateLimit.clear} />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting} disabled={!!rateLimit.until}>
          Continue
        </Button>
      </DialogFooter>
    </form>
  );
}

function ScanStep({
  setup,
  onCancel,
  onRestart,
  onAlreadyEnabled,
  onEnabled,
}: {
  setup: MfaSetup;
  onCancel: () => void;
  onRestart: () => void;
  onAlreadyEnabled: () => void;
  onEnabled: (codes: string[]) => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const rateLimit = useRateLimit();
  const groupedSecret = setup.secret.match(/.{1,4}/g)?.join(' ') ?? setup.secret;

  const submit = async (value: string) => {
    if (submitting) return;
    if (!TOTP_PATTERN.test(value)) {
      setError('Enter the 6-digit code shown in your app.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result = await authApi.mfaEnable(normaliseTotp(value));
      // This session is now MFA-verified: install the new token immediately, not
      // when "Done" is clicked (spec §4.7).
      if (result.accessToken && result.expiresIn) installToken(result.accessToken, result.expiresIn);
      onEnabled(result.recoveryCodes);
    } catch (err) {
      setSubmitting(false);
      if (rateLimit.catch(err)) return;
      const apiError = err as ApiError;
      if (isApiError(err) && apiError.code === 'MFA_CODE_INVALID') {
        setError('Code not valid. Check the time on your phone and try the next code.');
        setCode('');
        setAttempt((n) => n + 1);
      } else if (isApiError(err) && apiError.code === 'MFA_NOT_ENROLLING') {
        toast.info('Setup expired', { description: 'Confirm your password to start again.' });
        onRestart();
      } else if (isApiError(err) && apiError.code === 'MFA_ALREADY_ENABLED') {
        onAlreadyEnabled();
      } else {
        setError(messageFor(err));
      }
    }
  };

  return (
    <form
      noValidate
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(code);
      }}
    >
      <DialogHeader
        icon={<Smartphone />}
        title="Scan with your authenticator app"
        description="Add a new account in the app and scan this code. Nothing is switched on until you enter the code it shows."
      />
      <DialogBody className="grid gap-5">
        <div className="grid items-center gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
          {/* White with padding so it scans from any screen (spec §7.13). */}
          <div className="mx-auto rounded-xl border border-line bg-white p-2.5 shadow-card">
            <QRCodeSVG value={setup.otpauthUri} size={168} level="M" marginSize={1} title="Authenticator setup QR code" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ink-soft">Can't scan? Enter this key</p>
            <div className="mt-1.5 flex items-start gap-1 rounded-lg border border-line bg-well/60 py-1.5 pr-1 pl-3">
              <code className="min-w-0 flex-1 py-1 font-mono text-[13px] leading-relaxed tracking-wide break-words text-ink">
                {groupedSecret}
              </code>
              <CopyButton value={setup.secret} iconOnly variant="ghost" label="Copy key" />
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              Account <span className="text-ink-soft">{setup.account}</span>
              <br />
              Time-based · 6 digits · 30 seconds
            </p>
          </div>
        </div>
        <Field label="Enter the 6-digit code from the app" error={error ?? undefined}>
          <OtpInput key={attempt} value={code} onChange={setCode} onComplete={(value) => void submit(value)} autoFocus disabled={submitting} />
        </Field>
        <RateLimitNotice until={rateLimit.until} onDone={rateLimit.clear} />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting} disabled={!!rateLimit.until}>
          Verify and turn on
        </Button>
      </DialogFooter>
    </form>
  );
}

// ── Regenerate recovery codes ───────────────────────────────────────────────

/** Replace recovery codes (spec §7.13, E20). Authenticator code only. */
export function RegenerateCodesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<{ password?: string; code?: string; form?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const rateLimit = useRateLimit();
  const { data: me } = useQuery(meQuery);
  const locked = !!codes && !acknowledged;

  const reset = () => {
    setPassword('');
    setCode('');
    setErrors({});
    setCodes(null);
    setAcknowledged(false);
  };

  const close = (next: boolean) => {
    if (next) return onOpenChange(true);
    if (locked) return;
    onOpenChange(false);
    window.setTimeout(reset, 200);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: typeof errors = {};
    if (!password) nextErrors.password = 'Enter your password.';
    if (!TOTP_PATTERN.test(code)) nextErrors.code = 'Enter the 6-digit code from your app.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSubmitting(true);
    try {
      const result = await authApi.regenerateRecoveryCodes({ password, code: normaliseTotp(code) });
      setCodes(result.recoveryCodes);
      void queryClient.invalidateQueries({ queryKey: queryKeys.mfa });
    } catch (err) {
      if (rateLimit.catch(err)) return;
      if (isApiError(err) && err.code === 'AUTH_PASSWORD_MISMATCH') setErrors({ password: 'That password is incorrect.' });
      else if (isApiError(err) && err.code === 'MFA_CODE_INVALID') {
        setErrors({ code: 'That code is not valid. Wait for the next one.' });
        setCode('');
      } else if (isApiError(err) && err.code === 'MFA_NOT_ENABLED') {
        refreshMfaState();
        close(false);
      } else setErrors({ form: messageFor(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        size={codes ? 'lg' : 'md'}
        hideClose={locked}
        onEscapeKeyDown={(event) => locked && event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        {codes ? (
          <>
            <DialogHeader icon={<KeyRound />} title="Your new recovery codes" description="The old codes no longer work." />
            <DialogBody>
              <RecoveryCodesPanel codes={codes} email={me?.email} acknowledged={acknowledged} onAcknowledgedChange={setAcknowledged} />
            </DialogBody>
            <DialogFooter>
              <Button disabled={!acknowledged} onClick={() => close(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="contents">
            <DialogHeader
              icon={<RefreshCw />}
              title="Generate new recovery codes"
              description="You'll get 10 new codes, and every existing code stops working."
            />
            <DialogBody className="grid gap-4">
              <Field label="Password" error={errors.password}>
                <PasswordInput autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <Field label="Authenticator code" error={errors.code} hint="Recovery codes can't be used here.">
                <OtpInput value={code} onChange={setCode} />
              </Field>
              <RateLimitNotice until={rateLimit.until} onDone={rateLimit.clear} />
              <FormError message={errors.form} />
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={submitting} disabled={!!rateLimit.until}>
                Generate codes
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Disable ─────────────────────────────────────────────────────────────────

/** Turn off two-step verification (spec §7.13, E19). */
export function DisableMfaDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [errors, setErrors] = useState<{ password?: string; code?: string; form?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const rateLimit = useRateLimit();

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      window.setTimeout(() => {
        setPassword('');
        setCode('');
        setRecoveryCode('');
        setMode('totp');
        setErrors({});
      }, 200);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: typeof errors = {};
    if (!password) nextErrors.password = 'Enter your password.';
    if (mode === 'totp' && !TOTP_PATTERN.test(code)) nextErrors.code = 'Enter the 6-digit code from your app.';
    if (mode === 'recovery' && !recoveryCode.trim()) nextErrors.code = 'Enter a recovery code.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSubmitting(true);
    try {
      await authApi.mfaDisable(
        mode === 'totp' ? { password, code: normaliseTotp(code) } : { password, recoveryCode: recoveryCode.trim() },
      );
      refreshMfaState();
      toast.success('Two-step verification is off', {
        description: 'You can turn it back on at any time.',
      });
      close(false);
    } catch (err) {
      if (rateLimit.catch(err)) return;
      if (isApiError(err) && err.code === 'AUTH_PASSWORD_MISMATCH') setErrors({ password: 'That password is incorrect.' });
      else if (isApiError(err) && err.code === 'MFA_CODE_INVALID') {
        setErrors({ code: mode === 'totp' ? 'That code is not valid.' : 'That recovery code is not valid.' });
        setCode('');
      } else if (isApiError(err) && err.code === 'MFA_NOT_ENABLED') {
        refreshMfaState();
        close(false);
      } else setErrors({ form: messageFor(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="md">
        <form onSubmit={submit} noValidate className="contents">
          <DialogHeader
            icon={<ShieldOff />}
            title="Turn off two-step verification"
            description="Your account will be protected by your password alone."
          />
          <DialogBody className="grid gap-4">
            <Callout tone="warning">
              Workspaces that require two-step verification will stop letting you in until you turn it back on.
            </Callout>
            <Field label="Password" error={errors.password}>
              <PasswordInput autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {mode === 'totp' ? (
              <Field label="Authenticator code" error={errors.code}>
                <OtpInput value={code} onChange={setCode} />
              </Field>
            ) : (
              <Field label="Recovery code" error={errors.code}>
                <Input
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value)}
                  placeholder="xxxxx-xxxxx"
                  maxLength={32}
                  autoComplete="off"
                  spellCheck={false}
                  inputClassName="font-mono tracking-wider"
                />
              </Field>
            )}
            <button
              type="button"
              className="-mt-1 w-fit rounded-sm text-[13px] font-medium text-brand-700 hover:underline hover:underline-offset-4"
              onClick={() => {
                setMode((current) => (current === 'totp' ? 'recovery' : 'totp'));
                setErrors((current) => ({ ...current, code: undefined }));
              }}
            >
              {mode === 'totp' ? 'Use a recovery code instead' : 'Use your authenticator app'}
            </button>
            <RateLimitNotice until={rateLimit.until} onDone={rateLimit.clear} />
            <FormError message={errors.form} />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={submitting} disabled={!!rateLimit.until}>
              Turn off
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
