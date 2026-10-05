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
  MailWarning,
  SearchCheck,
  ShieldAlert,
  UserX,
  Users,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { RateLimitNotice } from '@/components/feedback/global-states';
import { RequestReference } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { WorkspaceTile } from '@/components/ui/misc';
import { Spinner } from '@/components/ui/spinner';
import { invitationsApi } from '@/lib/api/endpoints';
import { isApiError, isOutcomeUnknown } from '@/lib/api/errors';
import type { CurrentUser, InvitationPreview, MembershipSummary } from '@/lib/api/types';
import { signInPath, workspaceHref } from '@/lib/auth/landing';
import { clearLinkToken, linkTokenFor, updateLinkMeta } from '@/lib/auth/link-tokens';
import { recheckEmailVerification, signOut, useSession } from '@/lib/auth/session';
import { messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { invitationPreviewQuery, meQuery, queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast } from '@/lib/toast';
import { formatDateTime, formatRelative } from '@/lib/utils';
import { maskEmail } from '@/lib/workspace/mask-email';
import { AuthCard } from '@/features/auth/auth-layout';
import { ResendVerification } from '@/features/auth/resend-verification';

/** Where sign-in and sign-up come back to: the token stays in this tab's flow storage, never in a URL. */
const HERE = '/invitations/accept';

/**
 * /invitations/accept — the link the backend emails (P1-API-25, P1-API-26).
 *
 * Public, signed in or out. The loader moved the token out of the address bar
 * into this tab's flow storage, so it survives registration, sign-in, MFA and
 * email verification without riding along in `next`. Accepting is always an
 * explicit click; the workspace gate then runs its normal entry checks.
 */
export function AcceptInvitationPage() {
  useDocumentTitle('Invitation');
  const [params] = useSearchParams();
  const token = linkTokenFor('invitation', params);

  if (!token) {
    return (
      <Problem
        icon={<Link2Off />}
        title="No invitation to show"
        body="This link is missing its code, or the invitation you opened earlier has been dealt with. Open the invitation email again and use the button in it."
      />
    );
  }
  return <Invitation token={token} />;
}

function Invitation({ token }: { token: string }) {
  const status = useSession((state) => state.status);
  const gated = useSession((state) => state.emailVerificationRequired);
  const signedIn = status === 'authenticated';
  // One preview per page load (it shares the auth throttle): no retries, no refocus.
  const preview = useQuery(invitationPreviewQuery(token));
  const me = useQuery({ ...meQuery, enabled: signedIn && !gated });

  useEffect(() => {
    if (preview.data) {
      updateLinkMeta('invitation', { workspaceName: preview.data.organizationName, maskedEmail: preview.data.email });
    }
  }, [preview.data]);

  if (preview.isPending || status === 'restoring' || (signedIn && !gated && me.isPending)) {
    return (
      <AuthCard>
        <div className="flex flex-col items-center py-8 text-center" role="status">
          <Spinner className="size-6 text-brand-600" />
          <p className="mt-4 text-sm font-medium text-ink">Opening your invitation…</p>
        </div>
      </AuthCard>
    );
  }

  if (preview.isError) {
    return <InvitationError error={preview.error} preview={null} me={me.data} />;
  }

  return <PreviewCard token={token} preview={preview.data} fetchedAt={preview.dataUpdatedAt} me={signedIn ? me.data : undefined} gated={signedIn && gated} />;
}

function PreviewCard({
  token,
  preview,
  fetchedAt,
  me,
  gated,
}: {
  token: string;
  preview: InvitationPreview;
  /** When the preview was loaded; "expires soon" is judged against it. */
  fetchedAt: number;
  me: CurrentUser | undefined;
  /** Signed in, but the deployment requires a verified email first. */
  gated: boolean;
}) {
  const navigate = useNavigate();
  const [switching, setSwitching] = useState(false);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  // A heuristic warning only: the server compares the real addresses.
  const mismatch = me ? maskEmail(me.email.toLowerCase()) !== preview.email : false;

  const accept = useMutation({
    mutationFn: () => invitationsApi.accept(token),
    onSuccess: async (result) => {
      clearLinkToken('invitation');
      // Load the new membership first so the workspace gate finds it at once.
      await Promise.all([
        queryClient.refetchQueries({ queryKey: queryKeys.me }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaces }),
      ]);
      queryClient.removeQueries({ queryKey: queryKeys.invitationPreview(token) });
      toast.success(`Welcome to ${preview.organizationName}`, { description: `You joined as ${preview.roleName}.` });
      navigate(workspaceHref({ id: result.organizationId, slug: result.organizationSlug }), { replace: true });
    },
    onError: (error) => {
      if (!isApiError(error)) return;
      if (error.code === 'RATE_LIMIT_EXCEEDED') setRateLimitedUntil(error.retryDeadline());
      // The deployment-wide gate: switch this card to "verify first" instead of
      // letting the same refusal come back on every click.
      if (error.code === 'ACCOUNT_EMAIL_NOT_VERIFIED' && error.details?.requiredBy !== 'workspace') {
        useSession.setState({ emailVerificationRequired: true });
        accept.reset();
      }
    },
  });

  const switchAccount = async () => {
    setSwitching(true);
    // The invitation stays in this tab's flow storage across the switch.
    await signOut('quiet');
    navigate(signInPath({ next: HERE }), { replace: true });
  };

  const decline = () => {
    clearLinkToken('invitation');
    queryClient.removeQueries({ queryKey: queryKeys.invitationPreview(token) });
    navigate('/', { replace: true });
  };

  if (accept.isError && !(isApiError(accept.error) && accept.error.code === 'RATE_LIMIT_EXCEEDED')) {
    return (
      <InvitationError
        error={accept.error}
        preview={preview}
        me={me}
        onSwitch={switchAccount}
        switching={switching}
        onRetry={() => accept.reset()}
      />
    );
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
          <span className="break-words">{preview.organizationName}</span> as{' '}
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
        {gated ? (
          <VerifyFirst />
        ) : me ? (
          <>
            <p className="text-[13px] text-muted">
              Signed in as <span className="font-medium break-all text-ink">{me.email}</span>
            </p>
            {mismatch ? (
              <Callout tone="warning" title="This invitation looks like it was sent to another address">
                It was sent to <span className="font-mono">{preview.email}</span>, but you're signed in as {me.email}. Sign
                in with the address it was sent to.
              </Callout>
            ) : null}
            <RateLimitNotice until={rateLimitedUntil} message="Too many attempts from this network." onDone={() => setRateLimitedUntil(null)} />
            <Button
              size="lg"
              className="w-full"
              loading={accept.isPending}
              disabled={!!rateLimitedUntil}
              onClick={() => accept.mutate()}
            >
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
              <Link to={`/auth/sign-up?next=${encodeURIComponent(HERE)}`}>
                Create account
                <ArrowRight />
              </Link>
            </Button>
            <p className="text-center text-[13px] text-muted">
              <Link
                to={signInPath({ next: HERE })}
                className="font-medium text-brand-700 underline decoration-brand-200 underline-offset-4 hover:decoration-brand-500"
              >
                I already have an account
              </Link>
            </p>
          </>
        ) : (
          <>
            <Button asChild size="lg" className="w-full">
              <Link to={signInPath({ next: HERE })}>
                Sign in to accept
                <ArrowRight />
              </Link>
            </Button>
            <p className="text-center text-xs text-muted">Use the account for {preview.email}.</p>
          </>
        )}
        <button
          type="button"
          onClick={decline}
          className="mx-auto w-fit rounded-sm text-[13px] font-medium text-muted hover:text-ink hover:underline hover:underline-offset-4"
        >
          Not now
        </button>
      </div>
    </AuthCard>
  );
}

