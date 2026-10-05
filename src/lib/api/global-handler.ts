import { useSession } from '@/lib/auth/session';
import { missingConfigurationOf, recordLayerGap, type KnowledgeCapability } from '@/lib/knowledge/layer';
import { queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toastError } from '@/lib/toast';
import { blockWorkspace } from '@/lib/workspace-blocks';
import { apiEvents } from './client';
import { isWorkspaceAccessError } from './errors';
import { endSession, hasActiveSession } from './token-manager';

/**
 * App-wide reactions to API errors (Phase 1 spec §11). Screens still handle their
 * own errors; this covers what must happen no matter which screen made the call.
 */
const PERMISSION_REFETCH_INTERVAL_MS = 5_000;
const lastPermissionRefetch = new Map<string, number>();

let installed = false;

export function installGlobalErrorHandler(): void {
  if (installed) return;
  installed = true;

  apiEvents.on('error', ({ error, options, path }) => {
    const workspaceId = options.workspaceId;

    // A workspace's own policy closed it (including its verified-email rule):
    // that workspace shows a recovery state, the account stays signed in.
    if (workspaceId && isWorkspaceAccessError(error)) {
      blockWorkspace(workspaceId, error);
      error.handledGlobally = true;
      return;
    }

    switch (error.code) {
      case 'KNOWLEDGE_LAYER_NOT_CONFIGURED':
        // Not handled here: the screen still explains it. Remember it for the session
        // so the other knowledge screens disable what can't work.
        if (workspaceId) recordLayerGap(workspaceId, missingConfigurationOf(error.details), capabilityOf(path));
        return;

      case 'PERMISSION_DENIED': {
        // Roles change at any moment: re-read the contextual permissions, at most once
        // per few seconds, and never by refreshing the token (spec §5).
        if (workspaceId) {
          const last = lastPermissionRefetch.get(workspaceId) ?? 0;
          if (Date.now() - last > PERMISSION_REFETCH_INTERVAL_MS) {
            lastPermissionRefetch.set(workspaceId, Date.now());
            void queryClient.invalidateQueries({ queryKey: queryKeys.context(workspaceId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.membership(workspaceId) });
          }
        }
        toastError(error, 'Not allowed');
        error.handledGlobally = true;
        return;
      }

      case 'ACCOUNT_EMAIL_NOT_VERIFIED':
        // The deployment-wide gate (REQUIRE_EMAIL_VERIFICATION): keep the session,
        // show the verification screen. No refresh, no sign-out, no loop.
        useSession.setState({ emailVerificationRequired: true });
        error.handledGlobally = true;
        return;

      case 'ACCOUNT_SUSPENDED':
      case 'ACCOUNT_DEACTIVATED':
        // Suspended, deactivated, or locked out after failed attempts.
        if (options.auth !== false && hasActiveSession()) {
          endSession(error.code);
          error.handledGlobally = true;
        }
        return;
    }
  });
}

/** Which knowledge capability a refused path belongs to. */
function capabilityOf(path: string): KnowledgeCapability | undefined {
  if (path.endsWith('/rag/query')) return 'search';
  if (path.endsWith('/download')) return 'download';
  if (path.endsWith('/reindex')) return 'reindex';
  if (path.endsWith('/documents') && path.includes('/knowledge-bases/')) return 'upload';
  return undefined;
}
