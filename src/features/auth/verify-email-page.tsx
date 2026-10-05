import { useQuery } from '@tanstack/react-query';
import { ArrowRight, LinkIcon, MailCheck, MailWarning } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import { RequestReference } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { authApi } from '@/lib/api/endpoints';
import { isApiError } from '@/lib/api/errors';
import { clearLinkToken, linkTokenFor, readLinkToken, updateLinkMeta } from '@/lib/auth/link-tokens';
import { recheckEmailVerification, useSession } from '@/lib/auth/session';
import { messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { meQuery } from '@/lib/queries';
import { hashString } from '@/lib/utils';
import { revalidateWorkspaceAccess } from '@/lib/workspace/cache';
import { AuthCard, AuthHeading } from './auth-layout';
import { ResendVerification } from './resend-verification';

/**
 * One verification per token for the life of the page: React StrictMode mounts
 * twice in development, and a second POST would answer TOKEN_ALREADY_USED over a
 * success (spec §6 "Verification": never double-submit a link token).
 */
const verifications = new Map<string, Promise<{ verified: boolean }>>();
function verifyOnce(token: string) {
  let pending = verifications.get(token);
  if (!pending) {
    pending = authApi.verifyEmail(token).then(
      (result) => {
        updateLinkMeta('verify-email', { done: true });
        return result;
      },
      (error: unknown) => {
        // Only a deliberate "Try again" sends it once more.
        verifications.delete(token);
        throw error;
      },
    );
    verifications.set(token, pending);
  }
  return pending;
}

/**
 * /auth/verify-email — the link the backend emails (P1-API-14). Public: it works
 * signed in, signed out, and while the email gate blocks everything else. The
 * loader already moved the token out of the address bar.
 */
export function VerifyEmailPage() {
  useDocumentTitle('Verify your email');
  const [params] = useSearchParams();
  const token = linkTokenFor('verify-email', params);
  const alreadyDone = readLinkToken('verify-email')?.meta?.done === true;
  const status = useSession((state) => state.status);
  const signedIn = status === 'authenticated';

  const verification = useQuery({
    // Hashed: the link token itself never enters the cache.
    queryKey: ['verify-email', hashString(token ?? '')],
    queryFn: () => verifyOnce(token!),
    enabled: !!token && !alreadyDone,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const verified = alreadyDone || verification.isSuccess;
  const me = useQuery({ ...meQuery, enabled: signedIn });

  // Signed in: the account is verified now. Re-read identity (and leave the
  // global gate), then let workspaces re-check their email policy.
  useEffect(() => {
    if (!verified || !signedIn) return;
    void recheckEmailVerification();
    void revalidateWorkspaceAccess();
  }, [verified, signedIn]);

  // A link that can never work again is forgotten.
  const error = verification.error;
  const terminal = isApiError(error) && error.is('TOKEN_NOT_FOUND', 'TOKEN_EXPIRED', 'TOKEN_ALREADY_USED');
  useEffect(() => {
    if (terminal) clearLinkToken('verify-email');
  }, [terminal]);

  if (verified) {
    return (
      <AuthCard>
        <span className="inline-flex size-10 items-center justify-center rounded-xl border border-brand-200 bg-brand-50 text-brand-700">
          <MailCheck className="size-5" />
        </span>
        <AuthHeading
          title="Your email is verified"
          description="Thanks. Workspaces that require a verified email will let you in now."
        />
        {status === 'restoring' ? null : (
          <Button asChild size="lg" className="w-full">
            <Link to={signedIn ? '/' : '/auth/sign-in'} onClick={() => clearLinkToken('verify-email')}>
              {signedIn ? 'Continue to AgentVault' : 'Sign in'}
              <ArrowRight />
            </Link>
          </Button>
        )}
      </AuthCard>
    );
  }

  if (token && verification.isPending) {
    return (
      <AuthCard>
        <div className="flex flex-col items-center py-6 text-center" role="status">
          <Spinner className="size-6 text-brand-600" />
          <p className="mt-4 text-sm font-medium text-ink">Verifying your email…</p>
        </div>
      </AuthCard>
    );
  }

  const used = isApiError(error) && error.is('TOKEN_ALREADY_USED');
  const title = !token
    ? 'This verification link is incomplete'
    : used
      ? 'This link has already been used'
      : terminal
        ? 'This verification link is no longer valid'
        : "We couldn't verify your email";
  const description = !token
    ? 'The link is missing its code. Open the email again and use the button in it, or send yourself a new link.'
    : used
      ? "If you opened it a moment ago, your email is already verified. Otherwise, send yourself a new link; only the newest one works."
      : terminal
        ? 'Links expire after a day, and only the most recent one works. Send yourself a new link.'
        : messageFor(error);

  return (
    <AuthCard>
      <span className="inline-flex size-10 items-center justify-center rounded-xl border border-warning-200 bg-warning-50 text-warning-600">
        {token ? <MailWarning className="size-5" /> : <LinkIcon className="size-5" />}
      </span>
      <AuthHeading title={title} description={description} />
      {signedIn && me.data?.emailVerified ? (
        <div className="grid gap-3">
          <p className="text-sm text-muted">Good news: your email address is already verified.</p>
          <Button asChild size="lg" className="w-full">
            <Link to="/">Continue to AgentVault</Link>
          </Button>
        </div>
      ) : status === 'restoring' || (signedIn && me.isPending) ? null : !terminal && token ? (
        <Button size="lg" className="w-full" loading={verification.isFetching} onClick={() => void verification.refetch()}>
          Try again
        </Button>
      ) : (
        <ResendVerification email={signedIn ? me.data?.email : null} />
      )}
      <div className="mt-4 flex items-center justify-between">
        <Link to={signedIn ? '/' : '/auth/sign-in'} className="text-[13px] font-medium text-muted hover:text-ink">
          {signedIn ? 'Back to AgentVault' : 'Back to sign in'}
        </Link>
        <RequestReference requestId={isApiError(error) ? error.requestId : undefined} />
      </div>
    </AuthCard>
  );
}