/** The deployment requires a verified email before anything else, accepting included. */
function VerifyFirst() {
  const knownEmail = useSession((state) => state.knownEmail);
  const [checking, setChecking] = useState(false);
  return (
    <div className="grid gap-3">
      <Callout tone="warning" icon={<MailWarning className="size-4" />} title="Verify your email first">
        Open the verification link we emailed you, then come back here; the invitation will still be waiting.
      </Callout>
      <ResendVerification email={knownEmail} variant="secondary" size="md" />
      <Button
        variant="ghost"
        loading={checking}
        onClick={async () => {
          setChecking(true);
          const verified = await recheckEmailVerification();
          setChecking(false);
          if (!verified) toast.info('Not verified yet', { description: 'Open the link in the email first, then try again.' });
        }}
      >
        I've verified it
      </Button>
    </div>
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

// ── Errors ──────────────────────────────────────────────────────────────────

/** Terminal outcomes: the link can never work again, so it is forgotten. */
const TERMINAL = new Set([
  'INVITATION_NOT_FOUND',
  'INVITATION_EXPIRED',
  'INVITATION_REVOKED',
  'INVITATION_ALREADY_ACCEPTED',
  'MEMBERSHIP_ALREADY_EXISTS',
  'MEMBERSHIP_SUSPENDED',
  'ROLE_NOT_FOUND',
  'ORGANIZATION_NOT_FOUND',
  'VALIDATION_FAILED',
]);

function InvitationError({
  error,
  preview,
  me,
  onSwitch,
  switching,
  onRetry,
}: {
  error: unknown;
  preview: InvitationPreview | null;
  me: CurrentUser | undefined;
  onSwitch?: () => void;
  switching?: boolean;
  onRetry?: () => void;
}) {
  const code = isApiError(error) ? error.code : null;
  const workspaceName = preview?.organizationName ?? 'this workspace';
  const requestId = isApiError(error) ? error.requestId : undefined;
  const terminal = !!code && TERMINAL.has(code);

  useEffect(() => {
    if (terminal) clearLinkToken('invitation');
  }, [terminal]);

  if (isOutcomeUnknown(error) && preview && onRetry) {
    return <UncertainAccept preview={preview} onRetry={onRetry} />;
  }

  switch (code) {
    case 'INVITATION_NOT_FOUND':
    case 'VALIDATION_FAILED':
      return (
        <Problem
          icon={<Link2Off />}
          title="This invitation link isn't valid"
          body="It may have been replaced by a newer invitation or withdrawn. Check your inbox for the latest email, or ask the person who invited you."
          requestId={requestId}
        />
      );
    case 'INVITATION_EXPIRED':
      return (
        <Problem
          icon={<CalendarClock />}
          tone="warning"
          title="This invitation has expired"
          body={`Ask ${preview?.inviterName ?? 'the person who invited you'} to send it again. A new invitation comes with a new link.`}
          requestId={requestId}
        />
      );
    case 'INVITATION_REVOKED':
      return <Problem icon={<Ban />} title="This invitation was withdrawn" body="Ask the person who invited you if you should still join." requestId={requestId} />;
    case 'ROLE_NOT_FOUND':
    case 'ORGANIZATION_NOT_FOUND':
      return (
        <Problem
          icon={<Ban />}
          title="This invitation can't be used any more"
          body={`The workspace or the role it offered no longer exists. Ask ${preview?.inviterName ?? 'the person who invited you'} for a new invitation.`}
          requestId={requestId}
        />
      );
    case 'INVITATION_ALREADY_ACCEPTED':
    case 'MEMBERSHIP_ALREADY_EXISTS':
      // A conflict is not a success: offer entry only if you really are a member.
      return <AlreadyUsed preview={preview} code={code} requestId={requestId} />;
    case 'INVITATION_EMAIL_MISMATCH':
      // A 401 about the invitation, not the session: stay signed in, offer to switch.
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
              Sign in with the address it was sent to; the invitation will be waiting.
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
                <Link to={signInPath({ next: HERE })}>Sign in</Link>
              </Button>
            )
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
    case 'ACCOUNT_EMAIL_NOT_VERIFIED':
      return (
        <Problem
          icon={<MailWarning />}
          tone="warning"
          title="Verify your email first"
          body="This deployment requires a verified email before you can join a workspace. Open the link we emailed you, then come back to this page."
          action={onRetry ? <Button onClick={onRetry}>Back to the invitation</Button> : null}
          requestId={requestId}
        />
      );
    case 'AUTH_TOKEN_MISSING':
      return (
        <Problem
          icon={<ShieldAlert />}
          tone="warning"
          title="Please sign in again"
          body="Your session ended before the invitation could be accepted. It will be waiting after you sign in."
          action={
            <Button asChild>
              <Link to={signInPath({ next: HERE })}>Sign in</Link>
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
            onRetry ? (
              <Button variant="secondary" onClick={onRetry}>
                Back to the invitation
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => window.location.reload()}>
                Try again
              </Button>
            )
          }
          requestId={requestId}
        />
      );
  }
}

