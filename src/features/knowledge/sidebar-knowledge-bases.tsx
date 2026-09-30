import { Lock } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { Skeleton } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { KnowledgeBaseDot } from './shared/kb-identity';
import { useKnowledgeBases } from './shared/use-knowledge-access';

const SHOWN = 8;

/**
 * Under Documents in the sidebar (§5, mockup 5): the knowledge bases you can read,
 * each with its document count, linking to the vault filtered to it.
 */
export function SidebarKnowledgeBases({ onNavigate }: { onNavigate?: () => void }) {
  const workspace = useWorkspace();
  const can = useCan();
  const knowledgeBases = useKnowledgeBases();
  const location = useLocation();
  const [params] = useSearchParams();
  const base = `/w/${workspace.slug}`;
  const onVault = location.pathname === `${base}/documents` || location.pathname.startsWith(`${base}/documents/`);
  const activeKb = onVault ? params.get('kb') : null;
  const onManage = location.pathname.startsWith(`${base}/knowledge-bases`);
  const onSearch = location.pathname === `${base}/search`;

  const shown = knowledgeBases.list.slice(0, SHOWN);
  const more = knowledgeBases.list.length - shown.length;

  return (
    <div className="mt-0.5 mb-1 ml-[19px] border-l border-line pl-2">
      <p className="px-2 pt-1.5 pb-1 text-[10.5px] font-medium tracking-[0.08em] text-faint uppercase">Knowledge bases</p>
      {knowledgeBases.isPending ? (
        <div className="grid gap-1.5 px-2 py-1">
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      ) : knowledgeBases.isError ? (
        <p className="px-2 py-1 text-xs text-faint">Couldn't load them.</p>
      ) : shown.length === 0 ? (
        <p className="px-2 py-1 text-xs text-faint">None you can see yet.</p>
      ) : (
        <ul className="grid">
          {shown.map((knowledgeBase) => {
            const active = activeKb === knowledgeBase.id;
            return (
              <li key={knowledgeBase.id}>
                <Link
                  to={`${base}/documents?kb=${knowledgeBase.id}`}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group flex h-7 items-center gap-2 rounded-md px-2 text-[12.5px] transition-colors',
                    active ? 'bg-well-strong/70 font-medium text-ink' : 'text-ink-soft hover:bg-well hover:text-ink',
                  )}
                >
                  <KnowledgeBaseDot id={knowledgeBase.id} />
                  <span className="min-w-0 flex-1 truncate">{knowledgeBase.name}</span>
                  {knowledgeBase.accessMode === 'RESTRICTED' ? <Lock className="size-3 shrink-0 text-faint" aria-label="Restricted" /> : null}
                  <span className="shrink-0 font-mono text-[11px] text-faint tabular">{knowledgeBase.stats.documents}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-x-1 px-1 pt-1 pb-0.5 text-[12px]">
        {more > 0 ? (
          <Link to={`${base}/knowledge-bases`} onClick={onNavigate} className="rounded px-1 text-muted hover:text-ink">
            +{more} more
          </Link>
        ) : null}
        <Link
          to={`${base}/knowledge-bases`}
          onClick={onNavigate}
          className={cn('rounded px-1 hover:text-ink', onManage ? 'font-medium text-ink' : 'text-muted')}
        >
          Manage
        </Link>
        {can('rag:query') ? (
          <>
            <span className="text-line-strong" aria-hidden>
              ·
            </span>
            <Link to={`${base}/search`} onClick={onNavigate} className={cn('rounded px-1 hover:text-ink', onSearch ? 'font-medium text-ink' : 'text-muted')}>
              Search
            </Link>
          </>
        ) : null}
      </div>
    </div>
  );
}
