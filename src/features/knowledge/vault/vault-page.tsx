import { useQuery } from '@tanstack/react-query';
import { Database, FolderCog, Info, Lock, RotateCcw, Search, SearchX, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useMatches, useNavigate, useSearchParams } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { EmptyState, PageHeader } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
import { Tooltip } from '@/components/ui/tooltip';
import { useDialogTarget } from '@/components/ui/use-dialog-target';
import { hasCode } from '@/lib/api/errors';
import type { VaultDocument } from '@/lib/api/types';
import { MAX_FILES_PER_DROP } from '@/lib/knowledge/files';
import {
  hasActiveFilters,
  readVaultFilters,
  toDocumentListParams,
  writeVaultFilters,
  type VaultFilters,
} from '@/lib/knowledge/filters';
import { statusGroupOf } from '@/lib/knowledge/status';
import { useDocumentTitle } from '@/lib/hooks';
import { documentsQuery, queryKeys, workspaceDetailsQuery } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast } from '@/lib/toast';
import { cn, pluralize } from '@/lib/utils';
import { isUuid } from '@/features/team/member-helpers';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { DeleteDocumentDialog, ReclassifyDialog } from '../document/document-dialogs';
import { useDownloadDocument, useReindexDocument } from '../document/document-mutations';
import { handOffQuery } from '../search/handoff';
import { describeRetrievalError, useRetrieval, type RetrievalProblem } from '../search/use-retrieval';
import { ProcessingNotice } from '../shared/processing-notice';
import { KnowledgeLayerBanner } from '../shared/states';
import { useKnowledgeAccess, useKnowledgeBases, useLayerGap } from '../shared/use-knowledge-access';
import { useSettleWatcher } from '../shared/use-settle-watcher';
import { UploadActivity } from '../upload/upload-activity';
import { UploadDialog } from '../upload/upload-dialog';
import { AskResults } from './ask-results';
import { BulkBar } from './bulk-bar';
import { DocumentTable } from './document-table';
import { DropOverlay, DropZone } from './drop-zone';
import { usePageFileDrop } from './use-page-file-drop';
import { PiiPreviewPanel, PipelinePanel, StatsPanel } from './vault-panels';
import { ActiveFilters, VaultToolbar, type SearchMode } from './vault-toolbar';

/** Document Vault (Phase 3 spec §5 "Document Vault", mockup 5). The document drawer renders over it as a child route. */
export function VaultPage() {
  const workspace = useWorkspace();
  const can = useCan();
  useDocumentTitle('Document Vault');

  if (!can.any('knowledgebase:read', 'document:read')) {
    return (
      <Card>
        <NoAccessState permissions={['knowledgebase:read', 'document:read']} workspaceName={workspace.name} />
      </Card>
    );
  }
  return <Vault />;
}

