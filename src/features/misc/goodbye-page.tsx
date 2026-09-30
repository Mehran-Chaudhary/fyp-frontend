import { Link } from 'react-router';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/auth/session';
import { useDocumentTitle } from '@/lib/hooks';
import { pluralize } from '@/lib/utils';

/** Shown after account erasure (spec §7.14). */
export function GoodbyePage() {
  const farewell = useSession((state) => state.farewell);
  useDocumentTitle('Account erased');

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="px-6 py-5">
        <Logo />
      </header>
      <main className="flex flex-1 items-center justify-center px-6 pb-24">
        <div className="max-w-md text-center animate-rise">
          <h1 className="font-display text-5xl text-ink">Goodbye.</h1>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Your account has been erased.
            {farewell ? ` ${pluralize(farewell.workspacesDeleted, 'workspace')} deleted.` : null} Your conversations
            and workflow runs were crypto-shredded, your API keys revoked and your identity anonymised.
          </p>
          <p className="mt-3 text-[13px] text-faint">Thank you for trying AgentVault.</p>
          <Button asChild variant="secondary" className="mt-7">
            <Link to="/auth/sign-up">Create a new account</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
