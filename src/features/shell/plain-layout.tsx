import { Link, Outlet } from 'react-router';
import { Logo } from '@/components/brand/logo';
import { EmailVerificationBanner, TopBar } from './top-bar';

/** Frame for signed-in pages outside a workspace (workspace list, create). */
export function PlainLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <TopBar>
        <Link to="/workspaces" className="rounded-md">
          <Logo />
        </Link>
      </TopBar>
      <EmailVerificationBanner />
      <main className="flex-1 px-4 py-8 sm:px-8 sm:py-12">
        <div className="mx-auto w-full max-w-5xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
