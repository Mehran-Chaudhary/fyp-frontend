import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Outlet, useParams } from 'react-router';
import { ErrorState } from '@/components/feedback/states';
import { isApiError, WORKSPACE_ACCESS_CODES } from '@/lib/api/errors';
import type { MembershipSummary } from '@/lib/api/types';
import { permissionsQuery } from '@/lib/permissions/load';
import { membershipQuery, meQuery } from '@/lib/queries';
import { STORAGE_KEYS, storage } from '@/lib/storage';
import { clearWorkspaceBlock, useWorkspaceBlocks } from '@/lib/workspace-blocks';
import { AppShell, ShellSkeleton } from '@/features/shell/app-shell';
import { WorkspaceAccessState } from './workspace-access-state';
import { WorkspaceContext, type ActiveWorkspace } from './workspace-context';

/**
 * The workspace gate (spec §6.2):
 *   1. find the membership by slug (refetching /auth/me once if it is missing);
 *   2. make it the active workspace;
 *   3. probe access with GET members/me, which needs no permission, so "you can't
 *      be here" is told apart from "you lack a permission";
 *   4. load permissions, then render the shell.
 */
export function WorkspaceGate() {
  const { workspaceSlug = '' } = useParams();
  const me = useQuery(meQuery);
  const summary = me.data?.memberships.find((membership) => membership.organizationSlug === workspaceSlug);
  const [checkedSlug, setCheckedSlug] = useState<string | null>(null);
  const { refetch } = me;

  // Step 1: the user may have just joined; look again once before giving up.
  useEffect(() => {
    if (summary || checkedSlug === workspaceSlug) return;
    let cancelled = false;
    void refetch().finally(() => {
      if (!cancelled) setCheckedSlug(workspaceSlug);
    });
    return () => {
      cancelled = true;
    };
  }, [summary, checkedSlug, workspaceSlug, refetch]);

  if (!summary) {
    if (checkedSlug !== workspaceSlug) return <ShellSkeleton />;
    return <WorkspaceAccessState kind="not-found" slug={workspaceSlug} />;
  }

  // Keyed by id: switching workspace starts from a clean slate.
  return <ResolvedWorkspace key={summary.organizationId} summary={summary} />;
}

function ResolvedWorkspace({ summary }: { summary: MembershipSummary }) {
  const client = useQueryClient();
  const id = summary.organizationId;
  const block = useWorkspaceBlocks((state) => state.blocks[id]);

  // Entering the workspace re-checks access from scratch.
  useEffect(() => clearWorkspaceBlock(id), [id]);

  const probe = useQuery({ ...membershipQuery(id), refetchOnMount: 'always' });
  const permissions = useQuery({ ...permissionsQuery(id, client), enabled: probe.isSuccess });

  useEffect(() => {
    if (probe.isSuccess) storage.set(STORAGE_KEYS.lastWorkspace, summary.organizationSlug);
  }, [probe.isSuccess, summary.organizationSlug]);

  const workspace = useMemo<ActiveWorkspace | null>(() => {
    if (!probe.data || !permissions.data) return null;
    return {
      id,
      slug: summary.organizationSlug,
      name: summary.organizationName,
      summary,
      membership: probe.data,
      permissions: permissions.data,
    };
  }, [id, summary, probe.data, permissions.data]);

  const probeAccessError =
    isApiError(probe.error) && WORKSPACE_ACCESS_CODES.has(probe.error.code) ? probe.error : null;
  const accessError = block ?? (probe.isFetching ? null : probeAccessError);

  const retry = () => {
    clearWorkspaceBlock(id);
    void probe.refetch();
    void permissions.refetch();
  };

  if (accessError) {
    return <WorkspaceAccessState error={accessError} summary={summary} onRetry={retry} retrying={probe.isFetching} />;
  }

  if (probe.isPending || (probe.isError && probe.isFetching)) {
    return <ShellSkeleton workspaceName={summary.organizationName} />;
  }

  if (probe.isError) {
    return (
      <WorkspaceProblem>
        <ErrorState error={probe.error} title="We couldn't open this workspace" onRetry={retry} retrying={probe.isFetching} />
      </WorkspaceProblem>
    );
  }

  if (!workspace) {
    if (permissions.isError) {
      return (
        <WorkspaceProblem>
          <ErrorState
            error={permissions.error}
            title="We couldn't load your permissions"
            onRetry={() => void permissions.refetch()}
            retrying={permissions.isFetching}
          />
        </WorkspaceProblem>
      );
    }
    return <ShellSkeleton workspaceName={summary.organizationName} />;
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
      <div className="w-full max-w-md rounded-xl border border-line bg-surface shadow-card">{children}</div>
    </div>
  );
}
