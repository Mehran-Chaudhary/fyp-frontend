import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Ban,
  CalendarClock,
  CircleCheck,
  Clock,
  Link2Off,
  LogOut,
  MailOpen,
  ShieldAlert,
  UserX,
  Users,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { RequestReference } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { WorkspaceTile } from '@/components/ui/misc';
import { Spinner } from '@/components/ui/spinner';
import { invitationsApi } from '@/lib/api/endpoints';
import { isApiError } from '@/lib/api/errors';
import type { CurrentUser, InvitationPreview } from '@/lib/api/types';
import { signInPath } from '@/lib/auth/landing';
import { signOut, useSession } from '@/lib/auth/session';
import { messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { invitationPreviewQuery, meQuery, queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast } from '@/lib/toast';
import { formatDateTime, formatRelative } from '@/lib/utils';
import { maskEmail } from '@/lib/workspace/mask-email';
import { AuthCard } from '@/features/auth/auth-layout';

/**
 * The invitation link the backend emails (spec §5.4). A public page: it previews
 * the invitation signed in or out, routes a signed-out visitor through sign-up or
 * sign-in and back, and accepts only when the button is clicked.
 */
export function AcceptInvitationPage() {
  useDocumentTitle('Invitation');
  const [params] = useSearchParams();
  const token = params.get('token')?.trim() ?? '';

  if (!token) {
    return (
      <Problem
        icon={<Link2Off />}
        title="This invitation link is incomplete"
        body="The link is missing its code. Open the invitation email again and use the button in it, or copy the whole link."
      />
    );
  }
  return <Invitation token={token} />;
}

function Invitation({ token }: { token: string }) {
  const location = useLocation();
  const status = useSession((state) => state.status);
  const signedIn = status === 'authenticated';
  // One preview per page load (it shares the per-IP auth throttle). The query
  // dedupes StrictMode's double mount; retries and refocus refetches are off.
  const preview = useQuery(invitationPreviewQuery(token));
  const me = useQuery({ ...meQuery, enabled: signedIn });
  const here = `${location.pathname}${location.search}`;

  if (preview.isPending || status === 'restoring' || (signedIn && me.isPending)) {
    return (
      <AuthCard>
        <div className="flex flex-col items-center py-8 text-center">
          <Spinner className="size-6 text-brand-600" />
          <p className="mt-4 text-sm font-medium text-ink">Opening your invitation…</p>
        </div>
      </AuthCard>
    );
  }

  if (preview.isError) {
    return <InvitationError error={preview.error} preview={null} me={me.data} here={here} />;
  }

  return (
    <PreviewCard
      token={token}
      preview={preview.data}
      fetchedAt={preview.dataUpdatedAt}
      me={signedIn ? me.data : undefined}
      here={here}
    />
  );
}

function PreviewCard({
  token,
  preview,
  fetchedAt,
  me,
  here,
}: {
  token: string;
  preview: InvitationPreview;
  /** When the preview was loaded; "expires soon" is judged against it. */
  fetchedAt: number;
  me: CurrentUser | undefined;
  here: string;
}) {
  const navigate = useNavigate();
  const [switching, setSwitching] = useState(false);
  const mismatch = me ? maskEmail(me.email.toLowerCase()) !== preview.email : false;

  const accept = useMutation({
    mutationFn: () => invitationsApi.accept(token),
    onSuccess: async (result) => {
      // Load the new membership first so the workspace gate finds it at once.
      await Promise.all([
        queryClient.refetchQueries({ queryKey: queryKeys.me }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaces }),
      ]);
      queryClient.removeQueries({ queryKey: queryKeys.invitationPreview(token) });
      toast.success(`Welcome to ${preview.organizationName}`, { description: `You joined as ${preview.roleName}.` });
      navigate(`/w/${result.organizationSlug}`, { replace: true });
    },
  });

  const switchAccount = async () => {
    setSwitching(true);
    await signOut('quiet');
    navigate(signInPath({ next: here }), { replace: true });
  };

  if (accept.isError) {
    return <InvitationError error={accept.error} preview={preview} me={me} here={here} onSwitch={switchAccount} switching={switching} />;
  }

  const expiresSoon = Date.parse(preview.expiresAt) - fetchedAt < 24 * 60 * 60 * 1000;

  return (
    <AuthCard className="overflow-hidden p-0 sm:p-0">
      <div className="px-6 pt-6 sm:px-7 sm:pt-7">
        <div className="flex items-center gap-3">
          <WorkspaceTile name={preview.organizationName} seed={preview.organizationSlug} size="lg" />
          <div className="min-w-0">
            <p className="text-[11px] font-medium tracking-[0.08em] text-faint uppercase">Workspace invitation</p>
            <p className="truncate text-[15px] font-semibold text-ink">{preview.organizationName}</p>
          </div>
        </div>
        <h1 className="mt-6 text-[20px] leading-snug font-semibold tracking-[-0.01em] text-ink">
          <span className="text-brand-700">{preview.inviterName}</span> invited you to join{' '}
          <span className="whitespace-nowrap">{preview.organizationName}</span> as{' '}
          <span className="whitespace-nowrap">{preview.roleName}</span>.
        </h1>
        <dl className="mt-5 grid gap-2.5 text-[13px]">
          <Fact icon={<MailOpen />} label="Sent to">
            <span className="font-mono text-[12.5px] text-ink-soft">{preview.email}</span>
          </Fact>
          <Fact icon={<Clock />} label="Expires">
            <span className={expiresSoon ? 'font-medium text-warning-700' : 'text-ink-soft'} title={formatDateTime(preview.expiresAt)}>
              {formatRelative(preview.expiresAt)}
            </span>
          </Fact>
          <Fact icon={<Users />} label="Role">
            <span className="text-ink-soft">{preview.roleName}</span>
          </Fact>
        </dl>
      </div>

      <div className="mt-6 grid gap-3 border-t border-line bg-well/40 px-6 py-5 sm:px-7">
        {me ? (
          <>
            <p className="text-[13px] text-muted">
              Signed in as <span className="font-medium text-ink">{me.email}</span>
            </p>
            {mismatch ? (
              <Callout tone="warning" title="This invitation was sent to another address">
                It was sent to <span className="font-mono">{preview.email}</span>, but you're signed in as {me.email}. Sign in
                with the address it was sent to.
              </Callout>
            ) : null}
            <Button size="lg" className="w-full" loading={accept.isPending} onClick={() => accept.mutate()}>
              Accept invitation
              {accept.isPending ? null : <ArrowRight />}
            </Button>
            {mismatch ? (
              <Button variant="secondary" className="w-full" loading={switching} onClick={() => void switchAccount()}>
                {switching ? null : <LogOut />}
                Sign out and switch account
              </Button>
            ) : null}
          </>
        ) : preview.requiresRegistration ? (
          <>
            <Button asChild size="lg" className="w-full">
              <Link to={`/auth/sign-up?next=${encodeURIComponent(here)}&hint=${encodeURIComponent(preview.email)}`}>
                Create account
                <ArrowRight />
              </Link>
            </Button>
            <p className="text-center text-[13px] text-muted">
              <Link to={signInPath({ next: here })} className="font-medium text-brand-700 underline decoration-brand-200 underline-offset-4 hover:decoration-brand-500">
                I already have an account
              </Link>
            </p>
          </>
        ) : (
          <>
            <Button asChild size="lg" className="w-full">
              <Link to={signInPath({ next: here })}>
                Sign in to accept
                <ArrowRight />
              </Link>
            </Button>
            <p className="text-center text-xs text-muted">Use the account for {preview.email}.</p>
          </>
        )}
      </div>
    </AuthCard>
  );
}

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-faint [&_svg]:size-3.5" aria-hidden>
        {icon}
      </span>
      <dt className="w-16 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  );
}

