import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Mail, MailCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import { RateLimitNotice } from '@/components/feedback/global-states';
import { Button } from '@/components/ui/button';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authApi } from '@/lib/api/endpoints';
import { hasCode } from '@/lib/api/errors';
import { applyServerErrors } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { toast } from '@/lib/toast';
import { emailField } from '@/lib/validation/schemas';
import { AuthCard, AuthHeading } from './auth-layout';

const schema = z.object({ email: emailField });
type Values = z.infer<typeof schema>;

/** Forgot password (spec §7.4). The answer never reveals whether an account exists. */
export function ForgotPasswordPage() {
  useDocumentTitle('Reset your password');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '' } });
  const { errors, isSubmitting } = form.formState;

  const send = async (email: string): Promise<boolean> => {
    try {
      await authApi.forgotPassword(email);
      return true;
    } catch (error) {
      if (hasCode(error, 'RATE_LIMIT_EXCEEDED')) {
        setRateLimitedUntil(error.retryDeadline());
      } else {
        applyServerErrors(form, error, { fields: ['email'] });
      }
      return false;
    }
  };

  const onSubmit = form.handleSubmit(async ({ email }) => {
    if (await send(email)) setSentTo(email);
  });

  if (sentTo) {
    return (
      <AuthCard>
        <span className="inline-flex size-10 items-center justify-center rounded-xl border border-brand-200 bg-brand-50 text-brand-700">
          <MailCheck className="size-5" />
        </span>
        <AuthHeading
          title="Check your inbox"
          description={
            <>
              If an account exists for <span className="font-medium text-ink-soft">{sentTo}</span>, we've sent a link
              to reset your password. The link expires in 1 hour.
            </>
          }
        />
        <div className="grid gap-3">
          <RateLimitNotice
            until={rateLimitedUntil}
            message="You've requested several links already."
            onDone={() => setRateLimitedUntil(null)}
          />
          <Button asChild size="lg" className="w-full">
            <Link to="/auth/sign-in">Back to sign in</Link>
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            loading={resending}
            disabled={!!rateLimitedUntil}
            onClick={async () => {
              setResending(true);
              const ok = await send(sentTo);
              setResending(false);
              if (ok) toast.success('Another link is on its way', { description: 'Only the newest link works.' });
            }}
          >
            Send another link
          </Button>
          <p className="text-center text-xs leading-relaxed text-faint">
            Requesting a new link invalidates the previous one. Check your spam folder if nothing arrives.
          </p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <Link
        to="/auth/sign-in"
        className="-ml-1 mb-5 flex w-fit items-center gap-1.5 rounded-md px-1 py-0.5 text-[13px] font-medium text-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        Back to sign in
      </Link>
      <form onSubmit={onSubmit} noValidate>
        <AuthHeading
          title="Reset your password"
          description="Enter the email you sign in with and we'll send you a link to choose a new password."
        />
        <div className="grid gap-4">
          <Field label="Email" error={errors.email?.message}>
            <Input
              type="email"
              autoComplete="email"
              inputMode="email"
              autoFocus
              leading={<Mail />}
              placeholder="you@company.com"
              {...form.register('email')}
            />
          </Field>
          <RateLimitNotice
            until={rateLimitedUntil}
            message="You've requested several links already."
            onDone={() => setRateLimitedUntil(null)}
          />
          <FormError message={errors.root?.server?.message} />
          <Button type="submit" size="lg" className="w-full" loading={isSubmitting} disabled={!!rateLimitedUntil}>
            Send reset link
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
