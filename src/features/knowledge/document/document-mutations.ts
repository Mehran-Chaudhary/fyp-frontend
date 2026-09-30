import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { documentsApi } from '@/lib/api/endpoints';
import { hasCode } from '@/lib/api/errors';
import type { UpdateDocumentRequest, VaultDocument } from '@/lib/api/types';
import { afterDocumentGone, afterDocumentUpdated, afterReindex } from '@/lib/knowledge/cache';
import { downloadDocument } from '@/lib/knowledge/download';
import { queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { toast, toastError } from '@/lib/toast';
import { useWorkspace } from '@/features/workspaces/workspace-context';

/**
 * The document actions of §6.4, shared by the vault's rows and the drawer. Every
 * refusal has a designed message; a 404 means the document is gone for this user
 * (deleted, or reclassified above their clearance) and is handled the same way
 * everywhere.
 */

/** A 404 on a document: drop it from the lists and say so in the same words as everywhere. */
export function handleDocumentGone(workspaceId: string, documentId: string): void {
  void afterDocumentGone(workspaceId, documentId);
  toast.info("This document no longer exists or you don't have access to it", {
    description: 'The list has been refreshed.',
  });
}

/** E74: reindex a READY document, or retry a FAILED one. Not destructive, so no confirmation. */
export function useReindexDocument() {
  const workspace = useWorkspace();
  return useMutation({
    mutationFn: (document: Pick<VaultDocument, 'id' | 'title' | 'status'>) => documentsApi.reindex(workspace.id, document.id),
    onSuccess: (updated, document) => {
      void afterReindex(workspace.id, updated);
      toast.success(document.status === 'FAILED' ? `Retrying “${updated.title}”` : `Reindexing “${updated.title}”`, {
        description:
          document.status === 'FAILED'
            ? 'It’s back in the processing queue.'
            : 'The current version keeps answering searches until the new one is ready.',
      });
    },
    onError: (error, document) => {
      if (hasCode(error, 'DOCUMENT_NOT_FOUND')) return handleDocumentGone(workspace.id, document.id);
      if (hasCode(error, 'DOCUMENT_PROCESSING')) {
        toast.info('Already being processed', { description: 'It will finish on its own; the status updates as it goes.' });
        void queryClient.invalidateQueries({ queryKey: queryKeys.documentDetail(workspace.id, document.id) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.documents(workspace.id) });
        return;
      }
      if (hasCode(error, 'KNOWLEDGE_BASE_ACCESS_DENIED')) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBases(workspace.id) });
      }
      toastError(error, "Couldn't reindex");
    },
  });
}

/** E73: edit metadata or reclassify. The caller shows field errors; this handles the rest. */
export function useUpdateDocument(documentId: string) {
  const workspace = useWorkspace();
  return useMutation({
    mutationFn: (body: UpdateDocumentRequest) => documentsApi.update(workspace.id, documentId, body),
    onSuccess: (updated) => void afterDocumentUpdated(workspace.id, updated),
    onError: (error) => {
      if (hasCode(error, 'DOCUMENT_NOT_FOUND')) handleDocumentGone(workspace.id, documentId);
      if (hasCode(error, 'KNOWLEDGE_BASE_ACCESS_DENIED')) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBases(workspace.id) });
      }
    },
  });
}

/** E75. The caller confirms first; the content is unrecoverable at once. */
export function useDeleteDocument() {
  const workspace = useWorkspace();
  return useMutation({
    mutationFn: (document: Pick<VaultDocument, 'id' | 'title'>) => documentsApi.remove(workspace.id, document.id),
    onSuccess: (_result, document) => {
      void afterDocumentGone(workspace.id, document.id);
      toast.success(`Deleted “${document.title}”`, { description: 'Its content was destroyed and can’t be recovered.' });
    },
    onError: (error, document) => {
      // Already gone: that's what the user wanted.
      if (hasCode(error, 'DOCUMENT_NOT_FOUND')) void afterDocumentGone(workspace.id, document.id);
      if (hasCode(error, 'KNOWLEDGE_BASE_ACCESS_DENIED')) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeBases(workspace.id) });
      }
    },
  });
}

/**
 * E72, with a spinner per document. It can take up to two minutes for big files,
 * and every download is audited.
 */
export function useDownloadDocument() {
  const workspace = useWorkspace();
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());

  const download = async (document: Pick<VaultDocument, 'id' | 'title' | 'originalFilename'>) => {
    if (pendingIds.has(document.id)) return;
    setPendingIds((current) => new Set(current).add(document.id));
    try {
      await downloadDocument(workspace.id, document.id, document.originalFilename || document.title);
    } catch (error) {
      if (hasCode(error, 'DOCUMENT_NOT_FOUND')) handleDocumentGone(workspace.id, document.id);
      else toastError(error, "Couldn't download");
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(document.id);
        return next;
      });
    }
  };

  return { download, isPending: (documentId: string) => pendingIds.has(documentId) };
}
