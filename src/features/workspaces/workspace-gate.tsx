import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, type ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation, useParams } from 'react-router';
import { ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { isWorkspaceAccessError } from '@/lib/api/errors';
import type { MembershipSummary } from '@/lib/api/types';
import {
  contextQuery,
  membershipQuery,
  meQuery,
  queryKeys,
  UUID_PATTERN,
  workspaceDetailsQuery,
  workspaceRefQuery,
} from '@/lib/queries';
import { lastWorkspace } from '@/lib/storage';
import { humanizeSlug } from '@/lib/utils';
import { clearWorkspaceBlock, useWorkspaceBlocks } from '@/lib/workspace-blocks';
import { AppShell, ShellSkeleton } from '@/features/shell/app-shell';
import { WorkspaceAccessState } from './workspace-access-state';
import { WorkspaceContext, type ActiveWorkspace } from './workspace-context';

const NO_PERMISSIONS: readonly string[] = [];

/**
 * The workspace gate: the switching transaction of Phase 1 spec §5.
 *
 *  1. Resolve the route's reference (slug or UUID) to the canonical UUID: from the
 *     embedded memberships when it is among the first 100, otherwise by asking the
 *     server (the header accepts a slug).
 *  2. Key everything below by that UUID, so another workspace starts from a clean
 *     slate and its in-flight requests are cancelled; tenant caches are keyed by
 *     it too, so a slow answer for A can never render in B.
 *  3. Run contextual /auth/me on every entry: it enforces membership, workspace
 *     status, IP, MFA and email policy, and returns your concrete permissions.
 *  4. Then, optionally, your own membership (role labels) and, with
 *     `workspace:read`, the workspace detail. Neither is required to enter.
 */
export function WorkspaceGate() {
  const { workspaceSlug: reference = '' } = useParams();
  const me = useQuery(meQuery);
  const lowered = reference.toLowerCase();
  const embedded =
    me.data?.memberships.find(
      (membership) => membership.organizationSlug === lowered || membership.organizationId.toLowerCase() === lowered,
    ) ?? null;
  const directId = embedded?.organizationId ?? (UUID_PATTERN.test(reference) ? lowered : null);
  const lookup = useQuery({ ...workspaceRefQuery(lowered), enabled: !directId && reference !== '' });
  const id = directId ?? lookup.data ?? null;

  if (!id) {
    if (lookup.isError) {
      if (isWorkspaceAccessError(lookup.error)) {
        return (
          <WorkspaceAccessState
            error={lookup.error}
            workspaceName={null}
            reference={reference}
            onRetry={() => void lookup.refetch()}
            retrying={lookup.isFetching}
          />
        );
      }
      return (
        <WorkspaceProblem>
          <ErrorState error={lookup.error} title="We couldn't open this workspace" onRetry={() => void lookup.refetch()} retrying={lookup.isFetching} />
        </WorkspaceProblem>
      );
    }
    return <ShellSkeleton />;
  }

  return <ResolvedWorkspace key={id} id={id} reference={reference} embedded={embedded} userId={me.data?.id ?? null} />;
}

function ResolvedWorkspace({
  id,
  reference,
  embedded,
  userId,
}: {
  id: string;
  reference: string;
  embedded: MembershipSummary | null;
  userId: string | null;
}) {
  const client = useQueryClient();
  const location = useLocation();
  const block = useWorkspaceBlocks((state) => state.blocks[id]);

  // Entering re-checks access from scratch; leaving abandons this workspace's
  // requests still in flight and forgets its access check, so the next entry
  // can't start from a stale one.
  useEffect(() => {
    clearWorkspaceBlock(id);
    return () => {
      void client.cancelQueries({ queryKey: queryKeys.ws(id) });
      client.removeQueries({ queryKey: queryKeys.context(id), exact: true });
    };
  }, [client, id]);

  const context = useQuery(contextQuery(id));
  // Data only exists after this entry's own check succeeded. A later background
  // re-check that fails transiently keeps it; one that is refused shows below.
  const checked = context.data !== undefined;
  const permissions = context.data?.permissions ?? NO_PERMISSIONS;
  const canRead = permissions.includes('workspace:read');

  const membership = useQuery({ ...membershipQuery(id), enabled: checked });
  const details = useQuery({ ...workspaceDetailsQuery(id), enabled: checked && canRead });
  // Optional, but awaited briefly so screens that show your role don't flicker.
  const membershipSettled = !checked || !membership.isPending;

  const accessError = block ?? (isWorkspaceAccessError(context.error) && !context.isFetching ? context.error : null);
  const notFound = accessError?.code === 'ORGANIZATION_NOT_FOUND';

  useEffect(() => {
    if (!userId) return;
    if (checked) lastWorkspace.set(userId, id);
    else if (notFound) lastWorkspace.clear(userId, id);
  }, [checked, notFound, userId, id]);

  const slug = embedded?.organizationSlug ?? details.data?.slug ?? (UUID_PATTERN.test(reference) ? id : reference.toLowerCase());
  const name = embedded?.organizationName ?? details.data?.name ?? (UUID_PATTERN.test(slug) ? 'Workspace' : humanizeSlug(slug));

  const workspace = useMemo<ActiveWorkspace | null>(() => {
    if (!checked || !membershipSettled) return null;
    return {
      id,
      slug,
      name,
      summary: embedded,
      membership: membership.data ?? null,
      permissions,
      details: details.data ?? null,
    };
  }, [checked, membershipSettled, id, slug, name, embedded, membership.data, permissions, details.data]);

  const retry = () => {
    clearWorkspaceBlock(id);
    void context.refetch();
  };

  if (accessError) {
    return (
      <WorkspaceAccessState
        error={accessError}
        workspaceName={embedded?.organizationName ?? null}
        reference={slug}
        onRetry={retry}
        retrying={context.isFetching}
      />
    );
  }

  if (!checked && context.isError && !context.isFetching) {
    return (
      <WorkspaceProblem>
        <ErrorState error={context.error} title="We couldn't open this workspace" onRetry={retry} retrying={context.isFetching} />
      </WorkspaceProblem>
    );
  }

  if (!workspace) return <ShellSkeleton workspaceName={embedded?.organizationName} />;

  // A UUID (or differently cased slug) in the address: show the canonical one.
  const segment = location.pathname.split('/')[2];
  if (segment && segment !== workspace.slug && !UUID_PATTERN.test(workspace.slug)) {
    const rest = location.pathname.split('/').slice(3).join('/');
    return <Navigate replace to={`/w/${workspace.slug}${rest ? `/${rest}` : ''}${location.search}${location.hash}`} />;
  }

  return (
    <WorkspaceContext.Provider value={workspace}>
      <AppShell>
        <Outlet />
      </AppShell>
    </WorkspaceContext.Provider>
  );
}

function WorkspaceProblem({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-5">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface shadow-card">
        {children}
        <div className="flex justify-center gap-2 border-t border-line py-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/workspaces">Your workspaces</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/account/profile">Account settings</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
