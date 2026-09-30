import { useMutation } from '@tanstack/react-query';
import { knowledgeBasesApi } from '@/lib/api/endpoints';
import { hasCode, isApiError } from '@/lib/api/errors';
import type {
  AccessLevel,
  CreateKnowledgeBaseRequest,
  GrantSubjectType,
  KnowledgeBase,
  UpdateKnowledgeBaseRequest,
} from '@/lib/api/types';
import { messageFor } from '@/lib/errors';
import {
  afterGrantsChanged,
  afterKnowledgeBaseCreated,
  afterKnowledgeBaseDeleted,
  afterKnowledgeBaseUpdated,
} from '@/lib/knowledge/cache';
import { queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import type { KbFormErrors } from './kb-form-model';

/** A refused create or edit, on the form's fields (§6.6, §8). */
export function kbFormErrors(error: unknown): KbFormErrors {
  if (!isApiError(error)) return { form: messageFor(error) };
  switch (error.code) {
    case 'KNOWLEDGE_BASE_NAME_TAKEN':
      return { name: 'A knowledge base with this name already exists in this workspace.' };
    case 'CLASSIFICATION_EXCEEDS_CLEARANCE':
      return { defaultClassification: messageFor(error) };
    case 'VALIDATION_FAILED': {
      const fields = error.fieldErrors({
        fields: ['name', 'description', 'accessMode', 'defaultClassification', 'chunkSize', 'chunkOverlap'],
      });
      const { name, description, defaultClassification, chunkSize, chunkOverlap, accessMode, _form } = fields;
      const mapped: KbFormErrors = { name, description, defaultClassification, chunkSize, chunkOverlap };
      const rest = [accessMode, _form].filter(Boolean).join(' ');
      if (rest) mapped.form = rest;
      if (!Object.values(mapped).some(Boolean)) mapped.form = error.message;
      return mapped;
    }
    default:
      return { form: messageFor(error) };
  }
}

/** E61 */
export function useCreateKnowledgeBase() {
  const workspace = useWorkspace();
  return useMutation({
    mutationFn: (body: CreateKnowledgeBaseRequest) => knowledgeBasesApi.create(workspace.id, body),
    onSuccess: (created) => void afterKnowledgeBaseCreated(workspace.id, created),
  });
}

/** E63. Send only what changed. */
export function useUpdateKnowledgeBase(knowledgeBase: KnowledgeBase) {
  const workspace = useWorkspace();
  return useMutation({
    mutationFn: (body: UpdateKnowledgeBaseRequest) => knowledgeBasesApi.update(workspace.id, knowledgeBase.id, body),
    onSuccess: (updated) => void afterKnowledgeBaseUpdated(workspace.id, updated, knowledgeBase),
    onError: (error) => {
      // Our copy of the base (and our level on it) is stale.
      if (hasCode(error, 'KNOWLEDGE_BASE_ACCESS_DENIED', 'KNOWLEDGE_BASE_NOT_FOUND')) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBaseDetail(workspace.id, knowledgeBase.id) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBases(workspace.id) });
      }
    },
  });
}

/** E64. The caller leaves the base's page first, then this drops what's cached. */
export function useDeleteKnowledgeBase() {
  const workspace = useWorkspace();
  return useMutation({
    mutationFn: (knowledgeBase: Pick<KnowledgeBase, 'id'>) => knowledgeBasesApi.remove(workspace.id, knowledgeBase.id),
  });
}

export function forgetKnowledgeBase(workspaceId: string, knowledgeBaseId: string): Promise<unknown> {
  return afterKnowledgeBaseDeleted(workspaceId, knowledgeBaseId);
}

/** E66: grant, or change the level of an existing grant (an upsert). */
export function useUpsertGrant(knowledgeBaseId: string) {
  const workspace = useWorkspace();
  return useMutation({
    mutationFn: (body: { subjectType: GrantSubjectType; subjectId: string; accessLevel: AccessLevel }) =>
      knowledgeBasesApi.upsertGrant(workspace.id, knowledgeBaseId, body),
    onSettled: () => void afterGrantsChanged(workspace.id, knowledgeBaseId),
  });
}

/** E67 */
export function useRevokeGrant(knowledgeBaseId: string) {
  const workspace = useWorkspace();
  return useMutation({
    mutationFn: (grantId: string) => knowledgeBasesApi.revokeGrant(workspace.id, knowledgeBaseId, grantId),
    onSettled: () => void afterGrantsChanged(workspace.id, knowledgeBaseId),
  });
}
