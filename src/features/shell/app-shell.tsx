import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Menu, PanelLeftClose, PanelLeftOpen, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Fragment, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useMatches } from 'react-router';
import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip } from '@/components/ui/tooltip';
import { conversationTitle } from '@/lib/agents/messages';
import { agentQuery, conversationQuery, knowledgeBaseQuery, mfaQuery } from '@/lib/queries';
import { STORAGE_KEYS, storage } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { SidebarKnowledgeBases } from '@/features/knowledge/sidebar-knowledge-bases';
import { UploadWatcher } from '@/features/knowledge/upload/upload-activity';
import { useUploadsActive } from '@/features/knowledge/upload/use-uploads-active';
import { primaryRoleLabel, useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { WorkspaceSwitcher } from '@/features/workspaces/workspace-switcher';
import { RealtimeProvider } from '@/features/realtime/realtime-provider';
import { HOME_NAV, LIVE_PHASE, NAV_GROUPS, PAGE_PARENTS, SECTIONS, STANDALONE_PAGES, SUBSECTION_LABELS, type SectionKey } from './nav';
import { EmailVerificationBanner, TopBar } from './top-bar';

function initialCollapsed(): boolean {
  const stored = storage.get(STORAGE_KEYS.sidebarCollapsed);
  if (stored === '1') return true;
  if (stored === '0') return false;
  // Collapsed by default below 1024 px (spec §7.10).
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches;
}

/** The signed-in workspace frame: sidebar, top bar and routed content (spec §7.10). */
export function AppShell({ children }: { children: ReactNode }) {
  const workspace = useWorkspace();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Data-dense pages (the vault, search) ask for more room with `handle: { wide: true }`;
  // chat screens fill the viewport and scroll inside (`handle: { fill: true }`).
  const handles = useMatches().map((match) => match.handle as { wide?: boolean; fill?: boolean } | undefined);
  const wide = handles.some((handle) => handle?.wide === true);
  const fill = handles.some((handle) => handle?.fill === true);

  const toggleCollapsed = () => {
    const next = !collapsed;
    storage.set(STORAGE_KEYS.sidebarCollapsed, next ? '1' : '0');
    setCollapsed(next);
  };

  return (
    <RealtimeProvider><div className="flex min-h-dvh">
      <aside
        className={cn(
          'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-[#fbfaf7] transition-[width] duration-200 ease-out md:flex',
          collapsed ? 'w-[68px]' : 'w-[248px]',
        )}
        aria-label="Sidebar"
      >
        <SidebarContent collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      </aside>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen} title="Navigation">
        <SidebarContent collapsed={false} onNavigate={() => setDrawerOpen(false)} />
      </Sheet>

      <div className={cn('flex min-w-0 flex-1 flex-col', fill && 'h-dvh')}>
        <TopBar>
          <Button
            variant="ghost"
            size="icon-sm"
            className="-ml-1 md:hidden"
            aria-label="Open navigation"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu />
          </Button>
          <Breadcrumb workspaceName={workspace.name} slug={workspace.slug} />
        </TopBar>
        <EmailVerificationBanner />
        {fill ? (
          <main className="flex min-h-0 flex-1 flex-col">{children}</main>
        ) : (
          <main className="flex-1 px-4 py-6 sm:px-8 sm:py-8">
            <div className={cn('mx-auto w-full', wide ? 'max-w-[92rem]' : 'max-w-6xl')}>{children}</div>
          </main>
        )}
      </div>
      <UploadWatcher />
    </div></RealtimeProvider>
  );
}

interface Crumb {
  label: ReactNode;
  to?: string;
}

