import { Bot, Cpu, FileText, KeyRound, Lock, ScanEye, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, Outlet, useSearchParams } from 'react-router';
import { Logo } from '@/components/brand/logo';
import { cn } from '@/lib/utils';

const YEAR = new Date().getFullYear();

/**
 * Two-column layout for every signed-out page: the product story on the left
 * (hidden on small screens), the form on the right.
 */
export function AuthLayout() {
  return (
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]">
      <BrandPanel />
      <main className="flex min-h-dvh flex-col px-5 py-6 sm:px-10">
        <div className="lg:hidden">
          <Link to="/" className="inline-flex rounded-md">
            <Logo />
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[400px] animate-rise">
            <Outlet />
          </div>
        </div>
        <footer className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-faint lg:justify-end">
          <span>© {YEAR} AgentVault</span>
          <span aria-hidden>·</span>
          <span>Private AI agent infrastructure</span>
          <span aria-hidden>·</span>
          <Link to="/status" className="rounded-sm hover:text-muted hover:underline hover:underline-offset-4">
            Service status
          </Link>
        </footer>
      </main>
    </div>
  );
}

function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden border-r border-line bg-[#ecf0eb] lg:block">
      <div className="bg-dots absolute inset-0 [mask-image:linear-gradient(to_bottom,black_30%,transparent_95%)]" />
      <div className="relative flex min-h-dvh flex-col px-12 py-10 xl:px-16">
        <Link to="/" className="inline-flex w-fit rounded-md">
          <Logo />
        </Link>

        <div className="my-auto max-w-[520px] py-8">
          <p className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-surface/70 px-3 py-1 text-xs font-medium text-brand-800">
            <span className="size-1.5 rounded-full bg-brand-500" aria-hidden />
            Secure AI infrastructure
          </p>
          <h1 className="mt-6 font-display text-[52px] leading-[1.02] tracking-[-0.01em] text-ink xl:text-[58px]">
            Your private <em className="text-brand-700">AI command</em> center.
          </h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-ink-soft">
            Deploy agents that work with your most sensitive data, entirely inside your own infrastructure.
          </p>

          <DataPath className="mt-8" />

          <ul className="mt-8 grid gap-3.5">
            <Feature icon={<ShieldCheck />} title="Data sovereignty">
              Documents, prompts and answers stay on hardware you control.
            </Feature>
            <Feature icon={<Bot />} title="Custom AI agents">
              Digital employees with their own persona, knowledge and tools.
            </Feature>
            <Feature icon={<KeyRound />} title="Enterprise RBAC">
              Roles decide which agents and documents each person can reach.
            </Feature>
          </ul>
        </div>

        <p className="text-xs text-muted">Built at Air University, Islamabad</p>
      </div>
    </aside>
  );
}

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-brand-200 bg-surface text-brand-700 [&_svg]:size-3.5">
        {icon}
      </span>
      <p className="text-[13px] leading-relaxed text-muted">
        <span className="font-semibold text-ink">{title}.</span> {children}
      </p>
    </li>
  );
}

/**
 * What happens to a sentence on its way to the model: the PII Redaction Engine
 * masks it before a locally hosted LLM ever sees it.
 */
function DataPath({ className }: { className?: string }) {
  return (
    <figure
      className={cn('rounded-xl border border-line bg-surface/90 p-5 shadow-card backdrop-blur-sm', className)}
      aria-label="How a document reaches the model"
    >
      <figcaption className="mb-4 flex items-center justify-between text-[11px] font-medium tracking-[0.08em] text-faint uppercase">
        <span className="inline-flex items-center gap-1.5">
          <Lock className="size-3" aria-hidden />
          Inside your network
        </span>
        <span className="font-mono tracking-normal normal-case">0 bytes to third parties</span>
      </figcaption>
      <ol className="relative grid gap-4">
        <span aria-hidden className="absolute top-4 bottom-4 left-[15px] w-px bg-line-strong" />
        <Step icon={<FileText />} title="Document" meta="hr/q3-payroll.pdf">
          <span className="text-ink-soft">Sara Khan</span> · salary <span className="text-ink-soft">PKR 410,000</span>
        </Step>
        <Step icon={<ScanEye />} title="PII redaction" meta="2 entities masked" highlight>
          <Token>[PERSON_1]</Token> · salary <Token>[AMOUNT_1]</Token>
        </Step>
        <Step icon={<Cpu />} title="Local model" meta="llama3 · Ollama">
          answers without ever seeing the raw values
        </Step>
      </ol>
    </figure>
  );
}

function Step({
  icon,
  title,
  meta,
  children,
  highlight,
}: {
  icon: ReactNode;
  title: string;
  meta: string;
  children: ReactNode;
  highlight?: boolean;
}) {
  return (
    <li className="relative flex items-start gap-3">
      <span
        className={cn(
          'relative z-10 inline-flex size-[31px] shrink-0 items-center justify-center rounded-full border bg-surface [&_svg]:size-3.5',
          highlight ? 'border-brand-300 text-brand-700' : 'border-line-strong text-muted',
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="flex items-baseline justify-between gap-3 text-[13px]">
          <span className="font-medium text-ink">{title}</span>
          <span className="truncate font-mono text-[11px] text-faint">{meta}</span>
        </p>
        <p className="mt-1 truncate font-mono text-[12px] text-muted">{children}</p>
      </div>
    </li>
  );
}

function Token({ children }: { children: ReactNode }) {
  return <span className="rounded bg-brand-50 px-1 py-px text-brand-800 ring-1 ring-brand-200">{children}</span>;
}

/** "Sign in | Create account" switch. Keeps `next`, so a deep link survives the round trip. */
export function AuthTabs({ active }: { active: 'sign-in' | 'sign-up' }) {
  const [params] = useSearchParams();
  const kept = new URLSearchParams();
  for (const key of ['next']) {
    const value = params.get(key);
    if (value) kept.set(key, value);
  }
  const qs = kept.size ? `?${kept.toString()}` : '';

  const tab = (key: 'sign-in' | 'sign-up', label: string) => (
    <Link
      to={`/auth/${key}${qs}`}
      replace
      aria-current={active === key ? 'page' : undefined}
      className={cn(
        'rounded-md px-3 py-1.5 text-center text-[13px] font-medium transition-colors',
        active === key ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
      )}
    >
      {label}
    </Link>
  );

  return (
    <nav aria-label="Account access" className="mb-6 grid grid-cols-2 gap-1 rounded-lg border border-line bg-well p-1">
      {tab('sign-in', 'Sign in')}
      {tab('sign-up', 'Create account')}
    </nav>
  );
}

/** Heading block used at the top of each auth form. */
export function AuthHeading({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.015em] text-ink">{title}</h1>
      {description ? <p className="mt-1.5 text-sm leading-relaxed text-muted">{description}</p> : null}
    </div>
  );
}

/** The white panel that holds an auth form. */
export function AuthCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-line bg-surface p-6 shadow-card sm:p-7', className)}>{children}</div>
  );
}
