import { ArrowLeft } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/lib/hooks';

export function NotFoundPage() {
  const location = useLocation();
  useDocumentTitle('Page not found');

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="px-6 py-5">
        <Link to="/" className="inline-flex rounded-md">
          <Logo />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 pb-24">
        <div className="max-w-md text-center">
          <p className="font-mono text-xs tracking-wider text-faint">404</p>
          <h1 className="mt-3 font-display text-5xl text-ink">Nothing here.</h1>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            There's no page at <span className="rounded bg-well px-1.5 py-0.5 font-mono text-[12px] text-ink-soft">{location.pathname}</span>.
            It may have moved, or the link may be mistyped.
          </p>
          <Button asChild className="mt-7">
            <Link to="/">
              <ArrowLeft />
              Back to AgentVault
            </Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
