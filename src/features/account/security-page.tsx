import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, KeyRound, LogOut, RefreshCw, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ErrorState, PageHeader } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogHeader } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/misc';
import { authApi } from '@/lib/api/endpoints';
import { safeNext } from '@/lib/auth/landing';
import { endSessionLocally } from '@/lib/auth/session';
import { useDocumentTitle } from '@/lib/hooks';
import { meQuery, mfaQuery } from '@/lib/queries';
import { toastError } from '@/lib/toast';
import { cn, formatDate, pluralize } from '@/lib/utils';
import { ChangePasswordDialog } from './change-password-dialog';
import { DevicesCard } from './devices-card';
import { DisableMfaDialog, EnableMfaDialog, RegenerateCodesDialog } from './mfa-dialogs';

/** Account → Security (spec §7.13). */
export function SecurityPage() {
  useDocumentTitle('Security');
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const mfa = useQuery(mfaQuery);
  const { data: me } = useQuery(meQuery);
  const nextWorkspace = next?.startsWith('/w/')
    ? me?.memberships.find((membership) => membership.organizationSlug === next.split('/')[2])
    : undefined;

  return (
    <div className="grid gap-6">
      <PageHeader title="Security" description="Your password, two-step verification and the devices signed in to your account." />

      {next && mfa.data ? (
        mfa.data.enabled ? (
          <Callout
            tone="success"
            title="You're all set"
            action={
              <Button asChild size="sm">
                <Link to={next}>
                  Continue to {nextWorkspace?.organizationName ?? 'your workspace'}
                  <ArrowRight />
                </Link>
              </Button>
            }
          >
            Two-step verification is on for this session.
          </Callout>
        ) : (
          <Callout tone="warning" title={`${nextWorkspace?.organizationName ?? 'Your workspace'} requires two-step verification`}>
            Turn it on below, then continue where you left off.
          </Callout>
        )
      ) : null}

      <PasswordCard />
      <TwoStepCard />
      <DevicesCard />
      <SignOutEverywhereCard />
    </div>
  );
}

function PasswordCard() {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader
        icon={<KeyRound />}
        title="Password"
        description="Use at least 12 characters. Changing it signs out your other devices."
        actions={
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            Change password
          </Button>
        }
      />
      <ChangePasswordDialog open={open} onOpenChange={setOpen} />
    </Card>
  );
}

function TwoStepCard() {
  const mfa = useQuery(mfaQuery);
  const [dialog, setDialog] = useState<'enable' | 'regenerate' | 'disable' | null>(null);

  const status = mfa.data;
  const lowCodes = !!status?.enabled && status.recoveryCodesRemaining <= 3;

  return (
    <Card>
      <CardHeader
        icon={<Smartphone />}
        title="Two-step verification"
        description="A code from an authenticator app on top of your password."
        actions={
          status ? (
            status.enabled ? (
              <Badge tone="brand" dot>
                On
              </Badge>
            ) : (
              <Badge tone="neutral" dot>
                Off
              </Badge>
            )
          ) : null
        }
      />
      <CardBody>
        {mfa.isPending ? (
          <div className="grid gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-9 w-28" />
          </div>
        ) : mfa.isError ? (
          <ErrorState compact error={mfa.error} onRetry={() => void mfa.refetch()} retrying={mfa.isFetching} />
        ) : !status?.enabled ? (
          <div className="flex flex-col gap-4 rounded-lg border border-dashed border-line-strong bg-well/40 p-4 sm:flex-row sm:items-center">
            <p className="flex-1 text-[13px] leading-relaxed text-muted">
              Protect your account with an authenticator app. Even if your password leaks, nobody gets in without your
              phone. Some workspaces require it.
            </p>
            <Button onClick={() => setDialog('enable')}>
              <ShieldCheck />
              Enable
            </Button>
          </div>
        ) : (
          <div className="grid gap-4">
            <dl className="grid gap-3 sm:grid-cols-3">
              <Stat label="Enabled on">{formatDate(status.enrolledAt)}</Stat>
              <Stat label="Recovery codes" tone={lowCodes ? 'warning' : undefined}>
                {pluralize(status.recoveryCodesRemaining, 'code')} left
              </Stat>
              <Stat label="This session">
                {status.sessionVerified ? (
                  <span className="text-brand-700">Verified with a code</span>
                ) : (
                  <span className="text-warning-700">Not verified</span>
                )}
              </Stat>
            </dl>
            {lowCodes ? (
              <Callout tone="warning">
                {status.recoveryCodesRemaining === 0
                  ? "You've used all your recovery codes."
                  : `Only ${pluralize(status.recoveryCodesRemaining, 'recovery code')} left.`}{' '}
                Generate new ones so you can still get in if you lose your phone.
              </Callout>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setDialog('regenerate')}>
                <RefreshCw />
                Generate new recovery codes
              </Button>
              <Button variant="danger-outline" size="sm" onClick={() => setDialog('disable')}>
                <ShieldOff />
                Disable
              </Button>
            </div>
          </div>
        )}
      </CardBody>

      <EnableMfaDialog open={dialog === 'enable'} onOpenChange={(open) => setDialog(open ? 'enable' : null)} />
      <RegenerateCodesDialog open={dialog === 'regenerate'} onOpenChange={(open) => setDialog(open ? 'regenerate' : null)} />
      <DisableMfaDialog open={dialog === 'disable'} onOpenChange={(open) => setDialog(open ? 'disable' : null)} />
    </Card>
  );
}

function Stat({ label, children, tone }: { label: string; children: React.ReactNode; tone?: 'warning' }) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3.5 py-3',
        tone === 'warning' ? 'border-warning-200 bg-warning-50' : 'border-line bg-well/40',
      )}
    >
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn('mt-1 text-[13.5px] font-medium', tone === 'warning' ? 'text-warning-700' : 'text-ink')}>{children}</dd>
    </div>
  );
}

function SignOutEverywhereCard() {
  const [open, setOpen] = useState(false);
  const logoutAll = useMutation({
    mutationFn: () => authApi.logoutAll(),
    // Every session, including this one, is revoked: clean up locally.
    onSuccess: () => endSessionLocally('signed-out-everywhere'),
    onError: (error) => toastError(error, "Couldn't sign out everywhere"),
  });

  return (
    <Card className="border-danger-200/70">
      <CardHeader
        icon={<LogOut />}
        title="Sign out everywhere"
        description="Sign out of all devices, including this one. Use it if you think someone else has access."
        actions={
          <Button variant="danger-outline" size="sm" onClick={() => setOpen(true)}>
            Sign out everywhere
          </Button>
        }
      />
      <AlertDialog open={open} onOpenChange={(value) => !logoutAll.isPending && setOpen(value)}>
        <AlertDialogContent>
          <AlertDialogHeader
            icon={<LogOut />}
            tone="danger"
            title="Sign out of every device?"
            description="Every browser and app signed in to your account, including this one, is signed out immediately."
          />
          <div className="flex flex-col-reverse gap-2 border-t border-line bg-well/40 px-6 py-3.5 sm:flex-row sm:justify-end">
            <AlertDialogCancel asChild>
              <Button variant="ghost" disabled={logoutAll.isPending}>
                Cancel
              </Button>
            </AlertDialogCancel>
            <Button variant="danger" loading={logoutAll.isPending} onClick={() => logoutAll.mutate()}>
              Sign out everywhere
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
