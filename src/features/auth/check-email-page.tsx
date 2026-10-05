import { useQuery } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { recheckEmailVerification, signOut, useSession } from '@/lib/auth/session';
import { useDocumentTitle } from '@/lib/hooks';
import { meQuery } from '@/lib/queries';
import { toast } from '@/lib/toast';
import { AuthCard, AuthHeading } from './auth-layout';
import { ResendVerification } from './resend-verification';

/**
 * /auth/check-email: verification guidance, a resend and a re-check (Phase 1
 * spec §6). Works signed out, signed in, and behind the global email gate, where
 * it is the only screen that can make progress. "Sent" never claims the account
 * exists or the email arrived.
 */
export function CheckEmailPage() {
  useDocumentTitle('Check your inbox');
  const status = useSession((state) => state.status);
  const gated = useSession((state) => state.emailVerificationRequired);
  const knownEmail = useSession((state) => state.knownEmail);
  const signedIn = status === 'authenticated';
  const me = useQuery({ ...meQuery, enabled: signedIn && !gated });
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);

  if (status === 'restoring' || (signedIn && !gated && me.isPending)) {
    return (
      <AuthCard>
        <div className="flex justify-center py-8" role="status" aria-label="Loading">
          <Spinner className="size-6 text-brand-600" />
        </div>
      </AuthCard>
    );
  }
  if (signedIn && !gated && me.data?.emailVerified) return <Navigate to="/" replace />;

  const email = me.data?.email ?? knownEmail;

  return (
    <AuthCard>
      <span className="inline-flex size-10 items-center justify-center rounded-xl border border-brand-200 bg-brand-50 text-brand-700">
        <MailCheck className="size-5" />
      </span>
      <AuthHeading
        title="Check your inbox"
        description={
          <>
            {email ? (
              <>
                We sent a verification link to <span className="font-medium break-all text-ink-soft">{email}</span>.
              </>
            ) : (
              'We sent you a verification link.'
            )}{' '}
            Open it to confirm the address. Links expire after a day, and only the newest one works.
          </>
        }
      />
      <ResendVerification email={signedIn ? email : null} />
      <div className="mt-4 flex items-center justify-between gap-3">
        {signedIn ? (
          <>
            <Button
              variant="link"
              size="sm"
              loading={checking}
              onClick={async () => {
                setChecking(true);
                const verified = await recheckEmailVerification();
                setChecking(false);
                if (verified) navigate('/', { replace: true });
                else toast.info('Not verified yet', { description: 'Open the link in the email first, then try again.' });
              }}
            >
              I've verified it
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              Sign out
            </Button>
          </>
        ) : (
          <Link to="/auth/sign-in" className="text-[13px] font-medium text-muted hover:text-ink">
            Back to sign in
          </Link>
        )}
      </div>
    </AuthCard>
  );
}
