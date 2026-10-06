import type { UseQueryResult } from '@tanstack/react-query';
import { Crown, Lock, ShieldCheck, Users } from 'lucide-react';
import { ErrorState } from '@/components/feedback/states';
import { Card } from '@/components/ui/card';
import { Overline, Skeleton } from '@/components/ui/misc';
import type { AccessScope } from '@/lib/api/types';
import { AccessLevelBadge, ClassificationBadge } from '../shared/badges';
import { KnowledgeBaseDot } from '../shared/kb-identity';
import { classificationLabel } from '../shared/meta';

/** "Your access" (§5 "Retrieval playground", P3-API-23): the clearance and the bases search can reach for you. */
export function AccessScopePanel({ scope }: { scope: UseQueryResult<AccessScope> }) {
  return (
    <Card>
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <ShieldCheck className="size-4 text-brand-600" aria-hidden />
        <Overline>Your access</Overline>
      </div>
      {scope.isPending ? (
        <div className="grid gap-2 px-4 pb-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-5 w-56" />
          <Skeleton className="mt-2 h-24 w-full rounded-lg" />
        </div>
      ) : scope.isError ? (
        <ErrorState compact error={scope.error} title="We couldn't load your access" onRetry={() => void scope.refetch()} retrying={scope.isFetching} />
      ) : (
        <div className="grid gap-4 px-4 pb-4">
          <div>
            <p className="text-[13px] text-ink-soft">
              Your clearance: <span className="font-semibold text-ink">{classificationLabel(scope.data.clearance)}</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {scope.data.readableClassifications.map((classification) => (
                <ClassificationBadge key={classification} classification={classification} withTooltip />
              ))}
            </div>
          </div>
          {scope.data.bypassesCompartments ? (
            <p className="flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-[12.5px] leading-relaxed text-brand-800">
              <Crown className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Owner: you can see every knowledge base.
            </p>
          ) : null}
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">
              {scope.data.knowledgeBases.length
                ? `Knowledge bases you can search (${scope.data.knowledgeBases.length})`
                : 'No knowledge bases you can search yet'}
            </p>
            {scope.data.knowledgeBases.length ? (
              <ul className="scrollbar-thin grid max-h-72 gap-1 overflow-y-auto">
                {scope.data.knowledgeBases.map((knowledgeBase) => (
                  <li key={knowledgeBase.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[13px] text-ink-soft">
                    <KnowledgeBaseDot id={knowledgeBase.id} />
                    <span className="min-w-0 flex-1 truncate">{knowledgeBase.name}</span>
                    {knowledgeBase.accessMode === 'RESTRICTED' ? (
                      <Lock className="size-3 shrink-0 text-faint" aria-label="Restricted" />
                    ) : (
                      <Users className="size-3 shrink-0 text-faint" aria-label="Open to the workspace" />
                    )}
                    <AccessLevelBadge level={knowledgeBase.access} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <p className="border-t border-line pt-3 text-xs leading-relaxed text-muted">
            Search only returns passages you're allowed to read: the policy is applied inside the vector search and again when text
            is read. Open bases put everyone who can see them at Manage; your role still decides what you may do. Other people may
            reach different bases.
          </p>
        </div>
      )}
    </Card>
  );
}
