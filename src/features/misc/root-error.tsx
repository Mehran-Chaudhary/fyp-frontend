import { RotateCcw } from 'lucide-react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { LogoMark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { IS_DEV } from '@/lib/env';

/**
 * Last line of defence for render errors. A failed lazy chunk after a deploy is
 * the common case, so "Reload" is the primary action.
 */
export function RootErrorBoundary() {
  const error = useRouteError();
  const isChunkError =
    error instanceof Error && /dynamically imported module|Importing a module script failed/i.test(error.message);

  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-md text-center">
        <LogoMark className="mx-auto size-10" />
        <h1 className="mt-6 font-display text-4xl text-ink">Something broke.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          {isChunkError
            ? 'A newer version of AgentVault is available. Reload to continue.'
            : 'An unexpected error stopped this page from rendering. Reloading usually fixes it; your session is safe.'}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button onClick={() => window.location.reload()}>
            <RotateCcw />
            Reload
          </Button>
          <Button variant="secondary" asChild>
            <Link to="/">Go home</Link>
          </Button>
        </div>
        {IS_DEV ? (
          <pre className="mt-8 max-h-48 overflow-auto rounded-lg border border-line bg-surface p-3 text-left font-mono text-[11px] leading-relaxed text-danger-700">
            {detail}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
