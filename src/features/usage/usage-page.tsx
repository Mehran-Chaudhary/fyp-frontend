import { useQuery } from '@tanstack/react-query';
import {
  CircleCheck,
  CircleX,
  FlaskConical,
  Gauge,
  Hourglass,
  Info,
  ShieldAlert,
  ShieldX,
  Square,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NoAccessState } from '@/components/feedback/no-access';
import { ErrorState, PageHeader } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Segmented } from '@/components/ui/segmented';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import type { UsageSummary } from '@/lib/api/types';
import {
  compactNumber,
  customWindow,
  formatMs,
  formatShare,
  OUTCOMES,
  outcomeShares,
  presetWindow,
  toDateInput,
  USAGE_WINDOWS,
  type Outcome,
  type UsageWindowKey,
} from '@/lib/agents/usage';
import { useDocumentTitle } from '@/lib/hooks';
import { allAgentsQuery, llmUsageQuery } from '@/lib/queries';
import { cn, formatDateTime, pluralize, timestamp } from '@/lib/utils';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { ModelName } from '@/features/agents/shared/agent-bits';
import { useAgentCan } from '@/features/agents/shared/use-agent-can';

/** Usage (§5.10, P4-API-25): every model call in the workspace for a window. */
export function UsagePage() {
  const workspace = useWorkspace();
  const can = useAgentCan();
  useDocumentTitle('Usage');
  if (!can.readUsage) {
    return (
      <Card>
        <NoAccessState permissions={['usage:read']} workspaceName={workspace.name} title="You can't see usage" />
      </Card>
    );
  }
  return <Usage />;
}

function Usage() {
  const workspace = useWorkspace();
  const can = useAgentCan();
  const [key, setKey] = useState<UsageWindowKey>('30d');
  // The preset window is fixed when chosen (rounded to the minute) so the query key stays stable.
  const [window, setWindow] = useState(() => presetWindow('30d', timestamp()));
  const [custom, setCustom] = useState(() => ({ from: toDateInput(timestamp() - 7 * 86_400_000), to: toDateInput(timestamp()) }));
  const [customError, setCustomError] = useState<string | null>(null);

  const usage = useQuery(llmUsageQuery(workspace.id, window.from, window.to));
  const agents = useQuery({ ...allAgentsQuery(workspace.id), enabled: can.browseAgents });
  const agentNames = new Map((agents.data?.items ?? []).map((agent) => [agent.id, agent.name]));

  const choose = (next: UsageWindowKey) => {
    setKey(next);
    if (next !== 'custom') {
      setCustomError(null);
      setWindow(presetWindow(next, timestamp()));
    }
  };
  const applyCustom = () => {
    const result = customWindow(custom.from, custom.to);
    setCustomError(result.error);
    if (result.window) setWindow(result.window);
  };

  const data = usage.data;

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Usage"
        description="All model calls in this workspace: agent conversations, direct chat and workflows. Counts include calls that were refused or throttled."
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <Segmented
          aria-label="Time window"
          value={key}
          onValueChange={choose}
          options={[...USAGE_WINDOWS.map((preset) => ({ value: preset.key, label: preset.label.replace('Last ', '') })), { value: 'custom', label: 'Custom' }]}
        />
        {key === 'custom' ? (
          <form
            className="flex flex-wrap items-end gap-2"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              applyCustom();
            }}
          >
            <label className="grid gap-1 text-[12px] text-muted">
              From
              <Input type="date" value={custom.from} onChange={(event) => setCustom((current) => ({ ...current, from: event.target.value }))} inputClassName="h-9" />
            </label>
            <label className="grid gap-1 text-[12px] text-muted">
              To
              <Input type="date" value={custom.to} onChange={(event) => setCustom((current) => ({ ...current, to: event.target.value }))} inputClassName="h-9" />
            </label>
            <Button type="submit" size="sm" variant="secondary">
              Show
            </Button>
          </form>
        ) : null}
        <p className="text-[12.5px] text-muted lg:ml-auto">
          {formatDateTime(window.from)} – {formatDateTime(window.to)}
        </p>
      </div>
      {customError ? (
        <p className="-mt-3 text-[13px] text-danger-700" role="alert">
          {customError}
        </p>
      ) : null}

      {usage.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-28 rounded-xl" />
          ))}
          <Skeleton className="h-64 rounded-xl sm:col-span-2 xl:col-span-4" />
        </div>
      ) : usage.isError && !data ? (
        <Card>
          <ErrorState error={usage.error} title="We couldn't load usage" onRetry={() => void usage.refetch()} retrying={usage.isFetching} />
        </Card>
      ) : data ? (
        <div className={cn('grid grid-cols-1 gap-6', usage.isPlaceholderData && 'opacity-60 transition-opacity')}>
          <Tiles data={data} />
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <Outcomes data={data} />
            <Masking data={data} />
          </div>
          <ByModel data={data} />
          <ByAgent data={data} name={(id) => agentNames.get(id)} />
        </div>
      ) : null}
    </div>
  );
}