/** Your membership in the invitation's workspace, after re-reading them. */
function useMembershipIn(preview: InvitationPreview | null) {
  const status = useSession((state) => state.status);
  const me = useQuery({ ...meQuery, enabled: status === 'authenticated', staleTime: 0, refetchOnMount: 'always' });
  const membership: MembershipSummary | undefined = preview
    ? me.data?.memberships.find((item) => item.organizationSlug === preview.organizationSlug)
    : undefined;
  return { membership, checking: me.isFetching, refetch: me.refetch };
}

function AlreadyUsed({
  preview,
  code,
  requestId,
}: {
  preview: InvitationPreview | null;
  code: string;
  requestId?: string;
}) {
  const { membership, checking } = useMembershipIn(preview);
  const enter = membership ? (
    <Button asChild>
      <Link to={workspaceHref({ id: membership.organizationId, slug: membership.organizationSlug })}>
        Go to {membership.organizationName}
        <ArrowRight />
      </Link>
    </Button>
  ) : null;

  return (
    <Problem
      icon={membership ? <CircleCheck /> : <Link2Off />}
      tone={membership ? 'success' : 'neutral'}
      title={
        membership
          ? `You're a member of ${membership.organizationName}`
          : code === 'INVITATION_ALREADY_ACCEPTED'
            ? 'This invitation has already been used'
            : 'This account already has a membership there'
      }
      body={
        checking
          ? 'Checking your workspaces…'
          : membership
            ? "There's nothing more to accept."
            : 'Each invitation link works once. If you expected to have access, ask the person who invited you.'
      }
      action={enter}
      requestId={requestId}
    />
  );
}

