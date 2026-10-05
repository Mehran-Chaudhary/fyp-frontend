import { useMutation } from '@tanstack/react-query';
import { membersApi } from '@/lib/api/endpoints';
import { hasCode, isApiError, isOutcomeUnknown } from '@/lib/api/errors';
import type { Member } from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import { queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast, toastError } from '@/lib/toast';
import { invalidateMembers } from '@/lib/workspace/cache';
import { useWorkspace } from '@/features/workspaces/workspace-context';

/**
 * A refusal of a member action, in words (spec §5.2). Rank refusals are the
 * generic FORBIDDEN with both priorities in `details`.
 */
export function memberActionMessage(error: unknown): string {
  if (isApiError(error) && error.code === 'FORBIDDEN') {
    const target = error.details?.targetPriority;
    const yours = error.details?.yourPriority;
    if (typeof target === 'number' && typeof yours === 'number') {
      return `You can only manage members who rank below you. Their rank is ${target}; yours is ${yours}.`;
    }
  }
  return messageFor(error);
}

/**
 * The member was removed while we were looking (404 MEMBERSHIP_NOT_FOUND): say
 * so and refresh the lists; the caller closes whatever shows the member.
 */
export function handleMemberGone(workspaceId: string, name: string): void {
  toast.info(`${name} is no longer an active member`, { description: 'The list has been refreshed.' });
  void invalidateMembers(workspaceId);
}

/** Stores a member returned by a mutation and refreshes everything that shows members. */
export function storeMember(workspaceId: string, member: Member): void {
  queryClient.setQueryData(queryKeys.memberDetail(workspaceId, member.id), member);
  void invalidateMembers(workspaceId);
}

/** The member as last seen in any cached page of the list, to open the drawer instantly. */
export function findCachedMember(workspaceId: string, memberId: string): Member | undefined {
  const pages = queryClient.getQueriesData<{ items: Member[] }>({ queryKey: queryKeys.members(workspaceId) });
  for (const [, page] of pages) {
    const found = page?.items.find((member) => member.id === memberId);
    if (found) return found;
  }
  return undefined;
}

/**
 * Reactivate (P2-API-13): suspended → active with the same roles. Restores
 * access rather than removing it, so it needs no confirmation. Not an undelete.
 */
export function useReactivateMember(options: { onGone?: () => void } = {}) {
  const workspace = useWorkspace();
  const workspaceId = workspace.id;
  return useMutation({
    mutationFn: (target: Member) => membersApi.reactivate(workspaceId, target.id),
    onSuccess: (updated) => {
      storeMember(workspaceId, updated);
      toast.success(`${updated.displayName} is active again`, { description: 'Their membership works again, with the same roles.' });
    },
    onError: (error, target) => {
      if (hasCode(error, 'MEMBERSHIP_NOT_FOUND')) {
        handleMemberGone(workspaceId, target.displayName);
        options.onGone?.();
        return;
      }
      if (isOutcomeUnknown(error)) {
        void invalidateMembers(workspaceId);
        toast.warning(`We couldn't confirm whether ${target.displayName} was reactivated`, {
          description: 'The list is being refreshed. Check their status before trying again.',
        });
        return;
      }
      toastError(error, "Couldn't reactivate");
    },
  });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Path ids must be UUIDs; anything else answers 400 (spec §6), so don't send it. */
export const isUuid = (value: string | null | undefined): value is string => !!value && UUID_PATTERN.test(value);