function Vault() {
  const workspace = useWorkspace();
  const can = useCan();
  const access = useKnowledgeAccess();
  const layer = useLayerGap();
  const navigate = useNavigate();
  const location = useLocation();
  const matches = useMatches();
  const [params, setParams] = useSearchParams();
  const filters = readVaultFilters(params);
  const base = `/w/${workspace.slug}`;

  const knowledgeBases = useKnowledgeBases();
  const details = useQuery({ ...workspaceDetailsQuery(workspace.id), enabled: can('workspace:read') });

  // ── Documents (P3-API-10), polled while any row is processing (§9.3) ──
  const validKb = isUuid(filters.kb) ? filters.kb : null;
  const canReadDocuments = access.has('document:read');
  const listParams = toDocumentListParams(filters, validKb);
  const listQuery = documentsQuery(workspace.id, listParams);
  const documents = useQuery({ ...listQuery, enabled: canReadDocuments });
  const items = useMemo(() => documents.data?.items ?? [], [documents.data]);
  useSettleWatcher(documents.data?.items);

  const update = (patch: Partial<VaultFilters>) =>
    setParams((previous) => writeVaultFilters(previous, patch), { replace: true, preventScrollReset: true });

  // A `kb` filter naming a base that answered 404 (or isn't an id): drop it and say so (§5 "Document Vault").
  const kbGone = !!filters.kb && (!validKb || hasCode(documents.error, 'KNOWLEDGE_BASE_NOT_FOUND'));
  useEffect(() => {
    if (!kbGone) return;
    toast.info('That knowledge base no longer exists or you no longer have access to it.', { id: 'vault-kb-gone' });
    void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBases(workspace.id) });
    setParams((previous) => writeVaultFilters(previous, { kb: null }), { replace: true });
  }, [kbGone, setParams, workspace.id]);

  // Past the last page after deletions: go to the last one that exists.
  const pagination = documents.data?.pagination;
  useEffect(() => {
    if (pagination && pagination.totalItems > 0 && filters.page > pagination.totalPages) {
      setParams((previous) => writeVaultFilters(previous, { page: pagination.totalPages }), { replace: true });
    }
  }, [pagination, filters.page, setParams]);

  // ── The document the side panels follow: the open drawer's, else the clicked row ──
  const [activeId, setActiveId] = useState<string | null>(null);
  const drawerId = matches.find((match) => match.params.documentId)?.params.documentId ?? null;
  const focusId = drawerId ?? activeId;
  const activeDocument = items.find((document) => document.id === focusId) ?? null;
  const activeKnowledgeBase = activeDocument ? (knowledgeBases.byId.get(activeDocument.knowledgeBaseId) ?? null) : null;
  const filteredKnowledgeBase = validKb ? (knowledgeBases.byId.get(validKb) ?? null) : null;

  // ── Bulk selection: kept per page of results ──
  const pageKey = JSON.stringify(listParams);
  const [selection, setSelection] = useState<{ key: string; ids: Set<string> }>({ key: pageKey, ids: new Set() });
  const selectedIds = selection.key === pageKey ? selection.ids : new Set<string>();
  const selectedDocuments = items.filter((document) => selectedIds.has(document.id));
  const selectable = !access.lacks('reindex') || !access.lacks('editDocument') || !access.lacks('deleteDocument');
  const setSelected = (ids: Set<string>) => setSelection({ key: pageKey, ids });

  // ── Upload (§5 "Upload") ──
  const uploadable = knowledgeBases.list.filter((knowledgeBase) => access.can('upload', knowledgeBase));
  const canUpload = uploadable.length > 0;
  const uploadBlocked = layer.blocked('upload');
  const [upload, setUpload] = useState<{ open: boolean; files: File[] }>({ open: false, files: [] });
  const addFiles = (files: File[]) => {
    const merged = [...upload.files, ...files];
    if (merged.length > MAX_FILES_PER_DROP) {
      toast.warning(`You can upload at most ${MAX_FILES_PER_DROP} files at a time`, { description: `The first ${MAX_FILES_PER_DROP} were kept.` });
    }
    setUpload({ open: true, files: merged.slice(0, MAX_FILES_PER_DROP) });
  };
  const dragging = usePageFileDrop(canUpload && !uploadBlocked, addFiles);

  // ── Row actions ──
  const reindex = useReindexDocument();
  const downloads = useDownloadDocument();
  const deleteDialog = useDialogTarget<VaultDocument>();
  const reclassifyDialog = useDialogTarget<VaultDocument>();
  const open = (document: VaultDocument, tab?: 'chunks' | 'privacy') => {
    setActiveId(document.id);
    void navigate({ pathname: `${base}/documents/${document.id}${tab ? `/${tab}` : ''}`, search: location.search }, { preventScrollReset: true });
  };

  // ── Ask (§5 "Document Vault"): retrieval over the current knowledge-base filter ──
  const canAsk = !access.lacks('search');
  const [mode, setMode] = useState<SearchMode>('titles');
  const retrieval = useRetrieval();
  const [asked, setAsked] = useState<{ query: string; problem: RetrievalProblem | null } | null>(null);
  const ask = (query: string) => {
    setAsked({ query, problem: null });
    retrieval.mutate(
      { query, knowledgeBaseIds: validKb ? [validKb] : undefined, topK: 8 },
      {
        onError: (error) => {
          const problem = describeRetrievalError(error);
          setAsked({ query, problem });
          if (problem.goneKnowledgeBaseIds?.length) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.ragScope(workspace.id) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBases(workspace.id) });
            update({ kb: null });
          }
        },
      },
    );
  };
  const closeAsk = () => {
    setAsked(null);
    retrieval.cancel();
  };

  const filtered = hasActiveFilters(filters);
  const total = documents.data?.pagination.totalItems;
  const counts = {
    queued: items.filter((document) => statusGroupOf(document.status) === 'queued').length,
    processing: items.filter((document) => statusGroupOf(document.status) === 'processing').length,
    failed: items.filter((document) => document.status === 'FAILED').length,
  };

  const clearFilters = () => update({ kb: null, status: [], classification: null, q: '' });
  const empty = filtered ? (
    <EmptyState
      icon={<SearchX />}
      title="No documents match these filters"
      description={filters.q ? `No titles contain “${filters.q}” with these filters.` : 'Try another status or classification, or clear the filters.'}
      action={
        <Button variant="secondary" size="sm" onClick={clearFilters}>
          <RotateCcw />
          Clear filters
        </Button>
      }
    />
  ) : canUpload ? (
    <EmptyState
      icon={<Upload />}
      title="Your vault is empty"
      description="Drop files here or use Upload documents. PDF, Word, text and Markdown are accepted."
      action={
        <Button size="sm" onClick={() => setUpload({ open: true, files: [] })} disabled={uploadBlocked}>
          <Upload />
          Upload documents
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={<Database />}
      title="No documents you can access yet"
      description="Documents appear here once they're in a knowledge base you can see, within your clearance."
    />
  );

  return (
    <div className="grid gap-6">
      <PageHeader
        overline={
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3.5 text-brand-600" aria-hidden />
            Encrypted at rest · access-controlled by knowledge base and clearance
          </span>
        }
        title="Document Vault"
        description={
          <>
            Secure RAG pipeline
            {total !== undefined ? (
              <>
                {' · '}
                <span className="font-medium text-ink-soft tabular">{pluralize(total, 'document')}</span>
                {filtered ? ' matching these filters' : null}
              </>
            ) : null}
          </>
        }
        actions={
          <>
            {can('knowledgebase:read') ? (
              <Button asChild variant="secondary">
                <Link to={`${base}/knowledge-bases`}>
                  <FolderCog />
                  Knowledge bases
                </Link>
              </Button>
            ) : null}
            {canAsk ? (
              <Button asChild variant="secondary">
                <Link to={`${base}/search`}>
                  <Search />
                  Search
                </Link>
              </Button>
            ) : null}
            {canUpload ? (
              <Tooltip content={uploadBlocked ? "Uploads aren't set up on this server yet" : undefined} disabled={!uploadBlocked}>
                <span tabIndex={uploadBlocked ? 0 : -1} className="inline-flex rounded-lg">
                  <Button onClick={() => setUpload({ open: true, files: [] })} disabled={uploadBlocked}>
                    <Upload />
                    Upload documents
                  </Button>
                </span>
              </Tooltip>
            ) : null}
          </>
        }
      />

      <KnowledgeLayerBanner />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_19rem] 2xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="grid min-w-0 gap-4">
          {canUpload ? (
            <DropZone
              dragging={dragging}
              onFiles={addFiles}
              disabled={uploadBlocked}
              disabledReason="Uploads aren't set up on this server yet."
              compact={items.length > 0}
            />
          ) : null}

          <UploadActivity />

          {canReadDocuments ? (
            <Card className="overflow-hidden">
              <VaultToolbar
                filters={filters}
                onUpdate={update}
                knowledgeBases={knowledgeBases.list}
                clearance={access.clearance}
                mode={mode}
                onModeChange={setMode}
                ask={
                  canAsk
                    ? {
                        disabledReason: layer.blocked('search') ? "Search isn't set up on this server yet" : null,
                        pending: retrieval.isPending,
                        onAsk: ask,
                      }
                    : null
                }
              />
              <ActiveFilters filters={filters} onUpdate={update} knowledgeBaseName={filteredKnowledgeBase?.name ?? null} />
              {asked ? (
                <AskResults
                  query={asked.query}
                  scopeName={filteredKnowledgeBase?.name ?? null}
                  pending={retrieval.isPending}
                  result={retrieval.data}
                  problem={asked.problem}
                  onClose={closeAsk}
                  onOpenInSearch={() => {
                    handOffQuery({ workspaceId: workspace.id, query: asked.query, knowledgeBaseIds: validKb ? [validKb] : [] });
                    void navigate(`${base}/search`);
                  }}
                />
              ) : null}

              <ProcessingNotice
                queryKey={listQuery.queryKey}
                documents={items}
                onRefresh={() => void documents.refetch()}
                refreshing={documents.isFetching}
                className="mx-3 mb-3 sm:mx-4"
              />

              <div className="relative border-t border-line">
                {documents.isFetching && documents.isPlaceholderData ? (
                  <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden" aria-hidden>
                    <div className="h-full w-1/3 bg-brand-500 animate-progress" />
                  </div>
                ) : null}
                <DocumentTable
                  items={items}
                  knowledgeBases={knowledgeBases.byId}
                  loading={documents.isPending}
                  error={documents.error}
                  onRetry={() => void documents.refetch()}
                  retrying={documents.isFetching}
                  stale={documents.isPlaceholderData}
                  activeId={focusId}
                  onActivate={(document) => setActiveId(document.id)}
                  selectable={selectable}
                  selection={selectedIds}
                  onSelectionChange={setSelected}
                  empty={empty}
                  onOpen={open}
                  onDelete={deleteDialog.show}
                  onReclassify={reclassifyDialog.show}
                  onReindex={(document) => reindex.mutate(document)}
                  onDownload={(document) => void downloads.download(document)}
                  isDownloading={downloads.isPending}
                  isReindexing={(documentId) => reindex.isPending && reindex.variables?.id === documentId}
                />
              </div>

              <BulkBar
                selected={selectedDocuments}
                knowledgeBases={knowledgeBases.byId}
                onClear={() => setSelected(new Set())}
                onDone={() => setSelected(new Set())}
              />

              {documents.data && documents.data.pagination.totalItems > 0 ? (
                <div className="border-t border-line px-4 py-3 sm:px-6">
                  <Pagination
                    pagination={documents.data.pagination}
                    onPageChange={(page) => update({ page })}
                    busy={documents.isFetching}
                    noun={['document', 'documents']}
                  />
                </div>
              ) : null}
            </Card>
          ) : (
            <Card>
              <Callout tone="neutral" icon={<Info className="size-4" />} title="You can see knowledge bases, but not their documents" className="m-5">
                Your role in {workspace.name} doesn't include <code className="font-mono text-[12px]">document:read</code>. The
                knowledge bases are listed under{' '}
                <Link to={`${base}/knowledge-bases`} className="font-medium underline underline-offset-2">
                  Knowledge bases
                </Link>
                .
              </Callout>
            </Card>
          )}
        </div>

        <aside className={cn('grid min-w-0 gap-4')} aria-label="Pipeline, statistics and PII preview">
          <PipelinePanel
            document={activeDocument}
            knowledgeBase={activeKnowledgeBase ?? filteredKnowledgeBase}
            workspaceChunkSize={details.data?.settings.defaultChunkSize ?? null}
            counts={counts}
            piiReportTo={
              activeDocument && access.can('piiReport', activeKnowledgeBase)
                ? `${base}/documents/${activeDocument.id}/privacy${location.search}`
                : null
            }
          />
          {can('knowledgebase:read') ? (
            <StatsPanel knowledgeBases={knowledgeBases.list} focus={filteredKnowledgeBase} loading={knowledgeBases.isPending} />
          ) : null}
          {!access.lacks('piiReport') ? <PiiPreviewPanel document={activeDocument} knowledgeBase={activeKnowledgeBase} /> : null}
        </aside>
      </div>

      {canUpload ? (
        <UploadDialog
          open={upload.open}
          onOpenChange={(value) => setUpload((current) => ({ ...current, open: value }))}
          files={upload.files}
          onFilesChange={(files) => setUpload((current) => ({ ...current, files }))}
          defaultKnowledgeBaseId={validKb}
        />
      ) : null}
      <DropOverlay visible={dragging && !upload.open} target={filteredKnowledgeBase ? `Into ${filteredKnowledgeBase.name}, or pick another base` : 'You choose the knowledge base next'} />

      <DeleteDocumentDialog
        document={deleteDialog.target}
        open={deleteDialog.open}
        onOpenChange={deleteDialog.onOpenChange}
        onDeleted={() => {
          if (deleteDialog.target && drawerId === deleteDialog.target.id) {
            void navigate({ pathname: `${base}/documents`, search: location.search }, { preventScrollReset: true });
          }
        }}
      />
      <ReclassifyDialog document={reclassifyDialog.target} open={reclassifyDialog.open} onOpenChange={reclassifyDialog.onOpenChange} />

      {/* The document drawer (child route). */}
      <Outlet />
    </div>
  );
}
