import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import { Splash } from '@/components/feedback/global-states';
import { ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { EmailVerificationRequiredScreen } from '@/features/auth/email-verification-required';
import { defaultLanding, signInPath } from '@/lib/auth/landing';
import { reasonKeepsDestination, signOut, useSession, type SignOutReason } from '@/lib/auth/session';
import { meQuery } from '@/lib/queries';

/** Reasons that get a banner on the sign-in page. */
function bannerReason(reason: SignOutReason | null): SignOutReason | null {
  if (!reason || reason === 'quiet' || reason === 'signed-out') return null;
  return reason;
}

/**
 * Authenticated routes (spec §6.2). Splash while restoring; otherwise redirect to
 * sign-in with `next` so the user comes back to the same page.
 */
export function RequireAuth() {
  const status = useSession((state) => state.status);
  const reason = useSession((state) => state.reason);
  const emailVerificationRequired = useSession((state) => state.emailVerificationRequired);
  const location = useLocation();

  if (status === 'restoring') return <Splash />;

  if (status === 'unauthenticated') {
    if (reason === 'account-erased') return <Navigate to="/goodbye" replace />;
    const next = reasonKeepsDestination(reason) ? `${location.pathname}${location.search}${location.hash}` : null;
    return <Navigate to={signInPath({ next, reason: bannerReason(reason) })} replace />;
  }

  if (emailVerificationRequired) return <EmailVerificationRequiredScreen />;

  return (
    <CurrentUserBoundary>
      <Outlet />
    </CurrentUserBoundary>
  );
}

/** Makes sure /auth/me is loaded before anything that needs the user renders. */
function CurrentUserBoundary({ children }: { children: ReactNode }) {
  const me = useQuery(meQuery);
  if (me.data) return <>{children}</>;
  if (me.isPending) return <Splash />;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface shadow-card">
        <ErrorState
          error={me.error}
          title="We couldn't load your account"
          onRetry={() => void me.refetch()}
          retrying={me.isFetching}
        />
        <div className="flex justify-center border-t border-line py-3">
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Sign-in style pages (spec §6.2): once signed in, continue to `next` or the
 * default landing (§6.3). This is also how a successful sign-in navigates.
 */
export function PublicOnly() {
  const status = useSession((state) => state.status);
  const [params] = useSearchParams();
  const me = useQuery({ ...meQuery, enabled: status === 'authenticated' });

  if (status === 'restoring') return <Splash />;
  if (status === 'authenticated') {
    if (me.isPending) return <Splash />;
    return <Navigate to={defaultLanding(me.data, params.get('next'))} replace />;
  }
  return <Outlet />;
}

/** "/" → the right place for whoever is visiting. */
export function RootRedirect() {
  const status = useSession((state) => state.status);
  const me = useQuery({ ...meQuery, enabled: status === 'authenticated' });

  if (status === 'restoring') return <Splash />;
  if (status === 'unauthenticated') return <Navigate to="/auth/sign-in" replace />;
  if (me.isPending) return <Splash />;
  return <Navigate to={defaultLanding(me.data)} replace />;
}
