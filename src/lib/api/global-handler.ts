import { useSession } from '@/lib/auth/session';
import { queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toastError } from '@/lib/toast';
import { blockWorkspace } from '@/lib/workspace-blocks';
import { apiEvents } from './client';
import { WORKSPACE_ACCESS_CODES } from './errors';
import { endSession, hasActiveSession } from './token-manager';

/**
 * App-wide reactions to API errors (spec §9). Screens still handle their own
 * errors; this covers what must happen no matter which screen made the call.
 */
const PERMISSION_REFETCH_INTERVAL_MS = 5_000;
const lastPermissionRefetch = new Map<string, number>();

let installed = false;

export function installGlobalErrorHandler(): void {
  if (installed) return;
  installed = true;

  apiEvents.on('error', ({ error, options }) => {
    const workspaceId = options.workspaceId;

    switch (error.code) {
      case 'PERMISSION_DENIED': {
        // Roles change at any moment: a 403 means our copy of the permissions is stale.
        if (workspaceId) {
          const last = lastPermissionRefetch.get(workspaceId) ?? 0;
          if (Date.now() - last > PERMISSION_REFETCH_INTERVAL_MS) {
            lastPermissionRefetch.set(workspaceId, Date.now());
            void queryClient
              .invalidateQueries({ queryKey: queryKeys.membership(workspaceId) })
              .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.permissions(workspaceId) }));
          }
        }
        toastError(error, 'Not allowed');
        error.handledGlobally = true;
        return;
      }

      case 'ACCOUNT_EMAIL_NOT_VERIFIED':
        useSession.setState({ emailVerificationRequired: true });
        error.handledGlobally = true;
        return;

      case 'ACCOUNT_SUSPENDED':
      case 'ACCOUNT_DEACTIVATED':
        // Any token of an account that can no longer sign in.
        if (options.auth !== false && hasActiveSession()) {
          endSession(error.code);
          error.handledGlobally = true;
        }
        return;

      default:
        if (workspaceId && WORKSPACE_ACCESS_CODES.has(error.code)) {
          blockWorkspace(workspaceId, error);
          error.handledGlobally = true;
        }
    }
  });
}
