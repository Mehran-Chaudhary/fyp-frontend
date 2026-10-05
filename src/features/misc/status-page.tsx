import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowLeft, CircleCheck, CircleX, HeartPulse, Layers, MonitorCog, RefreshCw, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Logo } from '@/components/brand/logo';
import { RequestReference } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { lockMode } from '@/lib/api/auth-lock';
import { apiOrigin, healthApi, summarizeReport, type ProbeOutcome } from '@/lib/api/health';
import type { HealthReport, Liveness } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { API_BASE_URL } from '@/lib/env';
import { useDocumentTitle } from '@/lib/hooks';
import { cn, humanizeSlug } from '@/lib/utils';

const probeOptions = {
  retry: false,
  staleTime: 0,
  gcTime: 0,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

/**
 * /status: the API's three health probes, run when this page opens or on
 * request, never polled (P1-API-27/28/29). A diagnostic for support and
 * integration sign-off: liveness says the process runs, readiness says it can
 * serve (database and cache), the full report lists components by name and
 * state only. Public, because it matters most when signing in doesn't work.
 */
export function StatusPage() {
  useDocumentTitle('Service status');
  const status = useSession((state) => state.status);
  const live = useQuery({ queryKey: ['health', 'live'], queryFn: ({ signal }) => healthApi.live(signal), ...probeOptions });
  const ready = useQuery({ queryKey: ['health', 'ready'], queryFn: ({ signal }) => healthApi.ready(signal), ...probeOptions });
  const full = useQuery({ queryKey: ['health', 'full'], queryFn: ({ signal }) => healthApi.full(signal), ...probeOptions });
  const running = live.isFetching || ready.isFetching || full.isFetching;

  const runAgain = () => {
    void live.refetch();
    void ready.refetch();
    void full.refetch();
  };

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex h-14 items-center justify-between border-b border-line px-4 sm:px-6">
        <Link to="/" className="rounded-md">
          <Logo />
        </Link>
        <Button variant="secondary" size="sm" onClick={runAgain} loading={running}>
          {running ? null : <RefreshCw />}
          Run checks again
        </Button>
      </header>
      <main className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <div>
          <Link
            to={status === 'authenticated' ? '/' : '/auth/sign-in'}
            className="inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-muted hover:text-ink"
          >
            <ArrowLeft className="size-3.5" />
            {status === 'authenticated' ? 'Back to AgentVault' : 'Back to sign in'}
          </Link>
          <h1 className="mt-4 text-[22px] leading-tight font-semibold tracking-[-0.015em] text-ink">Service status</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
            Checks the AgentVault API this app talks to, at{' '}
            <span className="rounded bg-well px-1.5 py-0.5 font-mono text-[12px] break-all text-ink-soft">{apiOrigin()}</span>.
            Share the references below when you report a problem.
          </p>
        </div>

        <ProbeCard
          icon={<HeartPulse />}
          title="Process"
          path="/health/live"
          meaning="Is the API running? It checks nothing else, so a passing result alone doesn't mean sign-in works."
          query={live}
          render={(data: Liveness) => (
            <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
              <Row label="Uptime">{formatUptime(data.uptime)}</Row>
              <Row label="Environment">{data.environment}</Row>
            </dl>
          )}
        />

        <ProbeCard
          icon={<Activity />}
          title="Readiness"
          path="/health/ready"
          meaning="Can the API serve requests? It needs its database; the cache counts as degraded rather than down."
          query={ready}
          render={(data: HealthReport) => <Components report={data} />}
        />

        <ProbeCard
          icon={<Layers />}
          title="All components"
          path="/health"
          meaning="Every dependency the API reports on. Optional features can be down without stopping the API."
          query={full}
          render={(data: HealthReport) => <Components report={data} />}
        />

        <BrowserCard />
      </main>
    </div>
  );
}

