import { zodResolver } from '@hookform/resolvers/zod';
import { Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { RateLimitNotice } from '@/components/feedback/global-states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authApi } from '@/lib/api/endpoints';
import { hasCode } from '@/lib/api/errors';
import { applyServerErrors, messageFor } from '@/lib/errors';
import { emailField } from '@/lib/validation/schemas';

const SENT_MESSAGE_MS = 60_000;

/**
 * Resend-verification control (E10). With a known email it is a single button;
 * otherwise it asks for the address. The server always answers "sent" and allows
 * 5 per hour.
 */
export function ResendVerification({
  email,
  variant = 'primary',
  size = 'lg',
}: {
  email?: string | null;
  variant?: 'primary' | 'secondary';
  size?: 'md' | 'lg';
}) {
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);

  useEffect(() => {
    if (!sent) return;
    const timer = window.setTimeout(() => setSent(false), SENT_MESSAGE_MS);
    return () => window.clearTimeout(timer);
  }, [sent]);

  const form = useForm<{ email: string }>({
    resolver: zodResolver(z.object({ email: emailField })),
    defaultValues: { email: '' },
  });

  const resend = async (address: string) => {
    setError(null);
    setSending(true);
    try {
      await authApi.resendVerification(address);
      setSent(true);
    } catch (err) {
      if (hasCode(err, 'RATE_LIMIT_EXCEEDED')) setRateLimitedUntil(err.retryDeadline());
      else if (!email) applyServerErrors(form, err, { fields: ['email'] });
      else setError(messageFor(err));
    } finally {
      setSending(false);
    }
  };

  const status = (
    <>
      {sent ? (
        <Callout tone="success" role="status">
          Sent. Check your inbox; only the newest link works.
        </Callout>
      ) : null}
      <RateLimitNotice
        until={rateLimitedUntil}
        message="You've asked for several emails already."
        onDone={() => setRateLimitedUntil(null)}
      />
    </>
  );

  if (email) {
    return (
      <div className="grid gap-3">
        {status}
        <FormError message={error ?? undefined} />
        <Button
          variant={variant}
          size={size}
          className="w-full"
          loading={sending}
          disabled={sent || !!rateLimitedUntil}
          onClick={() => void resend(email)}
        >
          {sent ? 'Email sent' : 'Send a new link'}
        </Button>
      </div>
    );
  }

  return (
    <form className="grid gap-3" noValidate onSubmit={form.handleSubmit(({ email: address }) => resend(address))}>
      <Field label="Your email" error={form.formState.errors.email?.message}>
        <Input type="email" autoComplete="email" leading={<Mail />} placeholder="you@company.com" {...form.register('email')} />
      </Field>
      {status}
      <FormError message={form.formState.errors.root?.server?.message} />
      <Button type="submit" variant={variant} size={size} className="w-full" loading={sending} disabled={!!rateLimitedUntil}>
        Send a new link
      </Button>
    </form>
  );
}
