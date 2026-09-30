import { useQuery } from '@tanstack/react-query';
import { Ban, Compass, Globe, LayoutGrid, RefreshCw, ShieldAlert, UserX } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Logo } from '@/components/brand/logo';
import { RequestReference } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import type { ApiError } from '@/lib/api/errors';
import type { MembershipSummary } from '@/lib/api/types';
import { signOut } from '@/lib/auth/session';
import { APP_NAME } from '@/lib/env';
import { useDocumentTitle } from '@/lib/hooks';
import { mfaQuery } from '@/lib/queries';
import { TopBar } from '@/features/shell/top-bar';

type Props =
  | { kind: 'not-found'; slug: string; error?: undefined; summary?: undefined; onRetry?: undefined; retrying?: undefined }
  | { kind?: undefined; error: ApiError; summary: MembershipSummary; onRetry: () => void; retrying?: boolean; slug?: undefined };

/**
 * The states the workspace gate renders instead of the shell (spec §7.11), in a
 * minimal frame with the user menu so the user can always get elsewhere.
 */
export function WorkspaceAccessState(props: Props) {
  const code = props.kind === 'not-found' ? 'ORGANIZATION_NOT_FOUND' : props.error.code;
  const reason = typeof props.error?.details?.reason === 'string' ? props.error.details.reason : null;
  const workspaceName = props.summary?.organizationName ?? 'This workspace';
  useDocumentTitle('Workspace unavailable');

  const retryButton =
    props.onRetry && code !== 'ORGANIZATION_NOT_FOUND' ? (
      <Button variant="ghost" onClick={props.onRetry} loading={props.retrying}>
        {props.retrying ? null : <RefreshCw />}
        Try again
      </Button>
    ) : null;

  let content: ReactNode;
  switch (code) {
    case 'ORGANIZATION_SUSPENDED':
      content = (
        <StateBody icon={<Ban />} tone="danger" title="This workspace is suspended">
          {workspaceName} has been suspended by the platform, so its agents, documents and workflows are unavailable.
          {reason ? <Reason>{reason}</Reason> : null}
        </StateBody>
      );
      break;
    case 'MEMBERSHIP_SUSPENDED':
      content = (
        <StateBody icon={<UserX />} tone="danger" title="Your access to this workspace is suspended">
          An administrator of {workspaceName} suspended your membership. Your other workspaces are not affected.
          {reason ? <Reason>{reason}</Reason> : null}
        </StateBody>
      );
      break;
    case 'IP_NOT_ALLOWED':
      content = (
        <StateBody icon={<Globe />} tone="warning" title="Your network isn't allowed">
          This workspace only accepts connections from approved networks. Connect through your organisation's network
          or VPN, or contact your administrator.
        </StateBody>
      );
      break;
    case 'MFA_REQUIRED':
      content = (
        <MfaRequired
          workspaceName={workspaceName}
          slug={props.summary?.organizationSlug ?? ''}
          requiredBy={props.error?.details?.requiredBy}
          retry={retryButton}
        />
      );
      break;
    default:
      content = (
        <StateBody icon={<Compass />} tone="neutral" title="Workspace not found">
          {props.kind === 'not-found' ? (
            <>
              There's no workspace at <span className="rounded bg-well px-1.5 py-0.5 font-mono text-[12px] text-ink-soft">/w/{props.slug}</span>,
              or you don't have access to it.
            </>
          ) : (
            "It doesn't exist or you don't have access."
          )}
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
      <main className="flex flex-1 items-center justify-center px-5 py-12">
        <div className="w-full max-w-md animate-rise">
          <div className="rounded-xl border border-line bg-surface p-7 shadow-card">
            {content}
            {code === 'MFA_REQUIRED' ? null : (
              <div className="mt-6 flex flex-wrap gap-2">
                <Button asChild>
                  <Link to="/workspaces">
                    <LayoutGrid />
                    Your workspaces
                  </Link>
                </Button>
                {retryButton}
              </div>
            )}
          </div>
          <div className="mt-3 flex justify-center">
            <RequestReference requestId={props.error?.requestId} />
          </div>
        </div>
      </main>
    </div>
  );
}

function MfaRequired({
  workspaceName,
  slug,
  requiredBy,
  retry,
}: {
  workspaceName: string;
  slug: string;
  requiredBy: unknown;
  retry: ReactNode;
}) {
  const mfa = useQuery(mfaQuery);
  const next = `/w/${slug}`;
  const byPlatform = requiredBy === 'platform';

  const needsFreshSignIn = !!mfa.data?.enabled && !mfa.data.sessionVerified;

  return (
    <>
      <StateBody icon={<ShieldAlert />} tone="warning" title="Two-step verification required">
        {byPlatform
          ? `${APP_NAME} requires two-step verification for every account.`
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
            <Link to={`/account/security?next=${encodeURIComponent(next)}`}>Set up two-step verification</Link>
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
