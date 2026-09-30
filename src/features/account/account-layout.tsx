import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Database, ShieldCheck, UserRound } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router';
import { Logo } from '@/components/brand/logo';
import { meQuery } from '@/lib/queries';
import { STORAGE_KEYS, storage } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { EmailVerificationBanner, TopBar } from '@/features/shell/top-bar';

const ITEMS = [
  { to: '/account/profile', label: 'Profile', icon: UserRound },
  { to: '/account/security', label: 'Security', icon: ShieldCheck },
  { to: '/account/privacy', label: 'Privacy & data', icon: Database },
];

/** Account settings frame (spec §7.12): sub-navigation and a way back. */
export function AccountLayout() {
  const { data: me } = useQuery(meQuery);
  const lastSlug = storage.get(STORAGE_KEYS.lastWorkspace);
  const last = me?.memberships.find((membership) => membership.organizationSlug === lastSlug);
  const back = last
    ? { to: `/w/${last.organizationSlug}`, label: `Back to ${last.organizationName}` }
    : { to: '/workspaces', label: 'Back to workspaces' };

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <TopBar>
        <Link to={back.to} className="rounded-md">
          <Logo />
        </Link>
        <span className="mx-1 h-5 w-px bg-line-strong" aria-hidden />
        <span className="text-[13px] font-medium text-ink">Account</span>
      </TopBar>
      <EmailVerificationBanner />
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-8 sm:py-10">
        <Link
          to={back.to}
          className="inline-flex max-w-full items-center gap-1.5 truncate rounded-md text-[13px] font-medium text-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5 shrink-0" />
          <span className="truncate">{back.label}</span>
        </Link>
        <div className="mt-6 grid gap-8 md:grid-cols-[200px_minmax(0,1fr)]">
          <nav aria-label="Account settings" className="md:sticky md:top-20 md:self-start">
            <ul className="flex gap-1 overflow-x-auto md:flex-col">
              {ITEMS.map(({ to, label, icon: Icon }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    className={({ isActive }) =>
                      cn(
                        'flex h-9 items-center gap-2.5 rounded-lg px-3 text-[13.5px] whitespace-nowrap transition-colors',
                        isActive ? 'bg-well-strong/70 font-medium text-ink' : 'text-ink-soft hover:bg-well hover:text-ink',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className={cn('size-4', isActive ? 'text-brand-600' : 'text-faint')} aria-hidden />
                        {label}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <main className="min-w-0">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
