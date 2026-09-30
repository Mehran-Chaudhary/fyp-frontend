import { useQuery } from '@tanstack/react-query';
import { ArrowRight, MailCheck, MailWarning } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { RequestReference } from '@/components/feedback/states';
import { authApi } from '@/lib/api/endpoints';
import { isApiError } from '@/lib/api/errors';
import { useSession } from '@/lib/auth/session';
import { messageFor } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { meQuery, queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { AuthCard, AuthHeading } from './auth-layout';
import { ResendVerification } from './resend-verification';

/**
 * One verification per token for the life of the page. React StrictMode mounts
 * twice in development, and a second POST would answer TOKEN_ALREADY_USED over a
 * success (spec §7.6).
 */
const verifications = new Map<string, Promise<{ verified: true }>>();
function verifyOnce(token: string) {
  let pending = verifications.get(token);
  if (!pending) {
    pending = authApi.verifyEmail(token);
    verifications.set(token, pending);
  }
  return pending;
}

/** Verify email from the emailed link (spec §7.6). */
export function VerifyEmailPage() {
  useDocumentTitle('Verify your email');
  const [params] = useSearchParams();
  const token = params.get('token');
  const status = useSession((state) => state.status);
  const signedIn = status === 'authenticated';

  const verification = useQuery({
    queryKey: ['verify-email', token],
    queryFn: () => verifyOnce(token!),
    enabled: !!token,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const me = useQuery({ ...meQuery, enabled: signedIn });

  // Signed in: the account is now ACTIVE and verified.
  useEffect(() => {
    if (verification.isSuccess && signedIn) void queryClient.invalidateQueries({ queryKey: queryKeys.me });
  }, [verification.isSuccess, signedIn]);

  if (token && verification.isPending) {
    return (
      <AuthCard>
        <div className="flex flex-col items-center py-6 text-center">
          <Spinner className="size-6 text-brand-600" />
          <p className="mt-4 text-sm font-medium text-ink">Verifying your email…</p>
        </div>
      </AuthCard>
    );
  }

  if (verification.isSuccess) {
    return (
      <AuthCard>
        <span className="inline-flex size-10 items-center justify-center rounded-xl border border-brand-200 bg-brand-50 text-brand-700">
          <MailCheck className="size-5" />
        </span>
        <AuthHeading
          title="Your email is verified"
          description="Thanks. Your account is fully active and workspaces that require a verified email will let you in."
        />
        {status === 'restoring' ? null : signedIn ? (
          <Button asChild size="lg" className="w-full">
            <Link to="/">
              Continue to AgentVault
              <ArrowRight />
            </Link>
          </Button>
        ) : (
          <Button asChild size="lg" className="w-full">
            <Link to="/auth/sign-in">
              Sign in
              <ArrowRight />
            </Link>
          </Button>
        )}
      </AuthCard>
    );
  }

  const error = verification.error;
  const linkProblem = !token || (isApiError(error) && error.is('TOKEN_NOT_FOUND', 'TOKEN_EXPIRED', 'TOKEN_ALREADY_USED'));

  return (
    <AuthCard>
      <span className="inline-flex size-10 items-center justify-center rounded-xl border border-warning-200 bg-warning-50 text-warning-600">
        <MailWarning className="size-5" />
      </span>
      <AuthHeading
        title={linkProblem ? 'This verification link is no longer valid' : "We couldn't verify your email"}
        description={
          linkProblem
            ? 'Links expire after 24 hours, and only the most recent one works. Send yourself a new link.'
            : messageFor(error)
        }
      />
      {signedIn && me.data?.emailVerified ? (
        <div className="grid gap-3">
          <p className="text-sm text-muted">Good news: your email address is already verified.</p>
          <Button asChild size="lg" className="w-full">
            <Link to="/">Continue to AgentVault</Link>
          </Button>
        </div>
      ) : status === 'restoring' || (signedIn && me.isPending) ? null : (
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