function Breadcrumb({ workspaceName, slug }: { workspaceName: string; slug: string }) {
  const location = useLocation();
  const [, , , segment, sub] = location.pathname.split('/') as Array<string | undefined>;
  const base = `/w/${slug}`;
  const crumbs: Crumb[] = [];

  const section = segment ? SECTIONS[segment as SectionKey] : undefined;
  const page = segment ? PAGE_PARENTS[segment] : undefined;
  if (section && segment === 'agents' && sub) {
    // Agents › HR Policy Assistant › Versions
    const tab = location.pathname.split('/')[5];
    crumbs.push({ label: section.label, to: `${base}/agents` });
    if (sub === 'new') crumbs.push({ label: 'New agent' });
    else {
      crumbs.push({ label: <AgentCrumb agentId={sub} />, to: tab ? `${base}/agents/${sub}` : undefined });
      if (tab && AGENT_TAB_LABELS[tab]) crumbs.push({ label: AGENT_TAB_LABELS[tab] });
    }
  } else if (section && (segment === 'chat' || segment === 'supervision') && sub) {
    crumbs.push({ label: section.label, to: `${base}/${segment}` });
    crumbs.push({ label: <ConversationCrumb conversationId={sub} /> });
  } else if (section) {
    const subLabel = sub ? SUBSECTION_LABELS[sub] : undefined;
    crumbs.push({ label: section.label, to: subLabel ? `${base}/${segment}` : undefined });
    if (subLabel) crumbs.push({ label: subLabel });
  } else if (page) {
    // Pages that live under a section without their own nav item (knowledge bases, search).
    crumbs.push({ label: SECTIONS[page.parent].label, to: `${base}/${page.parent}` });
    crumbs.push({ label: page.label, to: sub ? `${base}/${segment}` : undefined });
    if (sub === 'new') crumbs.push({ label: 'New' });
    else if (sub && segment === 'knowledge-bases') crumbs.push({ label: <KnowledgeBaseCrumb knowledgeBaseId={sub} /> });
  } else if (segment && STANDALONE_PAGES[segment]) {
    crumbs.push({ label: STANDALONE_PAGES[segment] });
  } else {
    crumbs.push({ label: segment ? 'Not found' : HOME_NAV.label });
  }

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
      <Link to={base} className="truncate rounded-sm text-muted hover:text-ink">
        {workspaceName}
      </Link>
      {crumbs.map((crumb, index) => (
        <Fragment key={index}>
          <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden />
          {crumb.to ? (
            <Link to={crumb.to} className="truncate rounded-sm text-muted hover:text-ink">
              {crumb.label}
            </Link>
          ) : (
            <span className="truncate font-medium text-ink" aria-current="page">
              {crumb.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

const AGENT_TAB_LABELS: Record<string, string> = { edit: 'Configure', versions: 'Versions', preview: 'Prompt preview' };

/** The agent's name once its page has loaded it; nothing is fetched just for the crumb. */
function AgentCrumb({ agentId }: { agentId: string }) {
  const workspace = useWorkspace();
  const cached = useQuery({ ...agentQuery(workspace.id, agentId), enabled: false });
  return <>{cached.data?.name ?? 'Agent'}</>;
}

/** The conversation's (possibly masked) title once loaded. */
function ConversationCrumb({ conversationId }: { conversationId: string }) {
  const workspace = useWorkspace();
  const cached = useQuery({ ...conversationQuery(workspace.id, conversationId), enabled: false });
  return <>{cached.data ? conversationTitle(cached.data) : 'Conversation'}</>;
}

/** The knowledge base's name once its page has loaded it; nothing is fetched just for the crumb. */
function KnowledgeBaseCrumb({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const workspace = useWorkspace();
  const cached = useQuery({ ...knowledgeBaseQuery(workspace.id, knowledgeBaseId), enabled: false });
  return <>{cached.data?.name ?? 'Knowledge base'}</>;
}

function SidebarContent({
  collapsed,
  onToggleCollapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  onNavigate?: () => void;
}) {
  const workspace = useWorkspace();
  const can = useCan();
  const uploads = useUploadsActive();
  const base = `/w/${workspace.slug}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn('flex h-14 shrink-0 items-center', collapsed ? 'justify-center px-2' : 'justify-between pr-2 pl-4')}>
        <Link to={base} onClick={onNavigate} className="rounded-md" aria-label="Dashboard">
          <Logo compact={collapsed} />
        </Link>
        {!collapsed && onToggleCollapsed ? (
          <Tooltip content="Collapse sidebar" side="right">
            <Button variant="ghost" size="icon-sm" className="text-faint" onClick={onToggleCollapsed} aria-label="Collapse sidebar">
              <PanelLeftClose />
            </Button>
          </Tooltip>
        ) : null}
      </div>

      <div className={cn(collapsed ? 'px-2.5' : 'px-3')}>
        <WorkspaceSwitcher
          current={{ id: workspace.id, slug: workspace.slug, name: workspace.name }}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      </div>

      <nav className={cn('scrollbar-thin mt-5 min-h-0 flex-1 overflow-y-auto', collapsed ? 'px-2.5' : 'px-3')} aria-label="Workspace">
        <ul className="grid gap-0.5">
          <NavItem to={base} end icon={HOME_NAV.icon} label={HOME_NAV.label} collapsed={collapsed} onNavigate={onNavigate} />
        </ul>
        {NAV_GROUPS.map((group) => {
          const visible = group.sections.filter((key) => can.any(...SECTIONS[key].anyOf));
          if (visible.length === 0) return null;
          return (
            <div key={group.key} className={group.label ? 'mt-5' : 'mt-0.5'}>
              {!group.label ? null : collapsed ? (
                <div className="mx-auto mb-2 h-px w-6 bg-line" aria-hidden />
              ) : (
                <p className="mb-1.5 px-2.5 text-[11px] font-medium tracking-[0.08em] text-faint uppercase">{group.label}</p>
              )}
              <ul className="grid gap-0.5">
                {visible.map((key) => {
                  const section = SECTIONS[key];
                  const documents = key === 'documents';
                  return (
                    <Fragment key={key}>
                      <NavItem
                        to={`${base}/${key}`}
                        icon={section.icon}
                        label={section.label}
                        collapsed={collapsed}
                        onNavigate={onNavigate}
                        soon={section.phase > LIVE_PHASE}
                        alsoActive={documents ? [`${base}/knowledge-bases`, `${base}/search`] : undefined}
                        badge={
                          documents && uploads.active ? (
                            <Tooltip content="Uploading documents" side="right">
                              <span className="inline-flex text-brand-600" aria-label="Uploading documents">
                                <Spinner className="size-3.5" />
                              </span>
                            </Tooltip>
                          ) : null
                        }
                      />
                      {documents && !collapsed && can('knowledgebase:read') ? (
                        <li>
                          <SidebarKnowledgeBases onNavigate={onNavigate} />
                        </li>
                      ) : null}
                    </Fragment>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className={cn('shrink-0 border-t border-line', collapsed ? 'grid justify-items-center gap-2 p-2.5' : 'p-3')}>
        <SecurityPosture collapsed={collapsed} onNavigate={onNavigate} />
        {collapsed && onToggleCollapsed ? (
          <Tooltip content="Expand sidebar" side="right">
            <Button variant="ghost" size="icon-sm" className="text-faint" onClick={onToggleCollapsed} aria-label="Expand sidebar">
              <PanelLeftOpen />
            </Button>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

function NavItem({
  to,
  end,
  icon: Icon,
  label,
  collapsed,
  onNavigate,
  soon,
  alsoActive,
  badge,
}: {
  to: string;
  end?: boolean;
  icon: typeof HOME_NAV.icon;
  label: string;
  collapsed: boolean;
  onNavigate?: () => void;
  soon?: boolean;
  /** Other paths that belong to this item (a section's pages without their own nav item). */
  alsoActive?: string[];
  /** Shown at the right edge (an activity marker). */
  badge?: ReactNode;
}) {
  const { pathname } = useLocation();
  const extra = !!alsoActive?.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const link = (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      aria-label={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          'group relative flex h-9 items-center gap-2.5 rounded-lg text-[13.5px] transition-colors',
          collapsed ? 'justify-center' : 'px-2.5',
          isActive || extra ? 'bg-well-strong/70 font-medium text-ink' : 'text-ink-soft hover:bg-well hover:text-ink',
        )
      }
    >
      {({ isActive: matched }) => {
        const isActive = matched || extra;
        return (
        <>
          {isActive && !collapsed ? (
            <span className="absolute top-2 bottom-2 -left-3 w-[3px] rounded-r-full bg-brand-500" aria-hidden />
          ) : null}
          <Icon
            className={cn('size-[17px] shrink-0', isActive ? 'text-brand-600' : 'text-faint group-hover:text-ink-soft')}
            aria-hidden
          />
          {collapsed ? (
            badge ? <span className="absolute top-1 right-1">{badge}</span> : null
          ) : (
            <>
              <span className="truncate">{label}</span>
              {soon ? (
                <span className="ml-auto rounded border border-line px-1 text-[10px] leading-4 font-medium text-faint">
                  Soon
                </span>
              ) : badge ? (
                <span className="ml-auto">{badge}</span>
              ) : null}
            </>
          )}
        </>
        );
      }}
    </NavLink>
  );
  return <li>{collapsed ? <Tooltip content={label} side="right">{link}</Tooltip> : link}</li>;
}

/** A small reminder of the member's own two-step verification state. */
function SecurityPosture({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const workspace = useWorkspace();
  const mfa = useQuery(mfaQuery);
  if (!mfa.data) return collapsed ? null : <Skeleton className="h-12 w-full rounded-lg" />;
  const enabled = mfa.data.enabled;
  const Icon = enabled ? ShieldCheck : ShieldAlert;
  const href = `/account/security${enabled ? '' : `?next=${encodeURIComponent(`/w/${workspace.slug}`)}`}`;

  if (collapsed) {
    return (
      <Tooltip content={enabled ? 'Two-step verification is on' : 'Turn on two-step verification'} side="right">
        <Link
          to={href}
          onClick={onNavigate}
          className={cn(
            'inline-flex size-8 items-center justify-center rounded-lg border',
            enabled ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-warning-200 bg-warning-50 text-warning-600',
          )}
          aria-label={enabled ? 'Two-step verification is on' : 'Turn on two-step verification'}
        >
          <Icon className="size-4" />
        </Link>
      </Tooltip>
    );
  }

  return (
    <Link
      to={href}
      onClick={onNavigate}
      className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-well"
    >
      <span
        className={cn(
          'inline-flex size-8 shrink-0 items-center justify-center rounded-lg border',
          enabled ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-warning-200 bg-warning-50 text-warning-600',
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 text-xs leading-snug">
        <span className="block font-medium text-ink">{enabled ? 'Two-step verification on' : 'Two-step verification off'}</span>
        <span className="block truncate text-muted">
          {enabled ? `Your role: ${primaryRoleLabel(workspace.membership, workspace.summary)}` : 'Protect your account'}
        </span>
      </span>
    </Link>
  );
}

/** What the gate renders while it resolves a workspace: the shell's silhouette. */
export function ShellSkeleton({ workspaceName }: { workspaceName?: string }) {
  return (
    <div className="flex min-h-dvh" aria-busy="true" aria-label="Loading workspace">
      <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col border-r border-line bg-[#fbfaf7] md:flex">
        <div className="flex h-14 items-center px-4">
          <Logo />
        </div>
        <div className="px-3">
          <div className="flex items-center gap-2.5 rounded-lg border border-line bg-surface px-2.5 py-2">
            <Skeleton className="size-9 rounded-lg" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] leading-4 font-medium tracking-[0.06em] text-faint uppercase">Workspace</p>
              {workspaceName ? (
                <p className="truncate text-[13px] leading-5 font-semibold text-ink">{workspaceName}</p>
              ) : (
                <Skeleton className="mt-1 h-3.5 w-24" />
              )}
            </div>
          </div>
        </div>
        <div className="mt-6 grid gap-2 px-3">
          {[80, 64, 72, 58, 70, 52, 60].map((width, index) => (
            <div key={index} className="flex h-9 items-center gap-2.5 px-2.5">
              <Skeleton className="size-4 rounded" />
              <Skeleton className="h-3" style={{ width: `${width}%` }} />
            </div>
          ))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center border-b border-line px-6">
          <Skeleton className="h-3.5 w-40" />
        </div>
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="mt-4 h-9 w-72" />
          <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <Skeleton className="h-72 rounded-xl" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