function Tile({ label, value, sub, hint }: { label: string; value: ReactNode; sub?: ReactNode; hint?: string }) {
  return (
    <Card className="px-5 py-4">
      <p className="flex items-center gap-1.5 text-[12.5px] text-muted">
        {label}
        {hint ? (
          <Tooltip content={hint}>
            <button type="button" className="rounded text-faint hover:text-ink" aria-label={`About ${label}`}>
              <Info className="size-3.5" />
            </button>
          </Tooltip>
        ) : null}
      </p>
      <p className="mt-1.5 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink tabular">{value}</p>
      {sub ? <p className="mt-1 text-[12.5px] text-muted">{sub}</p> : null}
    </Card>
  );
}

function Tiles({ data }: { data: UsageSummary }) {
  const { totals, latencyMs } = data;
  const tokens = totals.promptTokens + totals.completionTokens;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tile
        label="Model calls"
        value={totals.invocations.toLocaleString()}
        sub={totals.invocations ? `${formatShare(totals.completed / totals.invocations)} completed` : 'None in this window'}
      />
      <Tile
        label="Tokens"
        value={compactNumber(tokens)}
        sub={`${totals.promptTokens.toLocaleString()} in · ${totals.completionTokens.toLocaleString()} out`}
        hint={totals.estimatedTokenCounts ? `${pluralize(totals.estimatedTokenCounts, 'call')} had their tokens estimated: the endpoint didn't report counts.` : undefined}
      />
      <Tile label="Answer time (median)" value={formatMs(latencyMs.totalP50)} sub={`95th percentile ${formatMs(latencyMs.totalP95)}`} />
      <Tile label="Time to first token (median)" value={formatMs(latencyMs.timeToFirstTokenP50)} sub={`95th percentile ${formatMs(latencyMs.timeToFirstTokenP95)}`} />
    </div>
  );
}

const OUTCOME_STYLE: Readonly<Record<Outcome, { bar: string; icon: LucideIcon; text: string }>> = {
  completed: { bar: 'bg-success-500', icon: CircleCheck, text: 'text-success-700' },
  cancelled: { bar: 'bg-line-strong', icon: Square, text: 'text-ink-soft' },
  throttled: { bar: 'bg-warning-500', icon: Hourglass, text: 'text-warning-700' },
  refused: { bar: 'bg-info-500', icon: ShieldAlert, text: 'text-info-700' },
  blocked: { bar: 'bg-[#7a5aa6]', icon: ShieldX, text: 'text-[#523c6e]' },
  failed: { bar: 'bg-danger-500', icon: CircleX, text: 'text-danger-700' },
};