function ProbeCard<T>({
  icon,
  title,
  path,
  meaning,
  query,
  render,
}: {
  icon: ReactNode;
  title: string;
  path: string;
  meaning: string;
  query: { data?: ProbeOutcome<T>; isPending: boolean; isFetching: boolean; error: unknown };
  render: (data: T) => ReactNode;
}) {
  const outcome = query.data;
  return (
    <Card>
      <CardHeader
        icon={icon}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {title}
            <code className="font-mono text-[12px] font-normal text-faint">{path}</code>
          </span>
        }
        description={meaning}
        actions={query.isPending ? <Skeleton className="h-6 w-20 rounded-full" /> : <Verdict outcome={outcome} />}
      />
      <CardBody className={cn('grid gap-3 transition-opacity', query.isFetching && !query.isPending && 'opacity-60')}>
        {query.isPending ? (
          <Skeleton className="h-4 w-2/3" />
        ) : !outcome ? (
          <p className="text-[13px] text-muted">The check couldn't run in this browser.</p>
        ) : outcome.kind === 'unreachable' ? (
          <p className="text-[13px] leading-relaxed text-muted">
            {outcome.message} Check that the API is running and that this app points at it (
            <span className="font-mono text-[12px]">{API_BASE_URL}</span>).
          </p>
        ) : (
          <>
            {outcome.kind === 'ok' ? render(outcome.data) : outcome.data ? render(outcome.data) : null}
            {outcome.kind === 'failed' && !outcome.data ? (
              <p className="text-[13px] leading-relaxed text-muted">
                The API answered HTTP {outcome.status} without naming the failing component. Its logs, searched by the
                reference below, will.
              </p>
            ) : null}
          </>
        )}
        {outcome ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
            <span className="tabular">{outcome.ms} ms</span>
            {'requestId' in outcome ? <RequestReference requestId={outcome.requestId} /> : null}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function Verdict<T>({ outcome }: { outcome: ProbeOutcome<T> | undefined }) {
  if (!outcome) return null;
  if (outcome.kind === 'ok') {
    return (
      <Badge tone="success">
        <CircleCheck />
        Passing
      </Badge>
    );
  }
  if (outcome.kind === 'failed') {
    return (
      <Badge tone="danger">
        <CircleX />
        Failing · {outcome.status}
      </Badge>
    );
  }
  return (
    <Badge tone="warning">
      <TriangleAlert />
      No answer
    </Badge>
  );
}

/** Component names and states only, never their messages. */
function Components({ report }: { report: HealthReport }) {
  const components = summarizeReport(report);
  if (components.length === 0) return <p className="text-[13px] text-muted">No components reported.</p>;
  return (
    <ul className="grid gap-1.5 sm:grid-cols-2">
      {components.map((component) => {
        const up = component.status === 'up';
        const down = component.status === 'down';
        return (
          <li key={component.name} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-well/40 px-3 py-2 text-[13px]">
            <span className="truncate text-ink-soft">{humanizeSlug(component.name)}</span>
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 text-xs font-medium',
                up ? 'text-success-700' : down ? 'text-danger-700' : 'text-warning-700',
              )}
            >
              <span
                className={cn('size-1.5 rounded-full', up ? 'bg-success-500' : down ? 'bg-danger-500' : 'bg-warning-500')}
                aria-hidden
              />
              {component.status}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** How this browser keeps sign-in safe across tabs (spec §4 "Cross-tab coordination"). */
function BrowserCard() {
  const mode = lockMode();
  const channel = typeof BroadcastChannel !== 'undefined';
  return (
    <Card>
      <CardHeader
        icon={<MonitorCog />}
        title="This browser"
        description="How AgentVault keeps your session consistent when it's open in several tabs."
      />
      <CardBody>
        <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
          <Row label="Session renewal">
            {mode === 'web-locks' ? 'Coordinated (Web Locks)' : mode === 'storage-lease' ? 'Coordinated (storage lease)' : 'One tab at a time'}
          </Row>
          <Row label="Sign-out across tabs">{channel ? 'Instant' : 'On next request'}</Row>
        </dl>
        {mode === 'none' ? (
          <p className="mt-3 text-[13px] leading-relaxed text-warning-700">
            This browser blocks the storage AgentVault needs to coordinate tabs. Keep it open in one tab only.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1.5 last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{children}</dd>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min`;
  return `${Math.floor(seconds)} s`;
}
