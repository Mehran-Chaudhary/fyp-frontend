import { useQuery } from '@tanstack/react-query';
import { FileSearch, Info, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EmptyState, ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { CopyButton } from '@/components/ui/copy-button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { Pagination } from '@/components/ui/pagination';
import { hasCode } from '@/lib/api/errors';
import type { DocumentChunk } from '@/lib/api/types';
import { displayStatus } from '@/lib/knowledge/status';
import { documentChunksQuery, queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { Highlighted } from '../shared/highlight';
import { NotAvailableState } from '../shared/states';
import { useDocumentContext } from './document-context';

/**
 * The Chunks tab (§6.4, E71): each chunk exactly as retrieval serves it. During a
 * reindex it shows the version that is still answering searches.
 */
export function DocumentChunksTab() {
  const { document, close } = useDocumentContext();
  const workspace = useWorkspace();
  const [page, setPage] = useState(1);
  const [find, setFind] = useState('');
  const chunks = useQuery(documentChunksQuery(workspace.id, document.id, page));
  const status = displayStatus(document);
  const terms = find.trim() ? [find.trim().toLowerCase()] : [];

  const gone = hasCode(chunks.error, 'DOCUMENT_NOT_FOUND');
  useEffect(() => {
    // The drawer's own copy is stale: let it find out and show the same state.
    if (gone) void queryClient.invalidateQueries({ queryKey: queryKeys.documentDetail(workspace.id, document.id) });
  }, [gone, workspace.id, document.id]);
  if (gone) {
    return (
      <NotAvailableState
        kind="document"
        action={
          <Button variant="secondary" size="sm" onClick={close}>
            Back to the vault
          </Button>
        }
      />
    );
  }

  const items = chunks.data?.items ?? [];
  const matches = terms.length ? items.filter((chunk) => chunk.text.toLowerCase().includes(terms[0])).length : null;

  return (
    <div className="grid gap-4 px-5 py-5 sm:px-6">
      {status.previousVersionServing ? (
        <Callout tone="info" icon={<Info className="size-4" />}>
          Showing version {document.activeIndexVersion}, which still answers searches. Version {document.indexVersion}'s chunks
          replace these when processing finishes.
        </Callout>
      ) : null}

      {chunks.isPending ? (
        <div className="grid gap-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      ) : chunks.isError ? (
        <ErrorState compact error={chunks.error} title="We couldn't load the chunks" onRetry={() => void chunks.refetch()} retrying={chunks.isFetching} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<FileSearch />}
          title={document.status === 'FAILED' ? 'No chunks: processing failed' : 'No chunks yet'}
          description={
            document.status === 'FAILED'
              ? 'The document never became searchable. See the Overview tab for why.'
              : 'They appear when processing completes.'
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-muted">
              {chunks.data?.pagination.totalItems.toLocaleString()} chunks · exactly what search retrieves
            </p>
            <Input
              className="w-full sm:w-60"
              leading={<Search />}
              value={find}
              onChange={(event) => setFind(event.target.value)}
              placeholder="Find on this page"
              aria-label="Find in these chunks"
              inputClassName="h-8 text-[13px]"
              trailing={
                find ? (
                  <Button variant="ghost" size="icon-xs" className="text-faint" onClick={() => setFind('')} aria-label="Clear">
                    <X />
                  </Button>
                ) : null
              }
            />
          </div>
          {matches !== null ? (
            <p className="-mt-2 text-xs text-muted" aria-live="polite">
              {matches === 0 ? 'No chunk on this page contains that.' : `${matches} of ${items.length} chunks on this page contain it.`}
            </p>
          ) : null}
          <ol className="grid gap-3">
            {items.map((chunk) => (
              <ChunkCard key={chunk.id} chunk={chunk} terms={terms} dimmed={matches !== null && !chunk.text.toLowerCase().includes(terms[0])} />
            ))}
          </ol>
          <Pagination
            pagination={chunks.data?.pagination}
            onPageChange={(next) => {
              setPage(next);
              setFind('');
            }}
            busy={chunks.isFetching}
            noun={['chunk', 'chunks']}
          />
        </>
      )}
    </div>
  );
}

function ChunkCard({ chunk, terms, dimmed }: { chunk: DocumentChunk; terms: string[]; dimmed: boolean }) {
  const pages =
    chunk.pageStart === null
      ? null
      : chunk.pageEnd === null || chunk.pageEnd === chunk.pageStart
        ? `Page ${chunk.pageStart}`
        : `Pages ${chunk.pageStart}–${chunk.pageEnd}`;
  return (
    <li className={dimmed ? 'opacity-45 transition-opacity' : 'transition-opacity'}>
      <article className="group rounded-lg border border-line bg-surface">
        <header className="flex items-center gap-2 border-b border-line/70 px-3.5 py-2 text-xs text-muted">
          <span className="font-mono font-semibold text-ink-soft tabular">#{chunk.chunkIndex}</span>
          {pages ? (
            <>
              <span aria-hidden>·</span>
              <span>{pages}</span>
            </>
          ) : null}
          <span aria-hidden>·</span>
          <span className="tabular">{chunk.tokenCount.toLocaleString()} tokens</span>
          <span className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <CopyButton value={chunk.text} size="xs" variant="ghost" label="Copy text" />
          </span>
        </header>
        <p className="px-3.5 py-3 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-ink-soft">
          <Highlighted text={chunk.text} terms={terms} />
        </p>
      </article>
    </li>
  );
}