// ── Errors (spec §5.4 table) ────────────────────────────────────────────────

function InvitationError({
  error,
  preview,
  me,
  here,
  onSwitch,
  switching,
}: {
  error: unknown;
  preview: InvitationPreview | null;
  me: CurrentUser | undefined;
  here: string;
  onSwitch?: () => void;
  switching?: boolean;
}) {
  const code = isApiError(error) ? error.code : null;
  const workspaceName = preview?.organizationName ?? 'this workspace';
  const membership = preview ? me?.memberships.find((item) => item.organizationSlug === preview.organizationSlug) : undefined;
  const requestId = isApiError(error) ? error.requestId : undefined;

  const goToWorkspace = membership ? (
    <Button asChild>
      <Link to={`/w/${membership.organizationSlug}`}>
        Go to {membership.organizationName}
        <ArrowRight />
      </Link>
    </Button>
  ) : null;

  switch (code) {
    case 'INVITATION_NOT_FOUND':
      return (
        <Problem
          icon={<Link2Off />}
          title="This invitation link isn't valid"
          body="It may have been replaced by a newer invitation or revoked. Check your inbox for the latest email, or ask the person who invited you."
          requestId={requestId}
        />
      );
    case 'INVITATION_EXPIRED':
      return (
        <Problem
          icon={<CalendarClock />}
          tone="warning"
          title="This invitation has expired"
          body={`Ask ${preview?.inviterName ?? 'the person who invited you'} to resend it. A resent invitation comes with a new link.`}
          requestId={requestId}
        />
      );
    case 'INVITATION_REVOKED':
      return <Problem icon={<Ban />} title="This invitation was withdrawn" body="Ask the person who invited you if you should still join." requestId={requestId} />;
    case 'INVITATION_ALREADY_ACCEPTED':
      return (
        <Problem
          icon={<CircleCheck />}
          tone="success"
          title="This invitation has already been used"
          body={membership ? `You're a member of ${membership.organizationName}.` : 'Each invitation link works once.'}
          action={goToWorkspace}
          requestId={requestId}
        />
      );
    case 'INVITATION_EMAIL_MISMATCH':
      // A 401 that is not about the session: stay signed in, offer to switch.
      return (
        <Problem
          icon={<ShieldAlert />}
          tone="warning"
          title="This invitation belongs to another email address"
          body={
            <>
              {preview ? (
                <>
                  It was sent to <span className="font-mono">{preview.email}</span>
                  {me ? <>, and you're signed in as {me.email}</> : null}.{' '}
                </>
              ) : null}
              Sign in with the address it was sent to.
            </>
          }
          action={
            onSwitch ? (
              <Button loading={switching} onClick={onSwitch}>
                {switching ? null : <LogOut />}
                Sign out and switch account
              </Button>
            ) : (
              <Button asChild>
                <Link to={signInPath({ next: here })}>Sign in</Link>
              </Button>
            )
          }
          requestId={requestId}
        />
      );
    case 'MEMBERSHIP_ALREADY_EXISTS':
      return (
        <Problem
          icon={<CircleCheck />}
          tone="success"
          title={`You're already a member of ${workspaceName}`}
          body="There's nothing to accept."
          action={
            preview ? (
              <Button asChild>
                <Link to={`/w/${preview.organizationSlug}`}>
                  Go to {preview.organizationName}
                  <ArrowRight />
                </Link>
              </Button>
            ) : null
          }
          requestId={requestId}
        />
      );
    case 'MEMBERSHIP_SUSPENDED':
      return (
        <Problem
          icon={<UserX />}
          tone="danger"
          title={`Your membership of ${workspaceName} is suspended`}
          body="An invitation can't lift a suspension. Ask an administrator of the workspace to reactivate you."
          requestId={requestId}
        />
      );
    case 'AUTH_TOKEN_MISSING':
      return (
        <Problem
          icon={<ShieldAlert />}
          tone="warning"
          title="Please sign in again"
          body="Your session ended before the invitation could be accepted."
          action={
            <Button asChild>
              <Link to={signInPath({ next: here })}>Sign in</Link>
            </Button>
          }
        />
      );
    case 'RATE_LIMIT_EXCEEDED':
      return (
        <Problem
          icon={<Clock />}
          tone="warning"
          title="Too many attempts from this network"
          body={messageFor(error)}
          action={
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Try again
            </Button>
          }
          requestId={requestId}
        />
      );
    default:
      return (
        <Problem
          icon={<ShieldAlert />}
          tone="danger"
          title="We couldn't open this invitation"
          body={messageFor(error)}
          action={
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Try again
            </Button>
          }
          requestId={requestId}
        />
      );
  }
}

const toneClass = {
  neutral: 'border-line bg-well text-ink-soft',
  warning: 'border-warning-200 bg-warning-50 text-warning-600',
  danger: 'border-danger-200 bg-danger-50 text-danger-600',
  success: 'border-brand-200 bg-brand-50 text-brand-700',
};

function Problem({
  icon,
  title,
  body,
  action,
  tone = 'neutral',
  requestId,
}: {
  icon: ReactNode;
  title: string;
  body: ReactNode;
  action?: ReactNode;
  tone?: keyof typeof toneClass;
  requestId?: string;
}) {
  const status = useSession((state) => state.status);
  return (
    <AuthCard>
      <span className={`inline-flex size-10 items-center justify-center rounded-xl border [&_svg]:size-5 ${toneClass[tone]}`}>
        {icon}
      </span>
      <h1 className="mt-5 text-[20px] leading-snug font-semibold tracking-[-0.01em] text-ink">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
      <div className="mt-6 flex flex-wrap gap-2">
        {action}
        <Button asChild variant={action ? 'ghost' : 'secondary'}>
          <Link to={status === 'authenticated' ? '/' : '/auth/sign-in'}>Go to AgentVault</Link>
        </Button>
      </div>
      {requestId ? (
        <div className="mt-4">
          <RequestReference requestId={requestId} />
        </div>
      ) : null}
    </AuthCard>
  );
}
