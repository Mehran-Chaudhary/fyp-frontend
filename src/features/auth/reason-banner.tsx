import { Callout } from '@/components/ui/callout';

/** Banners for the `?reason=` of redirects to the sign-in page (spec §4.4, §7.1). */
const BANNERS: Record<
  string,
  { tone: 'info' | 'success' | 'danger' | 'security'; title: string; body?: string }
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
    title: 'Your account cannot sign in.',
    body: 'It may be suspended or deactivated. Contact your administrator.',
  },
  'signed-out-everywhere': {
    tone: 'success',
    title: 'You were signed out of all devices.',
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
  const banner = reason ? BANNERS[reason] : undefined;
  if (!banner) return null;
  return (
    <Callout tone={banner.tone} title={banner.title} className="mb-5" role="status">
      {banner.body}
    </Callout>
  );
}
