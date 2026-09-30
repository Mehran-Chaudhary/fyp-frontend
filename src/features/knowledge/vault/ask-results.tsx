import { ArrowUpRight, CircleAlert, MessageSquareText, X } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { Tooltip } from '@/components/ui/tooltip';
import type { RetrievalResponse } from '@/lib/api/types';
import { useCountdown } from '@/lib/hooks';
import { pluralize } from '@/lib/utils';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { queryTerms } from '../shared/meta';
import { PassageCard } from '../search/passage-card';
import type { RetrievalProblem } from '../search/use-retrieval';

/**
 * The vault's "Ask" results (§6.1): passages from retrieval over the current
 * knowledge-base filter, above the table, each linking to its document.
 */
export function AskResults({
  query,
  scopeName,
  pending,
  result,
  problem,
  onClose,
  onOpenInSearch,
}: {
  query: string;
  scopeName: string | null;
  pending: boolean;
  result: RetrievalResponse | undefined;
  problem: RetrievalProblem | null;
  onClose: () => void;
  onOpenInSearch: () => void;
}) {
  const workspace = useWorkspace();
  const terms = queryTerms(query);
  const topScore = result?.results[0]?.score ?? 0;
  const retryIn = useCountdown(problem?.retryAt ?? null);

  return (
    <section aria-label="Answers from your documents" className="border-t border-line bg-[#fcfbf8] animate-rise">
      <header className="flex items-start gap-3 px-4 pt-3.5 sm:px-5">
        <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-brand-200 bg-brand-50 text-brand-700">
          <MessageSquareText className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium text-ink">“{query}”</p>
          <p className="text-xs text-muted">
            {pending
              ? `Searching ${scopeName ?? 'every knowledge base you can reach'}…`
              : result
                ? `${pluralize(result.results.length, 'passage')} from ${pluralize(result.knowledgeBasesSearched, 'knowledge base')} · ${result.timings.totalMs} ms${result.reranked ? ' · reranked' : ''}`
                : scopeName
                  ? `In ${scopeName}`
                  : 'Across your knowledge bases'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="xs" onClick={onOpenInSearch}>
            Open in Search
            <ArrowUpRight />
          </Button>
          <Tooltip content="Close">
            <Button variant="ghost" size="icon-xs" className="text-faint" onClick={onClose} aria-label="Close the answers">
              <X />
            </Button>
          </Tooltip>
        </div>
      </header>

      <div className="px-4 pb-2 sm:px-5">
        {pending ? (
          <div className="grid gap-4 py-3.5">
            {[0, 1].map((index) => (
              <div key={index} className="flex gap-3">
                <Skeleton className="size-6 rounded-full" />
                <div className="grid flex-1 gap-2">
                  <Skeleton className="h-3.5 w-48" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </div>
            ))}
          </div>
        ) : problem ? (
          <p className="flex items-start gap-2 py-4 text-[13px] text-danger-700" role="alert">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {problem.message}
              {problem.retryAt && retryIn > 0 ? <span className="tabular"> Try again in {retryIn} s.</span> : null}
            </span>
          </p>
        ) : result && result.results.length === 0 ? (
          <p className="py-4 text-[13px] text-muted">
            {result.knowledgeBasesSearched === 0
              ? "You don't have access to any knowledge base with searchable documents yet."
              : `No passages found in the ${pluralize(result.knowledgeBasesSearched, 'knowledge base')} you can search.`}
          </p>
        ) : result ? (
          <div className="scrollbar-thin max-h-[26rem] divide-y divide-line/70 overflow-y-auto">
            {result.results.map((passage) => (
              <PassageCard key={passage.chunkId} passage={passage} topScore={topScore} terms={terms} compact keepSearch />
            ))}
          </div>
        ) : null}
      </div>
      <p className="border-t border-line/70 px-4 py-2 text-[11.5px] text-faint sm:px-5">
        Only passages you're allowed to read are ever retrieved.{' '}
        <Link to={`/w/${workspace.slug}/search`} className="text-muted underline decoration-line-strong underline-offset-2 hover:text-ink">
          More options in Search
        </Link>
      </p>
    </section>
  );
}
