import { Hourglass, RefreshCw, ShieldQuestion, WifiOff } from 'lucide-react';
import { Link, useNavigation } from 'react-router';
import { LogoMark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Spinner } from '@/components/ui/spinner';
import {
  abandonUncertainSession,
  bootstrapSession,
  confirmUncertainSession,
  retryAfterThrottle,
  signOut,
  useSession,
} from '@/lib/auth/session';
import { checkConnectivityNow, useConnectivity } from '@/lib/connectivity';
import { useCountdown } from '@/lib/hooks';
import { cn, formatCountdown } from '@/lib/utils';
import { RequestReference } from './states';

/**
 * Full-screen splash while the session restores: never a flash of protected
 * content or of the sign-in form (Phase 1 spec §4 bootstrap). Also explains a boot
 * that can't reach the API, or whose refresh got no answer in time.
 */
export function Splash() {
  const bootIssue = useSession((state) => state.bootIssue);
  const retryIn = useCountdown(bootIssue?.kind === 'unreachable' ? bootIssue.retryAt : null);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-6">
      <div className="flex w-full max-w-xs flex-col items-center text-center animate-rise">
        <div className="relative">
          <LogoMark className="size-11" />
          {bootIssue ? null : (
            <span className="absolute -inset-2 rounded-2xl border border-brand-200 opacity-70 animate-pulse" />
          )}
        </div>

        {bootIssue?.kind === 'unreachable' ? (
          <>
            <h1 className="mt-6 text-[15px] font-semibold text-ink">Can't reach AgentVault</h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
              Your session is safe. We'll keep trying
              {retryIn > 0 ? <span className="tabular"> — next attempt in {retryIn}s</span> : '…'}
            </p>
            <div className="mt-5 flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => void bootstrapSession()}>
                <RefreshCw />
                Retry now
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link to="/status">Service status</Link>
              </Button>
            </div>
          </>
        ) : bootIssue?.kind === 'uncertain' ? (
          <>
            <h1 className="mt-6 text-[15px] font-semibold text-ink">We couldn't confirm your session</h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
              AgentVault didn't answer in time while renewing it. Trying again is usually fine; if it keeps failing, sign
              in again.
            </p>
            <div className="mt-5 flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => void confirmUncertainSession()}>
                <RefreshCw />
                Try again
              </Button>
              <Button variant="ghost" size="sm" onClick={abandonUncertainSession}>
                Sign in again
              </Button>
            </div>
          </>
        ) : bootIssue?.kind === 'error' ? (
          <>
            <h1 className="mt-6 text-[15px] font-semibold text-ink">We couldn't restore your session</h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{bootIssue.message}</p>
            <div className="mt-5 flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => void bootstrapSession()}>
                <RefreshCw />
                Try again
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                Sign out
              </Button>
            </div>
            <RequestReference requestId={bootIssue.requestId} className="mt-3" />
          </>
        ) : (
          <p className="mt-6 flex items-center gap-2 text-[13px] text-muted">
            <Spinner className="size-3.5" />
            Restoring your session
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Blocking screen while POST /auth/refresh is throttled (spec §4.4). The user is
 * NOT signed out; when the countdown ends the refresh is retried.
 */
export function RefreshThrottleScreen() {
  const until = useSession((state) => state.refreshBlockedUntil);
  const status = useSession((state) => state.status);
  const remaining = useCountdown(until, () => void retryAfterThrottle());

  if (!until || status === 'unauthenticated') return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="throttle-title"
      aria-describedby="throttle-body"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-canvas/95 px-6 backdrop-blur-sm animate-overlay-in"
    >
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 text-center shadow-pop">
        <span className="mx-auto inline-flex size-11 items-center justify-center rounded-xl border border-warning-200 bg-warning-50 text-warning-600">
          <Hourglass className="size-5" aria-hidden />
        </span>
        <h1 id="throttle-title" className="mt-4 text-base font-semibold text-ink">
          Too many requests
        </h1>
        <p id="throttle-body" className="mt-1.5 text-[13px] leading-relaxed text-muted">
          AgentVault limits how often a session can be renewed from one network. You're still signed in; we'll
          continue automatically.
        </p>
        <p className="mt-5 font-mono text-3xl font-medium tracking-tight text-ink tabular" aria-live="polite">
          {formatCountdown(remaining)}
        </p>
        <p className="mt-1 text-xs text-faint">until we retry</p>
      </div>
    </div>
  );
}

/**
 * A refresh timed out mid-session. It may have renewed the session on the server
 * without the answer arriving, and presenting the old credential again would look
 * like theft, so nothing renews automatically until the user chooses
 * (spec §4 "An ambiguous refresh timeout must not blindly retry").
 */
export function RefreshUncertainDialog() {
  const uncertain = useSession((state) => state.refreshUncertain);
  const status = useSession((state) => state.status);
  if (!uncertain || status !== 'authenticated') return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="uncertain-title"
      aria-describedby="uncertain-body"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-canvas/95 px-6 backdrop-blur-sm animate-overlay-in"
    >
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 text-center shadow-pop">
        <span className="mx-auto inline-flex size-11 items-center justify-center rounded-xl border border-warning-200 bg-warning-50 text-warning-600">
          <ShieldQuestion className="size-5" aria-hidden />
        </span>
        <h1 id="uncertain-title" className="mt-4 text-base font-semibold text-ink">
          We couldn't confirm your session
        </h1>
        <p id="uncertain-body" className="mt-1.5 text-[13px] leading-relaxed text-muted">
          AgentVault didn't answer in time while renewing your session, so nothing was retried automatically. Try again,
          or sign in again if it keeps happening.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button autoFocus onClick={() => void confirmUncertainSession()}>
            <RefreshCw />
            Try again
          </Button>
          <Button variant="ghost" onClick={abandonUncertainSession}>
            Sign in again
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Top banner while the backend is unreachable. Never polls to gate navigation. */
export function OfflineBanner() {
  const status = useConnectivity((state) => state.status);
  const nextCheckAt = useConnectivity((state) => state.nextCheckAt);
  const bootIssue = useSession((state) => state.bootIssue);
  const retryIn = useCountdown(status === 'unreachable' ? nextCheckAt : null);

  // During boot the splash already explains the outage.
  if (status !== 'unreachable' || bootIssue?.kind === 'unreachable') return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[55] flex items-center justify-center gap-3 border-b border-warning-200 bg-warning-50 px-4 py-2 text-[13px] text-warning-700 animate-overlay-in"
    >
      <WifiOff className="size-4 shrink-0" aria-hidden />
      <span>
        <span className="font-medium">Can't reach AgentVault.</span>{' '}
        <span className="tabular">{retryIn > 0 ? `Retrying in ${retryIn}s…` : 'Retrying…'}</span>
      </span>
      <button
        type="button"
        onClick={checkConnectivityNow}
        className="rounded font-medium underline decoration-warning-200 underline-offset-2 hover:decoration-warning-600"
      >
        Retry now
      </button>
    </div>
  );
}

/** A thin progress line while the router loads a lazy route. */
export function NavigationProgress() {
  const navigation = useNavigation();
  const active = navigation.state !== 'idle';
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none fixed inset-x-0 top-0 z-[70] h-0.5 overflow-hidden transition-opacity duration-300',
        active ? 'opacity-100' : 'opacity-0',
      )}
    >
      <div className="h-full w-1/2 origin-left bg-brand-500 animate-progress" />
    </div>
  );
}

/** Inline "Too many attempts, try again in mm:ss" (spec §3.6). */
export function RateLimitNotice({
  until,
  message = 'Too many attempts.',
  onDone,
}: {
  until: number | null;
  message?: string;
  onDone?: () => void;
}) {
  const remaining = useCountdown(until, onDone);
  if (!until || remaining <= 0) return null;
  return (
    <Callout tone="warning" role="status">
      {message} Try again in <span className="font-mono font-medium tabular">{formatCountdown(remaining)}</span>.
    </Callout>
  );
}
