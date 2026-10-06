import { FileQuestion, RefreshCw, ServerCog } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { clearLayerGap } from '@/lib/knowledge/layer';
import { cn } from '@/lib/utils';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { useLayerGap } from './use-knowledge-access';

/**
 * "Document uploads and search aren't set up on this server yet" (§10). Shown
 * once the server has said so; the missing settings are named only to people who
 * can change the workspace, since they're server configuration.
 */
export function KnowledgeLayerBanner({ className }: { className?: string }) {
  const workspace = useWorkspace();
  const can = useCan();
  const { gap, blocked } = useLayerGap();
  if (!gap) return null;

  const off: string[] = [];
  if (blocked('upload')) off.push('uploads');
  if (blocked('reindex')) off.push('reindexing');
  if (blocked('download')) off.push('downloads');
  if (blocked('search')) off.push('search');

  return (
    <Callout
      tone="info"
      icon={<ServerCog className="size-4" />}
      className={cn('animate-rise', className)}
      title="Document uploads and search aren't set up on this server yet"
      action={
        <Button variant="secondary" size="xs" onClick={() => clearLayerGap(workspace.id)}>
          <RefreshCw />
          Check again
        </Button>
      }
    >
      {off.length ? <>Until they are, {joinWords(off)} {off.length === 1 ? 'is' : 'are'} turned off. </> : null}
      Everything else, including browsing documents, their chunks and knowledge-base settings, keeps working.
      {can('workspace:update') && gap.missing.length ? (
        <span className="mt-1.5 block">
          Missing server settings:{' '}
          {gap.missing.map((setting, index) => (
            <span key={setting}>
              {index > 0 ? ', ' : null}
              <code className="rounded bg-info-100/70 px-1 font-mono text-[11.5px]">{setting}</code>
            </span>
          ))}
        </span>
      ) : null}
    </Callout>
  );
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * A document or knowledge base that answered 404: the same words whether it never
 * existed or is hidden from you, so nothing hidden is ever confirmed (§3.4, §5).
 */
export function NotAvailableState({
  kind,
  action,
  className,
}: {
  kind: 'document' | 'knowledge base';
  action?: ReactNode;
  className?: string;
}) {
  return (
    <EmptyState
      className={className}
      icon={<FileQuestion />}
      title={`This ${kind} doesn't exist or you don't have access to it`}
      description={
        kind === 'document'
          ? 'It may have been deleted or reclassified, or the link is wrong.'
          : 'It may have been deleted, its access may have changed, or the link is wrong.'
      }
      action={action}
    />
  );
}
