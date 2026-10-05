import { useQuery } from '@tanstack/react-query';
import { Ban, Compass, Globe, LayoutGrid, MailWarning, RefreshCw, ShieldAlert, UserRound, UserX } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Logo } from '@/components/brand/logo';
import { RequestReference } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import type { ApiError } from '@/lib/api/errors';
import { signOut } from '@/lib/auth/session';
import { APP_NAME } from '@/lib/env';
import { useDocumentTitle } from '@/lib/hooks';
import { meQuery, mfaQuery } from '@/lib/queries';
import { ResendVerification } from '@/features/auth/resend-verification';
import { TopBar } from '@/features/shell/top-bar';

/**
 * What the workspace gate renders when a workspace refuses entry (Phase 1 spec
 * §11). Every state keeps the way out: the workspace picker, account settings,
 * and sign-out in the user menu. The global account is never signed out for a
 * workspace's policy.
 */
export function WorkspaceAccessState({
  error,
  workspaceName,
  reference,
  onRetry,
  retrying,
}: {
  error: ApiError;
  /** Known when the workspace is among the embedded memberships. */
  workspaceName: string | null;
  /** The slug or id from the address, for the not-found message. */
  reference: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const code = error.code;
  const reason = typeof error.details?.reason === 'string' ? error.details.reason : null;
  const name = workspaceName ?? 'This workspace';
  const nameInSentence = workspaceName ?? 'this workspace';
  useDocumentTitle('Workspace unavailable');

  const retryButton = onRetry ? (
    <Button variant="ghost" onClick={onRetry} loading={retrying}>
      {retrying ? null : <RefreshCw />}
      Check again
    </Button>
  ) : null;

  let content: ReactNode;
  let actions: ReactNode = null;
  switch (code) {
    case 'ORGANIZATION_SUSPENDED':
      content = (
        <StateBody icon={<Ban />} tone="danger" title="This workspace is suspended">
          {name} has been suspended, so its agents, documents and workflows are unavailable. Your account and your
          other workspaces are not affected.
          {reason ? <Reason>{reason}</Reason> : null}
        </StateBody>
      );
      break;
    case 'MEMBERSHIP_SUSPENDED':
      content = (
        <StateBody icon={<UserX />} tone="danger" title="Your access to this workspace is suspended">
          An administrator of {nameInSentence} suspended your membership. Your other workspaces are not affected.
          {reason ? <Reason>{reason}</Reason> : null}
        </StateBody>
      );
      break;
    case 'IP_NOT_ALLOWED':
      content = (
        <StateBody icon={<Globe />} tone="warning" title="Your network isn't allowed here">
          {name} only accepts connections from approved networks. Connect through your organisation's network or VPN,
          or ask an administrator to allow this one.
        </StateBody>
      );
      break;
    case 'ACCOUNT_EMAIL_NOT_VERIFIED':
      content = (
        <StateBody icon={<MailWarning />} tone="warning" title="This workspace requires a verified email">
          Open the verification link we emailed you, then check again. Your other workspaces are not affected.
        </StateBody>
      );
      actions = <VerifyEmailAction />;
      break;
    case 'MFA_REQUIRED':
      content = (
        <MfaRequiredBody
          workspaceName={name}
          reference={reference}
          requiredBy={error.details?.requiredBy}
          retry={retryButton}
        />
      );
      break;
    default:
      content = (
        <StateBody icon={<Compass />} tone="neutral" title="Workspace unavailable">
          There's no workspace at{' '}
          <span className="rounded bg-well px-1.5 py-0.5 font-mono text-[12px] break-all text-ink-soft">/w/{reference}</span>{' '}
          that you can open. It may have been deleted, or you may no longer be a member.
        </StateBody>
      );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <TopBar>
        <Link to="/workspaces" className="rounded-md">
          <Logo />
        </Link>
      </TopBar>
      <main className="flex flex-1 items-center justify-center px-4 py-12 sm:px-5">
        <div className="w-full max-w-md animate-rise">
          <div className="rounded-xl border border-line bg-surface p-6 shadow-card sm:p-7">
            {content}
            {code === 'MFA_REQUIRED' ? null : (
              <>
                {actions ? <div className="mt-5">{actions}</div> : null}
                <div className="mt-6 flex flex-wrap gap-2">
                  <Button asChild>
                    <Link to="/workspaces">
                      <LayoutGrid />
                      Your workspaces
                    </Link>
                  </Button>
                  {code === 'ORGANIZATION_NOT_FOUND' ? null : retryButton}
                </div>
              </>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[13px]">
            <Link to="/account/profile" className="inline-flex items-center gap-1.5 rounded text-muted hover:text-ink">
              <UserRound className="size-3.5" aria-hidden />
              Account settings
            </Link>
            <RequestReference requestId={error.requestId} />
          </div>
        </div>
      </main>
    </div>
  );
}

function VerifyEmailAction() {
  const { data: me } = useQuery(meQuery);
  return <ResendVerification email={me?.email} variant="secondary" size="md" />;
}

function MfaRequiredBody({
  workspaceName,
  reference,
  requiredBy,
  retry,
}: {
  workspaceName: string;
  reference: string;
  requiredBy: unknown;
  retry: ReactNode;
}) {
  const mfa = useQuery(mfaQuery);
  const next = `/w/${reference}`;
  const byPlatform = requiredBy === 'platform';
  // MFA is on for the account, but this session signed in without a code: there is
  // no step-up endpoint, so the only way to a verified session is a fresh sign-in.
  const needsFreshSignIn = !!mfa.data?.enabled && !mfa.data.sessionVerified;

  return (
    <>
      <StateBody icon={<ShieldAlert />} tone="warning" title="Two-step verification required">
        {byPlatform
          ? `${APP_NAME} requires two-step verification for platform administrators.`
          : `${workspaceName} requires two-step verification.`}{' '}
        {mfa.isPending
          ? null
          : needsFreshSignIn
            ? 'Your account has it turned on, but this session was signed in without a code. Sign in again and enter a code from your authenticator app.'
            : 'Set it up with an authenticator app to continue; it takes about a minute.'}
      </StateBody>
      <div className="mt-6 flex flex-wrap gap-2">
        {mfa.isPending ? (
          <Skeleton className="h-9 w-56" />
        ) : needsFreshSignIn ? (
          <Button onClick={() => void signOut('quiet')}>Sign in again</Button>
        ) : (
          <Button asChild>
            <Link to={`/account/security?next=${encodeURIComponent(next)}#two-step`}>Set up two-step verification</Link>
          </Button>
        )}
        <Button asChild variant="secondary">
          <Link to="/workspaces">Your workspaces</Link>
        </Button>
        {retry}
      </div>
    </>
  );
}

const toneClass = {
  neutral: 'border-line bg-well text-ink-soft',
  danger: 'border-danger-200 bg-danger-50 text-danger-600',
  warning: 'border-warning-200 bg-warning-50 text-warning-600',
};

function StateBody({
  icon,
  tone,
  title,
  children,
}: {
  icon: ReactNode;
  tone: keyof typeof toneClass;
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <span className={`inline-flex size-10 items-center justify-center rounded-xl border [&_svg]:size-5 ${toneClass[tone]}`}>
        {icon}
      </span>
      <h1 className="mt-5 text-lg leading-snug font-semibold text-ink">{title}</h1>
      <div className="mt-1.5 text-sm leading-relaxed text-muted">{children}</div>
    </>
  );
}

function Reason({ children }: { children: ReactNode }) {
  return (
    <span className="mt-3 block rounded-lg border border-line bg-well px-3 py-2 text-[13px] text-ink-soft">
      <span className="font-medium">Reason:</span> {children}
    </span>
  );
}
