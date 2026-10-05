import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { NoAccessState } from '@/components/feedback/no-access';
import { ErrorState } from '@/components/feedback/states';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import type { Organization } from '@/lib/api/types';
import { workspaceDetailsQuery } from '@/lib/queries';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';

/**
 * The workspace detail (P1-API-23) that most settings pages hydrate from. It
 * needs workspace:read; without it the page explains what's missing instead of
 * guessing current values (spec §3 "do not invent unknown current values").
 */
export function WorkspaceDetailsGate({
  what,
  skeleton = [12, 9],
  children,
}: {
  /** "the security settings", for the error title. */
  what: string;
  /** Heights of the loading cards, in 4 px steps. */
  skeleton?: number[];
  children: (organization: Organization) => ReactNode;
}) {
  const workspace = useWorkspace();
  const can = useCan();
  const details = useQuery({ ...workspaceDetailsQuery(workspace.id), enabled: can('workspace:read') });

  if (!can('workspace:read')) {
    return (
      <Card>
        <NoAccessState permissions={['workspace:read']} workspaceName={workspace.name} />
      </Card>
    );
  }
  if (details.isPending) {
    return (
      <div className="grid grid-cols-1 gap-6" aria-busy="true">
        {skeleton.map((height, index) => (
          <div key={index} className="rounded-xl border border-line bg-surface p-6 shadow-card">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-3 w-72 max-w-full" />
            <Skeleton className="mt-5 w-full" style={{ height: `${height * 4}px` }} />
          </div>
        ))}
      </div>
    );
  }
  if (details.isError) {
    return (
      <Card>
        <ErrorState
          error={details.error}
          title={`We couldn't load ${what}`}
          onRetry={() => void details.refetch()}
          retrying={details.isFetching}
        />
      </Card>
    );
  }
  return <>{children(details.data)}</>;
}

/** "You can view these settings. Changing them needs …" */
export function ReadOnlyHint({ permissions = ['workspace:update'] }: { permissions?: string[] }) {
  return (
    <p className="text-xs text-muted">
      You can view these settings. Changing them needs{' '}
      {permissions.map((permission, index) => (
        <span key={permission}>
          {index > 0 ? ' and ' : null}
          <code className="font-mono text-[11.5px]">{permission}</code>
        </span>
      ))}
      .
    </p>
  );
}