/** Accept got no answer: it may have gone through. Check before trying again. */
function UncertainAccept({ preview, onRetry }: { preview: InvitationPreview; onRetry: () => void }) {
  const { membership, checking, refetch } = useMembershipIn(preview);
  if (membership) {
    return (
      <Problem
        icon={<CircleCheck />}
        tone="success"
        title={`You're a member of ${membership.organizationName}`}
        body="The invitation went through even though the answer didn't reach us."
        action={
          <Button asChild onClick={() => clearLinkToken('invitation')}>
            <Link to={workspaceHref({ id: membership.organizationId, slug: membership.organizationSlug })}>
              Go to {membership.organizationName}
              <ArrowRight />
            </Link>
          </Button>
        }
      />
    );
  }
  return (
    <Problem
      icon={<SearchCheck />}
      tone="warning"
      title="We couldn't confirm whether you joined"
      body={
        checking
          ? 'Checking your workspaces…'
          : `The connection dropped before AgentVault answered, and ${preview.organizationName} isn't among your workspaces yet. Check again, or go back and accept once more.`
      }
      action={
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={checking} onClick={() => void refetch()}>
            Check again
          </Button>
          <Button onClick={onRetry}>Back to the invitation</Button>
        </div>
      }
    />
  );
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
      <div className="mt-2 text-sm leading-relaxed text-muted">{body}</div>
      <div className="mt-6 flex flex-wrap gap-2">
        {action}
        <Button asChild variant={action ? 'ghost' : 'secondary'}>
          <Link to={status === 'authenticated' ? '/workspaces' : '/auth/sign-in'}>
            {status === 'authenticated' ? 'Your workspaces' : 'Go to sign in'}
          </Link>
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
