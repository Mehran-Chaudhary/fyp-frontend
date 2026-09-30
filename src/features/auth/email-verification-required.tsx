import { MailWarning } from 'lucide-react';
import { useState } from 'react';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { recheckEmailVerification, signOut, useSession } from '@/lib/auth/session';
import { useDocumentTitle } from '@/lib/hooks';
import { toast } from '@/lib/toast';
import { ResendVerification } from './resend-verification';

/**
 * Shown when the backend enforces verification (REQUIRE_EMAIL_VERIFICATION) and
 * every call answers 403 ACCOUNT_EMAIL_NOT_VERIFIED (spec §7.6).
 */
export function EmailVerificationRequiredScreen() {
  useDocumentTitle('Verify your email');
  const knownEmail = useSession((state) => state.knownEmail);
  const [checking, setChecking] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="px-6 py-5">
        <Logo />
      </header>
      <main className="flex flex-1 items-center justify-center px-5 pb-20">
        <div className="w-full max-w-[400px] rounded-xl border border-line bg-surface p-7 shadow-card animate-rise">
          <span className="inline-flex size-10 items-center justify-center rounded-xl border border-warning-200 bg-warning-50 text-warning-600">
            <MailWarning className="size-5" />
          </span>
          <h1 className="mt-5 text-[22px] leading-tight font-semibold tracking-[-0.015em] text-ink">
            Verify your email to continue
          </h1>
          <p className="mt-1.5 mb-6 text-sm leading-relaxed text-muted">
            This AgentVault deployment requires a verified email address.
            {knownEmail ? (
              <>
                {' '}
                We sent a link to <span className="font-medium text-ink-soft">{knownEmail}</span>.
              </>
            ) : null}{' '}
            Open it, then come back here.
          </p>
          <ResendVerification email={knownEmail} />
          <div className="mt-4 flex items-center justify-between">
            <Button
              variant="link"
              size="sm"
              loading={checking}
              onClick={async () => {
                setChecking(true);
                const verified = await recheckEmailVerification();
                setChecking(false);
                if (!verified) {
                  toast.info('Not verified yet', { description: 'Open the link in the email first, then try again.' });
                }
              }}
            >
              I've verified it
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
