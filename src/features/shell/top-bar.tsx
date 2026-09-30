import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, ChevronDown, LogOut, MailWarning, ShieldCheck, UserRound } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar } from '@/components/ui/misc';
import { authApi } from '@/lib/api/endpoints';
import { hasCode } from '@/lib/api/errors';
import { signOut } from '@/lib/auth/session';
import { useCountdown } from '@/lib/hooks';
import { meQuery } from '@/lib/queries';
import { toastError } from '@/lib/toast';
import { cn, formatCountdown } from '@/lib/utils';

/** The sticky bar at the top of every signed-in page. */
export function TopBar({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur-md sm:px-6',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      <UserMenu />
    </header>
  );
}

/** Avatar menu: account, switch workspace, sign out (spec §7.10). */
export function UserMenu() {
  const { data: me } = useQuery(meQuery);
  const [signingOut, setSigningOut] = useState(false);
  if (!me) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-full py-1 pr-2 pl-1 text-left transition-colors hover:bg-well data-[state=open]:bg-well"
          aria-label={`Account menu for ${me.displayName}`}
        >
          <Avatar name={me.displayName} size="sm" />
          <span className="hidden max-w-40 truncate text-[13px] font-medium text-ink sm:block">{me.displayName}</span>
          <ChevronDown className="size-3.5 text-faint" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        <div className="flex items-center gap-3 px-2.5 py-2.5">
          <Avatar name={me.displayName} size="md" />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-ink">{me.displayName}</p>
            <p className="truncate text-xs text-muted">{me.email}</p>
          </div>
        </div>
        {me.isPlatformAdmin ? (
          <div className="px-2.5 pb-2">
            <Badge tone="info">
              <ShieldCheck />
              Platform administrator
            </Badge>
          </div>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/account/profile">
            <UserRound />
            Account settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/workspaces">
            <ArrowLeftRight />
            Switch workspace
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          tone="danger"
          disabled={signingOut}
          onSelect={() => {
            setSigningOut(true);
            void signOut();
          }}
        >
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SENT_MESSAGE_MS = 60_000;

/**
 * "Please verify your email address" banner while `emailVerified` is false
 * (spec §7.6). Resend is limited to 5 per hour.
 */
export function EmailVerificationBanner() {
  const { data: me } = useQuery(meQuery);
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  const remaining = useCountdown(rateLimitedUntil, () => setRateLimitedUntil(null));

  useEffect(() => {
    if (state !== 'sent') return;
    const timer = window.setTimeout(() => setState('idle'), SENT_MESSAGE_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  if (!me || me.emailVerified) return null;

  const resend = async () => {
    setState('sending');
    try {
      await authApi.resendVerification(me.email);
      setState('sent');
    } catch (error) {
      setState('idle');
      if (hasCode(error, 'RATE_LIMIT_EXCEEDED')) setRateLimitedUntil(error.retryDeadline());
      else toastError(error, "Couldn't send the email");
    }
  };

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-warning-200 bg-warning-50 px-4 py-2 text-center text-[13px] text-warning-700"
    >
      <MailWarning className="size-4 shrink-0" aria-hidden />
      <span>
        Please verify your email address, <span className="font-medium">{me.email}</span>.
      </span>
      {state === 'sent' ? (
        <span className="font-medium">Sent. Check your inbox.</span>
      ) : rateLimitedUntil && remaining > 0 ? (
        <span className="tabular">Too many emails; try again in {formatCountdown(remaining)}.</span>
      ) : (
        <button
          type="button"
          onClick={() => void resend()}
          disabled={state === 'sending'}
          className="rounded font-semibold underline decoration-warning-200 underline-offset-2 hover:decoration-warning-600 disabled:opacity-60"
        >
          {state === 'sending' ? 'Sending…' : 'Resend email'}
        </button>
      )}
    </div>
  );
}
