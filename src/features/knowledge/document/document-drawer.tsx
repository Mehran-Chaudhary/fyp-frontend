import { useQuery } from '@tanstack/react-query';
import { FileSearch, LayoutList, ScanEye } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/misc';
import { TabNav, type TabNavItem } from '@/components/ui/tab-nav';
import { hasCode } from '@/lib/api/errors';
import { afterDocumentGone } from '@/lib/knowledge/cache';
import { useDocumentTitle } from '@/lib/hooks';
import { documentQuery, knowledgeBaseQuery } from '@/lib/queries';
import { isUuid } from '@/features/team/member-helpers';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { AccessLevelBadge, ClassificationBadge, DocumentStatusBadge } from '../shared/badges';
import { FileGlyph } from '../shared/file-glyph';
import { KnowledgeBaseName } from '../shared/kb-identity';
import { NotAvailableState } from '../shared/states';
import { useKnowledgeAccess, useKnowledgeBases } from '../shared/use-knowledge-access';
import { useSettleWatcher } from '../shared/use-settle-watcher';
import { findCachedDocument, type DocumentOutletContext } from './document-context';

/**
 * Document detail (§6.4): a drawer over the vault with its own URL, so it can be
 * linked to and the vault keeps its filters. Polled while the document processes.
 */
export function DocumentDrawer() {
  const { documentId = '' } = useParams();
  const workspace = useWorkspace();
  const access = useKnowledgeAccess();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(true);
  const valid = isUuid(documentId);

  const query = useQuery({
    ...documentQuery(workspace.id, documentId),
    enabled: valid,
    placeholderData: () => findCachedDocument(workspace.id, documentId),
  });
  const document = query.data;
  const watched = useMemo(() => (document ? [document] : undefined), [document]);
  useSettleWatcher(watched);
  useDocumentTitle(document?.title ?? 'Document');

  // The base, from the shared list, or on its own when the list hasn't got it.
  const knowledgeBases = useKnowledgeBases();
  const listed = document ? knowledgeBases.byId.get(document.knowledgeBaseId) : undefined;
  const single = useQuery({
    ...knowledgeBaseQuery(workspace.id, document?.knowledgeBaseId ?? ''),
    enabled: !!document && !listed && !knowledgeBases.isPending && access.has('knowledgebase:read'),
  });
  const knowledgeBase = listed ?? single.data;

  const gone = !valid || hasCode(query.error, 'DOCUMENT_NOT_FOUND');
  useEffect(() => {
    // Deleted, or reclassified above your clearance: drop it from the lists too.
    if (gone && valid) void afterDocumentGone(workspace.id, documentId);
  }, [gone, valid, workspace.id, documentId]);

  const vault = { pathname: `/w/${workspace.slug}/documents`, search: location.search };
  const close = () => {
    setOpen(false);
    // Let the slide-out finish before the route (and the drawer) goes away.
    window.setTimeout(() => void navigate(vault, { preventScrollReset: true }), 170);
  };

  const base = `/w/${workspace.slug}/documents/${documentId}`;
  const tabs: TabNavItem[] = [
    { to: base, label: 'Overview', icon: LayoutList, isActive: (path) => path === base },
    { to: `${base}/chunks`, label: 'Chunks', icon: FileSearch },
  ];
  if (!access.lacks('piiReport')) tabs.push({ to: `${base}/pii`, label: 'PII report', icon: ScanEye });

  const context: DocumentOutletContext | null = document ? { document, knowledgeBase, close } : null;

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => (next ? undefined : close())}
      title={document?.title ?? 'Document'}
      className="w-[min(46rem,100vw)]"
      headerExtra={
        document ? (
          <div className="flex items-start gap-3.5">
            <FileGlyph type={document.fileType} size="lg" />
            <div className="min-w-0">
              <p className="text-base leading-6 font-semibold break-words text-ink">{document.title}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <ClassificationBadge classification={document.classification} withTooltip />
                <DocumentStatusBadge document={document} />
                {knowledgeBase ? (
                  <span className="ml-1 inline-flex min-w-0 items-center gap-1.5 text-xs text-muted">
                    in <KnowledgeBaseName knowledgeBase={knowledgeBase} className="font-medium text-ink-soft" />
                    {knowledgeBase.accessMode === 'RESTRICTED' ? <AccessLevelBadge level={knowledgeBase.access} /> : null}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        ) : gone || query.isError ? (
          <p className="text-base leading-6 font-semibold text-ink">Document</p>
        ) : (
          <div className="flex items-center gap-3.5">
            <Skeleton className="h-11 w-9 rounded-md" />
            <div className="grid gap-2">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
        )
      }
    >
      {gone ? (
        <NotAvailableState
          kind="document"
          action={
            <Button variant="secondary" size="sm" onClick={close}>
              Back to the vault
            </Button>
          }
        />
      ) : context ? (
        <>
          <div className="sticky top-0 z-10 bg-surface/95 px-5 backdrop-blur-sm sm:px-6">
            <TabNav items={tabs} keepSearch aria-label="Document sections" />
          </div>
          <Outlet context={context} />
        </>
      ) : query.isError ? (
        <ErrorState error={query.error} title="We couldn't load this document" onRetry={() => void query.refetch()} retrying={query.isFetching} />
      ) : (
        <div className="grid gap-6 px-5 py-6 sm:px-6">
          {[0, 1, 2].map((section) => (
            <div key={section} className="grid gap-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-5/6" />
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}
