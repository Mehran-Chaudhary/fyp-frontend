import { documentsApi } from '../api/endpoints';
import { downloadBlob } from '../utils';

export { filenameFromDisposition } from '../api/content-disposition';

/**
 * E72: fetch the original file and save it under its real name (RFC 5987
 * `filename*` first). Goes through the API client, so an expired token is
 * refreshed once and errors arrive as ApiError; the server allows 120 s.
 */
export async function downloadDocument(workspaceId: string, documentId: string, fallbackName: string): Promise<void> {
  const { blob, filename } = await documentsApi.download(workspaceId, documentId);
  downloadBlob(filename ?? fallbackName, blob);
}
