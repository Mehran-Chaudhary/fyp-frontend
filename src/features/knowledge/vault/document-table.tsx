import {
  Download,
  Eye,
  FileSearch,
  MoreHorizontal,
  RotateCcw,
  RotateCw,
  ScanEye,
  ShieldHalf,
  Trash2,
} from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { CheckboxBox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/misc';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableMessage, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import type { KnowledgeBase, VaultDocument } from '@/lib/api/types';
import { formatBytes } from '@/lib/knowledge/files';
import { isInProgress, retryCanHelp } from '@/lib/knowledge/status';
import { cn, formatDate } from '@/lib/utils';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { ClassificationBadge, DocumentStatusCell } from '../shared/badges';
import { FileGlyph } from '../shared/file-glyph';
import { KnowledgeBaseName } from '../shared/kb-identity';
import { useActionGate } from '../shared/use-action-gate';

const COLUMNS = 8;

export interface DocumentRowActions {
  onOpen: (document: VaultDocument, tab?: 'chunks' | 'pii') => void;
  onDelete: (document: VaultDocument) => void;
  onReclassify: (document: VaultDocument) => void;
  onReindex: (document: VaultDocument) => void;
  onDownload: (document: VaultDocument) => void;
  isDownloading: (documentId: string) => boolean;
  isReindexing: (documentId: string) => boolean;
}

interface DocumentTableProps extends DocumentRowActions {
  items: readonly VaultDocument[];
  knowledgeBases: ReadonlyMap<string, KnowledgeBase>;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
  /** Showing the previous page while the next one loads. */
  stale: boolean;
  activeId: string | null;
  onActivate: (document: VaultDocument) => void;
  selectable: boolean;
  selection: ReadonlySet<string>;
  onSelectionChange: (selection: Set<string>) => void;
  empty: ReactNode;
}

/** The vault's table (§6.1). A click selects a row for the side panels; the title opens it. */
export function DocumentTable(props: DocumentTableProps) {
  const { items, loading, error, stale, selectable, selection, onSelectionChange } = props;
  const allSelected = items.length > 0 && items.every((document) => selection.has(document.id));
  const someSelected = !allSelected && items.some((document) => selection.has(document.id));

  return (
    <Table className={cn('transition-opacity', stale && 'opacity-60')}>
      <THead>
        <tr>
          <TH className="w-10 pr-0">
            {selectable && items.length ? (
              <CheckboxBox
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={(checked) => onSelectionChange(checked ? new Set(items.map((document) => document.id)) : new Set())}
                aria-label={allSelected ? 'Deselect all on this page' : 'Select all on this page'}
                className="mt-0"
              />
            ) : (
              <span className="sr-only">Select</span>
            )}
          </TH>
          <TH className="w-full">Document</TH>
          <TH className="hidden 2xl:table-cell">Knowledge base</TH>
          <TH className="hidden sm:table-cell">Classification</TH>
          <TH className="hidden text-right md:table-cell">Size</TH>
          <TH className="hidden text-right 2xl:table-cell">Chunks</TH>
          <TH>Status</TH>
          <TH className="w-px">
            <span className="sr-only">Actions</span>
          </TH>
        </tr>
      </THead>
      <TBody>
        {loading ? (
          Array.from({ length: 6 }, (_, index) => <SkeletonRow key={index} />)
        ) : error && items.length === 0 ? (
          <TableMessage colSpan={COLUMNS}>
            <ErrorState error={error} title="We couldn't load the documents" onRetry={props.onRetry} retrying={props.retrying} />
          </TableMessage>
        ) : items.length === 0 ? (
          <TableMessage colSpan={COLUMNS}>{props.empty}</TableMessage>
        ) : (
          items.map((document) => <DocumentRow key={document.id} document={document} {...props} />)
        )}
      </TBody>
    </Table>
  );
}

function DocumentRow({
  document,
  knowledgeBases,
  activeId,
  onActivate,
  selectable,
  selection,
  onSelectionChange,
  ...actions
}: DocumentTableProps & { document: VaultDocument }) {
  const workspace = useWorkspace();
  const location = useLocation();
  const knowledgeBase = knowledgeBases.get(document.knowledgeBaseId);
  const active = activeId === document.id;
  const selected = selection.has(document.id);
  const href = { pathname: `/w/${workspace.slug}/documents/${document.id}`, search: location.search };
  const differentName = document.originalFilename && document.originalFilename !== document.title;

  const select = (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    onActivate(document);
  };

  return (
    <TR
      interactive
      aria-selected={active}
      onClick={select}
      onDoubleClick={() => actions.onOpen(document)}
      onFocus={() => !active && onActivate(document)}
      className={cn(
        selected && 'bg-brand-50/40',
        active && 'bg-brand-50/70 shadow-[inset_3px_0_0_var(--color-brand-500)] hover:bg-brand-50/80',
      )}
    >
      <TD className="w-10 pr-0" onClick={(event) => event.stopPropagation()}>
        {selectable ? (
          <CheckboxBox
            checked={selected}
            onCheckedChange={(checked) => {
              const next = new Set(selection);
              if (checked) next.add(document.id);
              else next.delete(document.id);
              onSelectionChange(next);
            }}
            aria-label={`Select ${document.title}`}
            className="mt-0"
          />
        ) : null}
      </TD>
      <TD className="w-full max-w-0 min-w-56">
        <div className="flex min-w-0 items-center gap-3">
          <FileGlyph type={document.fileType} />
          <div className="min-w-0">
            <Link
              to={href}
              preventScrollReset
              onClick={(event) => event.stopPropagation()}
              title={differentName ? document.originalFilename : undefined}
              className="block truncate rounded-sm font-medium text-ink hover:text-brand-700 hover:underline hover:decoration-brand-200 hover:underline-offset-4"
            >
              {document.title}
            </Link>
            <p className="flex min-w-0 items-center gap-1.5 overflow-hidden text-xs text-muted">
              {/* Where the base has no column of its own, it takes the file name's place. */}
              {knowledgeBase ? (
                <span className="flex min-w-0 items-center gap-1.5 2xl:hidden">
                  <KnowledgeBaseName knowledgeBase={knowledgeBase} />
                  <span aria-hidden>·</span>
                </span>
              ) : null}
              {differentName ? <span className="hidden min-w-0 truncate 2xl:inline">{document.originalFilename} ·</span> : null}
              <span className="shrink-0 whitespace-nowrap">Added {formatDate(document.createdAt)}</span>
            </p>
          </div>
        </div>
      </TD>
      <TD className="hidden max-w-[12rem] 2xl:table-cell">
        {knowledgeBase ? <KnowledgeBaseName knowledgeBase={knowledgeBase} className="text-ink-soft" /> : <span className="text-faint">—</span>}
      </TD>
      <TD className="hidden sm:table-cell">
        <ClassificationBadge classification={document.classification} />
      </TD>
      <TD className="hidden text-right font-mono text-[12.5px] whitespace-nowrap tabular md:table-cell">{formatBytes(document.sizeBytes)}</TD>
      <TD className="hidden text-right font-mono text-[12.5px] tabular 2xl:table-cell">
        {document.chunkCount === 0 && !document.isSearchable ? <span className="text-faint">—</span> : document.chunkCount.toLocaleString()}
      </TD>
      <TD>
        <DocumentStatusCell document={document} />
      </TD>
      <TD className="text-right whitespace-nowrap" onClick={(event) => event.stopPropagation()}>
        <RowActions document={document} knowledgeBase={knowledgeBase} {...actions} />
      </TD>
    </TR>
  );
}

function RowActions({
  document,
  knowledgeBase,
  onOpen,
  onDelete,
  onReclassify,
  onReindex,
  onDownload,
  isDownloading,
  isReindexing,
}: DocumentRowActions & { document: VaultDocument; knowledgeBase: KnowledgeBase | undefined }) {
  const state = useActionGate();
  const del = state('deleteDocument', knowledgeBase);
  const download = state('download', knowledgeBase);
  const reindex = state('reindex', knowledgeBase);
  const reclassify = state('editDocument', knowledgeBase);
  const pii = state('piiReport', knowledgeBase);

  const failed = document.status === 'FAILED';
  const processing = isInProgress(document.status);
  const showReindex = reindex.visible && (!failed || retryCanHelp(document.failureCode));
  const reindexReason = reindex.reason ?? (processing ? 'Already being processed' : null);
  const downloading = isDownloading(document.id);

  return (
    <div className="flex items-center justify-end gap-0.5">
      <Tooltip content="View details">
        <Button variant="ghost" size="icon-sm" className="text-faint hover:text-ink" onClick={() => onOpen(document)} aria-label={`View ${document.title}`}>
          <Eye />
        </Button>
      </Tooltip>
      {del.visible ? (
        <Tooltip content={del.reason ?? 'Delete'}>
          <span tabIndex={del.reason ? 0 : -1} className="inline-flex rounded-lg">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-faint hover:text-danger-600"
              disabled={!!del.reason}
              onClick={() => onDelete(document)}
              aria-label={`Delete ${document.title}`}
            >
              <Trash2 />
            </Button>
          </span>
        </Tooltip>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="text-faint data-[state=open]:bg-well" aria-label={`More actions for ${document.title}`}>
            {downloading ? <Spinner /> : <MoreHorizontal />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-60">
          <DropdownMenuItem onSelect={() => onOpen(document)}>
            <Eye />
            View details
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpen(document, 'chunks')}>
            <FileSearch />
            Chunks
          </DropdownMenuItem>
          {pii.visible ? (
            <MenuAction icon={<ScanEye />} label="PII report" reason={pii.reason} onSelect={() => onOpen(document, 'pii')} />
          ) : null}
          {download.visible || showReindex || reclassify.visible ? <DropdownMenuSeparator /> : null}
          {download.visible ? (
            <MenuAction
              icon={downloading ? <Spinner /> : <Download />}
              label={downloading ? 'Downloading…' : 'Download original'}
              reason={download.reason}
              disabled={downloading}
              onSelect={() => onDownload(document)}
            />
          ) : null}
          {showReindex ? (
            <MenuAction
              icon={failed ? <RotateCcw /> : <RotateCw />}
              label={failed ? 'Retry processing' : 'Reindex'}
              reason={reindexReason}
              disabled={isReindexing(document.id)}
              onSelect={() => onReindex(document)}
            />
          ) : null}
          {reclassify.visible ? (
            <MenuAction icon={<ShieldHalf />} label="Reclassify…" reason={reclassify.reason} onSelect={() => onReclassify(document)} />
          ) : null}
          {del.visible ? (
            <>
              <DropdownMenuSeparator />
              <MenuAction icon={<Trash2 />} label="Delete…" reason={del.reason} tone="danger" onSelect={() => onDelete(document)} />
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** A menu item that explains itself when it can't be used here. */
function MenuAction({
  icon,
  label,
  reason,
  disabled,
  tone,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  reason: string | null;
  disabled?: boolean;
  tone?: 'danger';
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem tone={reason ? undefined : tone} disabled={!!reason || disabled} onSelect={onSelect} className="items-start">
      <span className="mt-px">{icon}</span>
      <span className="min-w-0">
        <span className="block">{label}</span>
        {reason ? <span className="block text-[11.5px] leading-snug text-muted">{reason}</span> : null}
      </span>
    </DropdownMenuItem>
  );
}

function SkeletonRow() {
  return (
    <tr>
      <TD className="w-10 pr-0">
        <Skeleton className="size-4 rounded" />
      </TD>
      <TD>
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-7 rounded-md" />
          <div className="grid gap-1.5">
            <Skeleton className="h-3.5 w-44" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
      </TD>
      <TD className="hidden 2xl:table-cell">
        <Skeleton className="h-3 w-24" />
      </TD>
      <TD className="hidden sm:table-cell">
        <Skeleton className="h-5 w-20 rounded-md" />
      </TD>
      <TD className="hidden md:table-cell">
        <Skeleton className="ml-auto h-3 w-12" />
      </TD>
      <TD className="hidden 2xl:table-cell">
        <Skeleton className="ml-auto h-3 w-8" />
      </TD>
      <TD>
        <Skeleton className="h-5 w-16 rounded-md" />
      </TD>
      <TD />
    </tr>
  );
}
