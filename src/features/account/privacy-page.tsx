import { useQuery } from '@tanstack/react-query';
import { Download, FileJson, Trash2, TriangleAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { RateLimitNotice } from '@/components/feedback/global-states';
import { PageHeader } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { OtpInput } from '@/components/ui/otp-input';
import { PasswordInput } from '@/components/ui/password-input';
import { authApi } from '@/lib/api/endpoints';
import { isApiError } from '@/lib/api/errors';
import type { ErasureBlockedWorkspace } from '@/lib/api/types';
import { endSessionLocally, setFarewell } from '@/lib/auth/session';
import { messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { meQuery, mfaQuery } from '@/lib/queries';
import { toast, toastError } from '@/lib/toast';
import { downloadBlob, pluralize } from '@/lib/utils';
import { normaliseTotp, TOTP_PATTERN } from '@/lib/validation/schemas';

const CONFIRMATION = 'ERASE MY ACCOUNT';

/** Account → Privacy & data (spec §7.14). */
export function PrivacyPage() {
  useDocumentTitle('Privacy & data');
  const [erasureDisabled, setErasureDisabled] = useState(false);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Privacy & data"
        description="Your right to a copy of your data and to be forgotten, built into the platform."
      />
      <ExportCard />
      {erasureDisabled ? <Callout title="Self-service account erasure is disabled" tone="warning">Contact your deployment administrator to request account erasure.</Callout> : (
        <EraseCard
          onDisabled={() => {
            setErasureDisabled(true);
          }}
        />
      )}
    </div>
  );
}

function ExportCard() {
  const [downloading, setDownloading] = useState(false);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);

  const download = async () => {
    setDownloading(true);
    try {
      const { blob, filename } = await authApi.exportPersonalData();
      const exported = await blob.text().then(text => JSON.parse(text) as { truncated?: string[] }).catch(() => null);
      downloadBlob(filename ?? `personal-data-${new Date().toISOString().slice(0, 10)}.json`, blob);
      toast.success('Your data is downloading', { description: filename ?? undefined });
      if (exported?.truncated?.length) toast.warning('Some export categories reached the export limit', { description: exported.truncated.join(', ') });
    } catch (error) {
      if (isApiError(error) && error.code === 'RATE_LIMIT_EXCEEDED') {
        setRateLimitedUntil(error.retryDeadline());
      } else {
        toastError(error, "Couldn't prepare your data");
      }
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card>
      <CardHeader
        icon={<FileJson />}
        title="Download my data"
        description="A JSON copy of everything AgentVault holds about you, across every workspace."
      />
      <CardBody className="grid gap-4">
        <ul className="grid gap-x-6 gap-y-1.5 text-[13px] text-muted sm:grid-cols-2">
          {[
            'Profile and account status',
            'Workspace memberships',
            'Signed-in devices',
            'Your conversations and workflow runs',
            'API keys you issued',
            'Usage and activity',
          ].map((item) => (
            <li key={item} className="flex items-center gap-2">
              <span className="size-1 rounded-full bg-faint" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
        <RateLimitNotice
          until={rateLimitedUntil}
          message="Exports are limited to 5 per hour."
          onDone={() => setRateLimitedUntil(null)}
        />
        <div>
          <Button variant="secondary" loading={downloading} disabled={!!rateLimitedUntil} onClick={() => void download()}>
            {downloading ? null : <Download />}
            Download my data
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function EraseCard({ onDisabled }: { onDisabled: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="border-danger-200">
      <CardHeader
        icon={<Trash2 />}
        title="Erase my account"
        description="Permanently delete your identity and personal data. This cannot be undone."
      />
      <CardBody className="grid gap-4">
        <ul className="grid gap-1.5 text-[13px] leading-relaxed text-muted">
          <li>· Your conversations and workflow runs are crypto-shredded: the keys are destroyed, so nobody can read them.</li>
          <li>· API keys you issued are revoked and your workspace memberships end.</li>
          <li>· Your identity is anonymised in audit trails that must be kept.</li>
          <li>· Workspaces you own on your own are deleted.</li>
        </ul>
        <div>
          <Button variant="danger-outline" onClick={() => setOpen(true)}>
            <Trash2 />
            Erase my account…
          </Button>
        </div>
      </CardBody>
      <EraseDialog open={open} onOpenChange={setOpen} onDisabled={onDisabled} />
    </Card>
  );
}

function EraseDialog({
  open,
  onOpenChange,
  onDisabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDisabled: () => void;
}) {
  const mfa = useQuery({ ...mfaQuery, enabled: open });
  const { data: me } = useQuery(meQuery);
  const mfaEnabled = !!mfa.data?.enabled;
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errors, setErrors] = useState<{ password?: string; code?: string; form?: string }>({});
  const [blockedBy, setBlockedBy] = useState<ErasureBlockedWorkspace[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);

  const confirmed = confirmation === CONFIRMATION;

  const close = (next: boolean) => {
    if (submitting) return;
    onOpenChange(next);
    if (!next) {
      window.setTimeout(() => {
        setPassword('');
        setCode('');
        setRecoveryCode('');
        setConfirmation('');
        setErrors({});
        setBlockedBy(null);
        setMode('totp');
      }, 200);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed) return;
    const nextErrors: typeof errors = {};
    if (!password) nextErrors.password = 'Enter your password.';
    if (mfaEnabled && mode === 'totp' && !TOTP_PATTERN.test(code)) nextErrors.code = 'Enter the 6-digit code.';
    if (mfaEnabled && mode === 'recovery' && !recoveryCode.trim()) nextErrors.code = 'Enter a recovery code.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSubmitting(true);
    setBlockedBy(null);
    try {
      const outcome = await authApi.eraseAccount({
        password,
        confirmation: CONFIRMATION,
        ...(mfaEnabled ? (mode === 'totp' ? { code: normaliseTotp(code) } : { recoveryCode: recoveryCode.trim() }) : {}),
      });
      // Every session is gone server-side: clean up locally, then say goodbye
      // (the auth guard routes an erased session to /goodbye).
      setFarewell(outcome.workspacesDeleted.length);
      endSessionLocally('account-erased');
    } catch (error) {
      setSubmitting(false);
      if (!isApiError(error)) {
        setErrors({ form: messageFor(error) });
        return;
      }
      switch (error.code) {
        case 'ACCOUNT_ERASURE_BLOCKED':
          setBlockedBy(Array.isArray(error.details?.workspaces) ? (error.details.workspaces as ErasureBlockedWorkspace[]) : []);
          break;
        case 'ACCOUNT_ERASURE_DISABLED':
          toast.info('Account erasure is disabled', { description: 'This deployment does not allow self-service erasure.' });
          onOpenChange(false);
          onDisabled();
          break;
        case 'AUTH_PASSWORD_MISMATCH':
          setErrors({ password: 'That password is incorrect.' });
          break;
        case 'MFA_CODE_INVALID':
          setErrors({ code: 'That code is not valid.' });
          setCode('');
          break;
        case 'RATE_LIMIT_EXCEEDED':
          setRateLimitedUntil(error.retryDeadline());
          break;
        default:
          setErrors({ form: messageFor(error) });
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent size="md" onInteractOutside={(event) => event.preventDefault()}>
        <form onSubmit={submit} noValidate className="contents">
          <DialogHeader
            icon={<TriangleAlert />}
            title="Erase your account"
            description="This is permanent. There is no undo and no recovery, even by an administrator."
          />
          <DialogBody className="grid gap-4">
            {blockedBy ? (
              <Callout tone="danger" title="You own workspaces other people belong to">
                Transfer ownership or remove the other members first:
                <ul className="mt-2 grid gap-1">
                  {blockedBy.map((workspace) => {
                    const slug = me?.memberships.find((membership) => membership.organizationId === workspace.id)?.organizationSlug;
                    return (
                      <li key={workspace.id} className="font-medium">
                        {slug ? (
                          <Link to={`/w/${slug}/settings/danger`} className="underline underline-offset-2">
                            {workspace.name}
                          </Link>
                        ) : (
                          workspace.name
                        )}{' '}
                        <span className="font-normal opacity-80">({pluralize(workspace.otherMembers, 'other member')})</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 opacity-80">Transfer ownership from each workspace's Settings → Danger zone.</p>
              </Callout>
            ) : null}

            <Field label="Password" error={errors.password}>
              <PasswordInput autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>

            {mfaEnabled ? (
              <>
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
                  onClick={() => setMode((current) => (current === 'totp' ? 'recovery' : 'totp'))}
                >
                  {mode === 'totp' ? 'Use a recovery code instead' : 'Use your authenticator app'}
                </button>
              </>
            ) : null}

            <Field
              label={
                <>
                  Type <span className="font-mono text-danger-700">{CONFIRMATION}</span> to confirm
                </>
              }
            >
              <Input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="characters"
                inputClassName="font-mono"
                placeholder={CONFIRMATION}
              />
            </Field>

            <RateLimitNotice until={rateLimitedUntil} onDone={() => setRateLimitedUntil(null)} />
            <FormError message={errors.form} />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => close(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              loading={submitting}
              disabled={!confirmed || mfa.isPending || !!rateLimitedUntil}
            >
              Erase my account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
