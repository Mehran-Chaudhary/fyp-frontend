import { ArrowLeft, Check, Compass, Lock } from 'lucide-react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/lib/hooks';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { SECTIONS, type SectionKey } from './nav';

/**
 * A reserved workspace section. Shows what is coming and in which phase, or a
 * "no access" state when the member's roles do not reveal the section.
 */
export function SectionPage({ section: key }: { section: SectionKey }) {
  const workspace = useWorkspace();
  const can = useCan();
  const section = SECTIONS[key];
  const Icon = section.icon;
  useDocumentTitle(section.label);

  if (!can.any(...section.anyOf)) {
    return (
      <Frame>
        <span className="inline-flex size-11 items-center justify-center rounded-xl border border-line bg-well text-ink-soft">
          <Lock className="size-5" aria-hidden />
        </span>
        <h1 className="mt-5 text-lg font-semibold text-ink">You don't have access to {section.label.toLowerCase()}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Your role in {workspace.name} doesn't include{' '}
          {section.anyOf.map((permission, index) => (
            <span key={permission}>
              {index > 0 ? ' or ' : null}
              <code className="rounded bg-well px-1 font-mono text-[12px] text-ink-soft">{permission}</code>
            </span>
          ))}
          . Ask a workspace admin if you need it.
        </p>
        <BackButton slug={workspace.slug} />
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="flex items-center gap-3">
        <span className="inline-flex size-11 items-center justify-center rounded-xl border border-brand-200 bg-brand-50 text-brand-700">
          <Icon className="size-5" aria-hidden />
        </span>
        <Badge tone="outline">Available in Phase {section.phase}</Badge>
      </div>
      <h1 className="mt-5 font-display text-[38px] leading-tight text-ink">{section.label}</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">{section.summary}</p>
      <ul className="mt-6 grid gap-2.5 border-t border-line pt-5">
        {section.bullets.map((bullet) => (
          <li key={bullet} className="flex items-start gap-2.5 text-[13px] text-ink-soft">
            <Check className="mt-0.5 size-3.5 shrink-0 text-brand-600" strokeWidth={2.5} aria-hidden />
            {bullet}
          </li>
        ))}
      </ul>
      <BackButton slug={workspace.slug} />
    </Frame>
  );
}

/** Unknown path inside a workspace. */
export function WorkspacePageNotFound() {
  const workspace = useWorkspace();
  useDocumentTitle('Not found');
  return (
    <Frame>
      <span className="inline-flex size-11 items-center justify-center rounded-xl border border-line bg-well text-ink-soft">
        <Compass className="size-5" aria-hidden />
      </span>
      <h1 className="mt-5 text-lg font-semibold text-ink">This page doesn't exist</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">There's nothing at this address in {workspace.name}.</p>
      <BackButton slug={workspace.slug} />
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-xl py-6 sm:py-12">
      <div className="rounded-xl border border-line bg-surface p-7 shadow-card animate-rise sm:p-9">{children}</div>
    </div>
  );
}

function BackButton({ slug }: { slug: string }) {
  return (
    <Button asChild variant="secondary" className="mt-7">
      <Link to={`/w/${slug}`}>
        <ArrowLeft />
        Back to dashboard
      </Link>
    </Button>
  );
}
