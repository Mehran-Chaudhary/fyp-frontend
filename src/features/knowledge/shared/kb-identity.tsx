import { Lock } from 'lucide-react';
import type { KnowledgeBase } from '@/lib/api/types';
import { cn } from '@/lib/utils';
import { knowledgeBaseColor } from './meta';

/** The small square that identifies a knowledge base (the mockup's sidebar markers). */
export function KnowledgeBaseDot({ id, className }: { id: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 shrink-0 rounded-[2.5px]', className)}
      style={{ backgroundColor: knowledgeBaseColor(id) }}
    />
  );
}

/** Name with its colour, and a lock when access is restricted. */
export function KnowledgeBaseName({
  knowledgeBase,
  className,
}: {
  knowledgeBase: Pick<KnowledgeBase, 'id' | 'name' | 'accessMode'>;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <KnowledgeBaseDot id={knowledgeBase.id} />
      <span className="truncate">{knowledgeBase.name}</span>
      {knowledgeBase.accessMode === 'RESTRICTED' ? (
        <Lock className="size-3 shrink-0 text-faint" aria-label="Restricted" />
      ) : null}
    </span>
  );
}
