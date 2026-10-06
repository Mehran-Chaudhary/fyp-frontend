import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, Copy, History, RotateCcw, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Pagination } from '@/components/ui/pagination';
import { RelativeTime } from '@/components/ui/relative-time';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { agentsApi } from '@/lib/api/endpoints';
import { hasCode, isOutcomeUnknown } from '@/lib/api/errors';
import type { AgentVersion } from '@/lib/api/types';
import { AGENT_LIMITS } from '@/lib/agents/agent-form';
import { afterAgentSaved } from '@/lib/agents/cache';
import { configRows, diffConfigs, identicalTo, lineDiff, type ConfigRow } from '@/lib/agents/versions';
import { messageFor } from '@/lib/errors';
import { agentVersionQuery, agentVersionsQuery, memberNamesQuery, queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast } from '@/lib/toast';
import { cn, formatDateTime, pluralize } from '@/lib/utils';
import { useKnowledgeBases } from '@/features/knowledge/shared/use-knowledge-access';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { useAgentCan } from '../shared/use-agent-can';
import { useAgentOutlet } from './agent-context';

type View = 'config' | 'compare';

/** Version history (§4.2, §5.3; P4-API-08/09/10). Append-only: restoring adds a copy. */
export function AgentVersionsTab() {
  const { agent } = useAgentOutlet();
  const workspace = useWorkspace();
  const can = useAgentCan();
  const [params, setParams] = useSearchParams();
  const pageParam = Number.parseInt(params.get('page') ?? '', 10);
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const selectedParam = Number.parseInt(params.get('v') ?? '', 10);
  const selected = Number.isInteger(selectedParam) && selectedParam > 0 ? selectedParam : agent.currentVersion;
  const view: View = params.get('view') === 'compare' ? 'compare' : 'config';

  const write = (patch: Record<string, string | null>) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true, preventScrollReset: true },
    );

  const versions = useQuery(agentVersionsQuery(workspace.id, agent.id, page));
  const names = useQuery({ ...memberNamesQuery(workspace.id), enabled: can.readMembers });
  const items = versions.data?.items ?? [];

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <Card className="min-w-0 overflow-hidden">
        <CardHeader title="History" icon={<History />} description={`Newest first. Version ${agent.currentVersion} is in use.`} />
        {versions.isPending ? (
          <div className="grid gap-2 px-5 pb-5">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : versions.isError && !versions.data ? (
          <ErrorState compact error={versions.error} title="We couldn't load the history" onRetry={() => void versions.refetch()} retrying={versions.isFetching} />
        ) : items.length === 0 ? (
          <EmptyState icon={<History />} title="No versions" />
        ) : (
          <ol className={cn('border-t border-line', versions.isPlaceholderData && 'opacity-60')}>
            {items.map((version) => {
              const twin = identicalTo(version, items);
              const author = version.createdById ? names.data?.get(version.createdById)?.name : undefined;
              const active = version.version === selected;
              return (
                <li key={version.version} className="border-b border-line/70 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => write({ v: String(version.version) })}
                    aria-current={active ? 'true' : undefined}
                    className={cn('grid w-full gap-1 px-5 py-3 text-left transition-colors', active ? 'bg-brand-50/70' : 'hover:bg-well/50')}
                  >
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className={cn('font-mono text-[13px] font-semibold', active ? 'text-brand-800' : 'text-ink')}>v{version.version}</span>
                      {version.isCurrent ? <Badge tone="brand">Current</Badge> : null}
                      {version.restoredFromVersion ? (
                        <Badge tone="outline">
                          <Undo2 />
                          Restored from v{version.restoredFromVersion}
                        </Badge>
                      ) : null}
                      {twin && !version.restoredFromVersion ? (
                        <Badge tone="outline">
                          <Copy />
                          Identical to v{twin}
                        </Badge>
                      ) : null}
                    </span>
                    <span className={cn('line-clamp-2 text-[13px]', version.changeNote ? 'text-ink-soft' : 'text-faint')}>
                      {version.changeNote ?? (version.version === 1 ? 'First version.' : 'No change note.')}
                    </span>
                    <span className="text-[12px] text-muted">
                      <RelativeTime value={version.createdAt} />
                      {author ? ` · ${author}` : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {versions.data && versions.data.pagination.totalPages > 1 ? (
          <Pagination
            className="border-t border-line px-5 py-3"
            pagination={versions.data.pagination}
            onPageChange={(next) => write({ page: next > 1 ? String(next) : null })}
            busy={versions.isFetching}
            noun={['version', 'versions']}
          />
        ) : null}
      </Card>

      <VersionDetail
        key={selected}
        version={selected}
        fromPage={items.find((item) => item.version === selected)}
        view={view}
        onView={(next) => write({ view: next === 'config' ? null : next })}
        compareWith={Number.parseInt(params.get('with') ?? '', 10) || null}
        onCompareWith={(value) => write({ with: value ? String(value) : null })}
        onRestored={(version) => write({ v: String(version), view: null, with: null, page: null })}
      />
    </div>
  );
}

function VersionDetail({
  version,
  fromPage,
  view,
  onView,
  compareWith,
  onCompareWith,
  onRestored,
}: {
  version: number;
  fromPage: AgentVersion | undefined;
  view: View;
  onView: (view: View) => void;
  compareWith: number | null;
  onCompareWith: (version: number | null) => void;
  onRestored: (version: number) => void;
}) {
  const { agent } = useAgentOutlet();
  const workspace = useWorkspace();
  const can = useAgentCan();
  const knowledgeBases = useKnowledgeBases();
  const names = useQuery({ ...memberNamesQuery(workspace.id), enabled: can.readMembers });
  const detail = useQuery({ ...agentVersionQuery(workspace.id, agent.id, version), initialData: fromPage, enabled: !fromPage });
  const data = fromPage ?? detail.data;
  // Compare with the current version, or with the previous one when this is current.
  const other = compareWith && compareWith !== version ? compareWith : version === agent.currentVersion ? Math.max(1, version - 1) : agent.currentVersion;
  const otherQuery = useQuery({ ...agentVersionQuery(workspace.id, agent.id, other), enabled: view === 'compare' && other !== version });
  const [restoring, setRestoring] = useState(false);
  const [note, setNote] = useState('');
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const labels = { knowledgeBaseName: (id: string) => knowledgeBases.byId.get(id)?.name };

  const restore = useMutation({
    mutationFn: () =>
      agentsApi.restore(workspace.id, agent.id, version, {
        expectedVersion: agent.currentVersion,
        ...(note.trim() ? { changeNote: note.trim() } : {}),
      }),
    onSuccess: (restored) => {
      void afterAgentSaved(workspace.id, restored, agent.currentVersion);
      setRestoring(false);
      setNote('');
      toast.success(`Restored as version ${restored.currentVersion}`, { description: `A copy of version ${version}. History is kept.` });
      onRestored(restored.currentVersion);
    },
    onError: (error) => {
      if (hasCode(error, 'AGENT_VERSION_CONFLICT')) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.agentDetail(workspace.id, agent.id) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.agentVersions(workspace.id, agent.id) });
        setRestoreError('Someone saved a new version a moment ago. The history has been refreshed; check it before restoring.');
      } else if (hasCode(error, 'AGENT_VERSION_NOT_FOUND')) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.agentVersions(workspace.id, agent.id) });
        setRestoreError(messageFor(error));
      } else if (hasCode(error, 'LLM_MODEL_NOT_ALLOWED')) {
        setRestoreError("This version uses a model that isn't allowed in the workspace any more. Restore it, then choose another model, by editing instead.");
      } else if (isOutcomeUnknown(error)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.agentDetail(workspace.id, agent.id) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.agentVersions(workspace.id, agent.id) });
        setRestoreError(`${messageFor(error)} Check the history before trying again: it may have been restored.`);
      } else {
        setRestoreError(messageFor(error));
      }
    },
  });

  if (!data) {
    return (
      <Card>
        {detail.isError ? (
          hasCode(detail.error, 'AGENT_VERSION_NOT_FOUND', 'BAD_REQUEST') ? (
            <EmptyState icon={<History />} title={`There's no version ${version}`} description="Pick one from the history." />
          ) : (
            <ErrorState error={detail.error} onRetry={() => void detail.refetch()} retrying={detail.isFetching} />
          )
        ) : (
          <div className="grid gap-3 p-6">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}
      </Card>
    );
  }

  const author = data.createdById ? names.data?.get(data.createdById)?.name : undefined;
  const isCurrent = version === agent.currentVersion;
  const rows = configRows(data.config, labels);

  return (
    <Card className="min-w-0">
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Version {data.version}
            {isCurrent ? <Badge tone="brand">Current</Badge> : null}
          </span>
        }
        description={
          <>
            {formatDateTime(data.createdAt)}
            {author ? ` by ${author}` : null}
            {data.changeNote ? <span className="mt-1 block text-ink-soft">“{data.changeNote}”</span> : null}
          </>
        }
        actions={
          can.manageAgents && !isCurrent ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setRestoreError(null);
                setRestoring(true);
              }}
            >
              <RotateCcw />
              Restore
            </Button>
          ) : null
        }
      />
      <CardBody className="grid gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            aria-label="View"
            value={view}
            onValueChange={onView}
            options={[
              { value: 'config', label: 'Configuration' },
              { value: 'compare', label: 'Compare' },
            ]}
          />
          {view === 'compare' ? (
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <ArrowLeftRight className="size-3.5" aria-hidden />
              with
              <Select
                size="sm"
                aria-label="Compare with version"
                className="w-40"
                value={String(other)}
                onValueChange={(value) => onCompareWith(Number(value))}
                options={Array.from({ length: agent.currentVersion }, (_, index) => agent.currentVersion - index)
                  .filter((candidate) => candidate !== version)
                  .map((candidate) => ({ value: String(candidate), label: `v${candidate}${candidate === agent.currentVersion ? ' (current)' : ''}` }))}
              />
            </div>
          ) : null}
        </div>

        {view === 'config' ? (
          <>
            <ConfigTable rows={rows} />
            <div>
              <h3 className="mb-1.5 text-[12px] font-medium tracking-[0.06em] text-faint uppercase">Instructions</h3>
              {data.instructions.trim() ? (
                <pre className="scrollbar-thin max-h-96 overflow-auto rounded-lg border border-line bg-[#faf9f6] px-4 py-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink-soft">
                  {data.instructions}
                </pre>
              ) : (
                <p className="text-[13px] text-faint">None.</p>
              )}
            </div>
            <p className="font-mono text-[11px] break-all text-faint">Digest {data.configDigest}</p>
          </>
        ) : other === version ? (
          <p className="text-[13px] text-muted">There's only one version, so there's nothing to compare yet.</p>
        ) : otherQuery.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : otherQuery.isError ? (
          <ErrorState compact error={otherQuery.error} onRetry={() => void otherQuery.refetch()} retrying={otherQuery.isFetching} />
        ) : (
          <Compare older={other < version ? otherQuery.data : data} newer={other < version ? data : otherQuery.data} labels={labels} />
        )}
      </CardBody>

      <ConfirmDialog
        open={restoring}
        onOpenChange={(open) => {
          if (!open) setRestoring(false);
        }}
        icon={<RotateCcw />}
        title={`Restore version ${version}?`}
        description={`This adds version ${agent.currentVersion + 1}, identical to version ${version}. History is kept: nothing is deleted.`}
        confirmLabel={`Restore as v${agent.currentVersion + 1}`}
        onConfirm={() => restore.mutate()}
        pending={restore.isPending}
        error={restoreError}
      >
        <Field label="Change note" optional hint={`Defaults to “Restored version ${version}.”`}>
          <Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={AGENT_LIMITS.changeNote} placeholder={`Restored version ${version}.`} />
        </Field>
      </ConfirmDialog>
    </Card>
  );
}

