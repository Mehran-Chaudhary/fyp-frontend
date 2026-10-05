import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { dismissPendingSignOut, finishPendingSignOut, hasPendingSignOut } from '@/lib/auth/session';

/** Banners for the `?reason=` of redirects to the sign-in page (Phase 1 spec §11). */
const BANNERS: Record<
  string,
  { tone: 'info' | 'success' | 'danger' | 'security' | 'warning'; title: string; body?: string }
> = {
  'session-ended': {
    tone: 'info',
    title: 'Your session has ended.',
    body: 'Please sign in again to continue.',
  },
  'reuse-detected': {
    tone: 'security',
    title: 'For your protection you were signed out of all devices.',
    body: 'A sign-in token was presented twice, which can mean it was copied. Check your email for details and consider changing your password.',
  },
  suspended: {
    tone: 'danger',
    title: "Your account can't sign in right now.",
    body: 'It may be locked after too many failed attempts, suspended or deactivated. Wait a few minutes, or contact your administrator.',
  },
  'signed-out-everywhere': {
    tone: 'success',
    title: 'You were signed out of all devices.',
  },
  'device-signed-out': {
    tone: 'success',
    title: 'This device was signed out.',
    body: 'Your other devices stay signed in.',
  },
  'password-changed': {
    tone: 'success',
    title: 'Password changed.',
    body: 'Sign in again with your new password.',
  },
  'password-reset': {
    tone: 'success',
    title: 'Password reset.',
    body: 'Sign in with your new password. Every other session was signed out.',
  },
};

export function ReasonBanner({ reason }: { reason: string | null }) {
  if (reason === 'signed-out-unconfirmed' || (!reason && hasPendingSignOut())) return <UnconfirmedSignOut />;
  const banner = reason ? BANNERS[reason] : undefined;
  if (!banner) return null;
  return (
    <Callout tone={banner.tone} title={banner.title} className="mb-5" role="status">
      {banner.body}
    </Callout>
  );
}

/**
 * Signed out here, but the server never confirmed it (spec §4 "Logout network
 * failure"). This browser won't restore the session by itself; the user can
 * finish the server side deliberately, or simply sign in again.
 */
function UnconfirmedSignOut() {
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'failed' | 'dismissed'>('idle');

  if (state === 'dismissed') return null;
  if (state === 'done') {
    return (
      <Callout tone="success" title="You're signed out." className="mb-5" role="status">
        The server confirmed it.
      </Callout>
    );
  }

  return (
    <Callout
      tone="warning"
      title="Signed out on this device, but not confirmed"
      className="mb-5"
      role="status"
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            loading={state === 'working'}
            onClick={async () => {
              setState('working');
              setState((await finishPendingSignOut()) ? 'done' : 'failed');
            }}
          >
            Finish signing out
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              dismissPendingSignOut();
              setState('dismissed');
            }}
          >
            Dismiss
          </Button>
        </div>
      }
    >
      We couldn't reach AgentVault to end the session on the server, so it may still be valid there until it expires.
      This browser won't sign you back in on its own.
      {state === 'failed' ? ' Still no answer; try again when you are back online.' : null}
    </Callout>
  );
}