/** Outcomes as one part-to-whole bar, with a labelled legend: never colour alone. */
function Outcomes({ data }: { data: UsageSummary }) {
  const shares = outcomeShares(data.totals);
  const total = data.totals.invocations;
  return (
    <Card>
      <CardHeader title="Outcomes" icon={<Gauge />} description="How every call ended." />
      <CardBody className="grid gap-4">
        {total === 0 ? (
          <div className="h-3 rounded-full bg-well-strong" aria-label="No calls in this window" role="img" />
        ) : (
          <div className="flex h-3 gap-[2px]" role="img" aria-label={shares.filter((s) => s.count).map((s) => `${s.key} ${s.count}`).join(', ')}>
            {shares
              .filter((share) => share.count > 0)
              .map((share) => {
                const meta = OUTCOMES.find((outcome) => outcome.key === share.key)!;
                return (
                  <Tooltip key={share.key} content={`${meta.label}: ${share.count.toLocaleString()} (${formatShare(share.share)})`}>
                    <span
                      tabIndex={0}
                      className={cn('h-full min-w-[4px] rounded-[4px] outline-offset-2', OUTCOME_STYLE[share.key].bar)}
                      style={{ flexGrow: share.count, flexBasis: 0 }}
                    />
                  </Tooltip>
                );
              })}
          </div>
        )}
        <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {OUTCOMES.map((outcome) => {
            const style = OUTCOME_STYLE[outcome.key];
            const Icon = style.icon;
            const count = data.totals[outcome.key];
            return (
              <li key={outcome.key} className="flex items-start gap-2.5">
                <span className={cn('mt-1.5 size-2.5 shrink-0 rounded-[3px]', style.bar)} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                      <Icon className={cn('size-3.5', style.text)} aria-hidden />
                      {outcome.label}
                    </span>
                    <span className="font-mono text-ink-soft tabular">{count.toLocaleString()}</span>
                  </p>
                  <p className="text-[12px] leading-snug text-muted">{outcome.description}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

function Masking({ data }: { data: UsageSummary }) {
  const { redactionOverhead: overhead, totals } = data;
  const share = overhead.shareOfTotal;
  return (
    <Card>
      <CardHeader title="Personal-data masking" icon={<ShieldAlert />} description="What protecting personal data costs, per call." />
      <CardBody className="grid gap-4">
        <dl className="grid grid-cols-3 gap-3">
          {(
            [
              ['Median', overhead.p50Ms],
              ['95th', overhead.p95Ms],
              ['99th', overhead.p99Ms],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-lg border border-line bg-well/30 px-3 py-2">
              <dt className="text-[12px] text-muted">{label}</dt>
              <dd className="font-mono text-[15px] font-semibold text-ink tabular">{formatMs(value)}</dd>
            </div>
          ))}
        </dl>
        <div className="grid gap-1.5">
          <p className="flex items-center justify-between text-[12.5px]">
            <span className="text-muted">Share of total answer time</span>
            <span className="font-mono text-ink tabular">{formatShare(share)}</span>
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-well-strong" aria-hidden>
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${share === null ? 0 : Math.min(100, share * 100)}%` }} />
          </div>
        </div>
        <dl className="divide-y divide-line/70 text-[13px]">
          <div className="flex justify-between py-2">
            <dt className="text-muted">Personal details masked</dt>
            <dd className="font-mono tabular">{totals.entitiesMasked.toLocaleString()}</dd>
          </div>
          <div className="flex justify-between py-2">
            <dt className="text-muted">Calls masked without name detection</dt>
            <dd className={cn('font-mono tabular', totals.degradedRedactions ? 'text-warning-700' : null)}>{totals.degradedRedactions.toLocaleString()}</dd>
          </div>
        </dl>
      </CardBody>
    </Card>
  );
}

function InlineBar({ value, max }: { value: number; max: number }) {
  return (
    <span className="block h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-well-strong" aria-hidden>
      <span className="block h-full rounded-full bg-brand-500" style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%` }} />
    </span>
  );
}

function ByModel({ data }: { data: UsageSummary }) {
  const max = Math.max(0, ...data.byModel.map((row) => row.invocations));
  return (
    <Card className="overflow-hidden">
      <CardHeader title="By model" description={data.byModel.length >= 20 ? 'The 20 busiest models.' : undefined} />
      {data.byModel.length === 0 ? (
        <p className="px-6 pb-6 text-[13px] text-muted">No calls in this window.</p>
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Model</TH>
              <TH className="w-[28%]">Calls</TH>
              <TH className="text-right">Tokens in</TH>
              <TH className="text-right">Tokens out</TH>
              <TH className="text-right">Median time</TH>
            </tr>
          </THead>
          <TBody>
            {data.byModel.map((row) => (
              <TR key={row.model}>
                <TD>
                  <ModelName model={row.model} />
                </TD>
                <TD>
                  <span className="flex items-center gap-2.5">
                    <span className="w-10 shrink-0 text-right font-mono tabular">{row.invocations.toLocaleString()}</span>
                    <InlineBar value={row.invocations} max={max} />
                  </span>
                </TD>
                <TD className="text-right font-mono tabular">{row.promptTokens.toLocaleString()}</TD>
                <TD className="text-right font-mono tabular">{row.completionTokens.toLocaleString()}</TD>
                <TD className="text-right font-mono tabular">{formatMs(row.totalP50Ms)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

function ByAgent({ data, name }: { data: UsageSummary; name: (id: string) => string | undefined }) {
  const max = Math.max(0, ...data.byAgent.map((row) => row.invocations));
  return (
    <Card className="overflow-hidden">
      <CardHeader title="By agent" description={data.byAgent.length >= 20 ? 'The 20 busiest agents.' : 'Direct chat is the playground and API calls without an agent.'} />
      {data.byAgent.length === 0 ? (
        <p className="px-6 pb-6 text-[13px] text-muted">No calls in this window.</p>
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Agent</TH>
              <TH className="w-[28%]">Calls</TH>
              <TH className="text-right">Tokens in</TH>
              <TH className="text-right">Tokens out</TH>
            </tr>
          </THead>
          <TBody>
            {data.byAgent.map((row) => {
              const known = row.agentId ? name(row.agentId) : undefined;
              return (
                <TR key={row.agentId ?? 'direct'}>
                  <TD>
                    {row.agentId === null ? (
                      <span className="inline-flex items-center gap-1.5 text-ink-soft">
                        <FlaskConical className="size-3.5 text-faint" aria-hidden />
                        Direct chat
                      </span>
                    ) : known ? (
                      <span className="text-ink">{known}</span>
                    ) : (
                      <Tooltip content="It was deleted, or it's an agent you can't see.">
                        <span tabIndex={0} className="text-muted italic">
                          Deleted agent
                        </span>
                      </Tooltip>
                    )}
                  </TD>
                  <TD>
                    <span className="flex items-center gap-2.5">
                      <span className="w-10 shrink-0 text-right font-mono tabular">{row.invocations.toLocaleString()}</span>
                      <InlineBar value={row.invocations} max={max} />
                    </span>
                  </TD>
                  <TD className="text-right font-mono tabular">{row.promptTokens.toLocaleString()}</TD>
                  <TD className="text-right font-mono tabular">{row.completionTokens.toLocaleString()}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