function ConfigTable({ rows }: { rows: ConfigRow[] }) {
  const sections = Array.from(new Set(rows.map((row) => row.section)));
  return (
    <div className="grid gap-4">
      {sections.map((section) => (
        <section key={section}>
          <h3 className="mb-1 text-[12px] font-medium tracking-[0.06em] text-faint uppercase">{section}</h3>
          <dl className="divide-y divide-line/70">
            {rows
              .filter((row) => row.section === section)
              .map((row) => (
                <div key={row.key} className="grid gap-1 py-1.5 text-[13px] sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
                  <dt className="text-muted">{row.label}</dt>
                  <dd className="min-w-0 break-words text-ink-soft">{row.value}</dd>
                </div>
              ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function Compare({
  older,
  newer,
  labels,
}: {
  older: AgentVersion;
  newer: AgentVersion;
  labels: { knowledgeBaseName: (id: string) => string | undefined };
}) {
  if (older.configDigest === newer.configDigest) {
    return (
      <p className="rounded-lg border border-line bg-well/50 px-3.5 py-3 text-[13px] text-ink-soft">
        Versions {older.version} and {newer.version} are identical (same digest): they behave exactly the same.
      </p>
    );
  }
  const changes = diffConfigs(older.config, newer.config, labels);
  const instructions = older.instructions === newer.instructions ? null : lineDiff(older.instructions, newer.instructions);
  return (
    <div className="grid gap-5">
      <p className="text-[13px] text-muted">
        From <span className="font-mono text-ink-soft">v{older.version}</span> to <span className="font-mono text-ink-soft">v{newer.version}</span>:{' '}
        {pluralize(changes.length + (instructions ? 1 : 0), 'change')}.
      </p>
      {changes.length ? (
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full table-fixed border-collapse text-left text-[12.5px]">
            <thead className="bg-well/50 text-muted">
              <tr>
                <th scope="col" className="w-[30%] px-3 py-2 font-medium">Setting</th>
                <th scope="col" className="px-3 py-2 font-medium">v{older.version}</th>
                <th scope="col" className="px-3 py-2 font-medium">v{newer.version}</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((row) => (
                <tr key={row.key} className="border-t border-line/70 align-top">
                  <th scope="row" className="px-3 py-2 font-normal text-muted">
                    {row.section} · {row.label}
                  </th>
                  <td className="px-3 py-2 break-words text-danger-700 line-through decoration-danger-200">{row.before}</td>
                  <td className="px-3 py-2 break-words text-success-700">{row.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {instructions ? (
        <div>
          <h3 className="mb-1.5 text-[12px] font-medium tracking-[0.06em] text-faint uppercase">Instructions</h3>
          <pre className="scrollbar-thin max-h-96 overflow-auto rounded-lg border border-line bg-[#faf9f6] py-2 font-mono text-[12px] leading-relaxed">
            {instructions.map((line, index) => (
              <div
                key={index}
                className={cn(
                  'px-3 whitespace-pre-wrap',
                  line.type === 'add' && 'bg-success-50 text-success-700',
                  line.type === 'del' && 'bg-danger-50 text-danger-700',
                  line.type === 'same' && 'text-muted',
                )}
              >
                <span className="mr-2 inline-block w-3 select-none" aria-hidden>
                  {line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}
                </span>
                <span className="sr-only">{line.type === 'add' ? 'Added: ' : line.type === 'del' ? 'Removed: ' : ''}</span>
                {line.text || ' '}
              </div>
            ))}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
