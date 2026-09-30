import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Settings2, ShieldCheck, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Outlet, useParams } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { TabNav, type TabNavItem } from '@/components/ui/tab-nav';
import { Tooltip } from '@/components/ui/tooltip';
import { hasCode } from '@/lib/api/errors';
import { formatBytes } from '@/lib/knowledge/files';
import { useDocumentTitle } from '@/lib/hooks';
import { knowledgeBaseQuery, queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { cn, formatDate } from '@/lib/utils';
import { isUuid } from '@/features/team/member-helpers';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { AccessLevelBadge, AccessModeBadge, ClassificationBadge } from '../shared/badges';
import { knowledgeBaseColor } from '../shared/meta';
import { KnowledgeLayerBanner, NotAvailableState } from '../shared/states';
import { useKnowledgeAccess, useLayerGap } from '../shared/use-knowledge-access';
import { UploadDialog } from '../upload/upload-dialog';
import { findCachedKnowledgeBase, type KnowledgeBaseOutletContext } from './kb-context';

/** A knowledge base: its header, Settings (§6.6) and Access (§6.7) tabs. */
export function KnowledgeBaseLayout() {
  const workspace = useWorkspace();
  const can = useCan();
  const { knowledgeBaseId = '' } = useParams();

  if (!can('knowledgebase:read')) {
    return (
      <Card>
        <NoAccessState permissions={['knowledgebase:read']} workspaceName={workspace.name} />
      </Card>
    );
  }
  return <Loaded key={knowledgeBaseId} knowledgeBaseId={knowledgeBaseId} />;
}

function Loaded({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const workspace = useWorkspace();
  const access = useKnowledgeAccess();
  const layer = useLayerGap();
  const valid = isUuid(knowledgeBaseId);
  const query = useQuery({
    ...knowledgeBaseQuery(workspace.id, knowledgeBaseId),
    enabled: valid,
    placeholderData: () => findCachedKnowledgeBase(workspace.id, knowledgeBaseId),
  });
  const knowledgeBase = query.data;
  useDocumentTitle(knowledgeBase?.name ?? 'Knowledge base');
  const [upload, setUpload] = useState<{ open: boolean; files: File[] }>({ open: false, files: [] });

  const gone = !valid || hasCode(query.error, 'KNOWLEDGE_BASE_NOT_FOUND');
  useEffect(() => {
    if (gone && valid) void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBases(workspace.id) });
  }, [gone, valid, workspace.id]);

  const back = (
    <Link
      to={`/w/${workspace.slug}/knowledge-bases`}
      className="inline-flex w-fit items-center gap-1.5 rounded-md text-[13px] font-medium text-muted hover:text-ink"
    >
      <ArrowLeft className="size-3.5" />
      Knowledge bases
    </Link>
  );

  if (gone) {
    return (
      <div className="grid gap-6">
        {back}
        <Card>
          <NotAvailableState
            kind="knowledge base"
            action={
              <Button asChild variant="secondary" size="sm">
                <Link to={`/w/${workspace.slug}/knowledge-bases`}>Back to knowledge bases</Link>
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  if (!knowledgeBase) {
    return (
      <div className="grid gap-6">
        {back}
        {query.isError ? (
          <Card>
            <ErrorState error={query.error} title="We couldn't load this knowledge base" onRetry={() => void query.refetch()} retrying={query.isFetching} />
          </Card>
        ) : (
          <div className="grid gap-4">
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-4 w-96 max-w-full" />
            <Skeleton className="mt-4 h-64 w-full rounded-xl" />
          </div>
        )}
      </div>
    );
  }

  const base = `/w/${workspace.slug}/knowledge-bases/${knowledgeBase.id}`;
  const tabs: TabNavItem[] = [{ to: base, label: 'Settings', icon: Settings2, isActive: (path) => path === base }];
  if (!access.lacks('viewGrants')) tabs.push({ to: `${base}/access`, label: 'Access', icon: ShieldCheck });

  const canUpload = access.can('upload', knowledgeBase);
  const uploadBlocked = layer.blocked('upload');
  const { stats } = knowledgeBase;
  const context: KnowledgeBaseOutletContext = { knowledgeBase };

  return (
    <div className="grid gap-6">
      {back}
      <header className="relative overflow-hidden rounded-xl border border-line bg-surface px-5 py-5 shadow-card sm:px-6">
        <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: knowledgeBaseColor(knowledgeBase.id) }} aria-hidden />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.015em] break-words text-ink">{knowledgeBase.name}</h1>
              <AccessModeBadge mode={knowledgeBase.accessMode} />
              {knowledgeBase.accessMode === 'RESTRICTED' ? <AccessLevelBadge level={knowledgeBase.access} /> : null}
            </div>
            {knowledgeBase.description ? (
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">{knowledgeBase.description}</p>
            ) : null}
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-muted">
              <Fact label="Documents" value={stats.documents.toLocaleString()} strong />
              <Fact label="Indexed" value={stats.ready.toLocaleString()} />
              <Fact label="Processing" value={stats.processing.toLocaleString()} tone={stats.processing ? 'text-info-700' : undefined} />
              <Fact label="Failed" value={stats.failed.toLocaleString()} tone={stats.failed ? 'text-danger-700' : undefined} />
              <Fact label="Size" value={formatBytes(stats.totalBytes)} />
              <div className="flex items-center gap-1.5">
                <dt>Default</dt>
                <dd>
                  <ClassificationBadge classification={knowledgeBase.defaultClassification} />
                </dd>
              </div>
              <Fact label="Created" value={formatDate(knowledgeBase.createdAt)} plain />
            </dl>
            <p className="mt-2 text-xs text-faint">Counts cover the documents within your clearance.</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link to={`/w/${workspace.slug}/documents?kb=${knowledgeBase.id}`}>
                View documents
                <ArrowRight />
              </Link>
            </Button>
            {canUpload ? (
              <Tooltip content={uploadBlocked ? "Uploads aren't set up on this server yet" : undefined} disabled={!uploadBlocked}>
                <span tabIndex={uploadBlocked ? 0 : -1} className="inline-flex rounded-lg">
                  <Button onClick={() => setUpload({ open: true, files: [] })} disabled={uploadBlocked}>
                    <Upload />
                    Upload
                  </Button>
                </span>
              </Tooltip>
            ) : null}
          </div>
        </div>
      </header>

      <KnowledgeLayerBanner />

      <div className="grid gap-6">
        <TabNav items={tabs} aria-label="Knowledge base sections" className="-mt-1" />
        <Outlet context={context} />
      </div>

      {canUpload ? (
        <UploadDialog
          open={upload.open}
          onOpenChange={(open) => setUpload((current) => ({ ...current, open }))}
          files={upload.files}
          onFilesChange={(files) => setUpload((current) => ({ ...current, files }))}
          defaultKnowledgeBaseId={knowledgeBase.id}
        />
      ) : null}
    </div>
  );
}

function Fact({ label, value, strong, tone, plain }: { label: string; value: string; strong?: boolean; tone?: string; plain?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt>{label}</dt>
      <dd className={cn(plain ? null : 'font-mono tabular', strong ? 'font-semibold text-ink' : 'text-ink-soft', tone)}>{value}</dd>
    </div>
  );
}
