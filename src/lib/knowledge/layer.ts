import { create } from 'zustand';

/**
 * What the knowledge layer can't do on this server (Phase 3 spec §10). Uploads,
 * reindexing, downloads and search need object storage, Qdrant and the AI service;
 * until a server has them it answers 503 KNOWLEDGE_LAYER_NOT_CONFIGURED naming the
 * missing settings. The first such answer is remembered for the session, so the
 * screens disable exactly what can't work and say why, while lists, details,
 * chunks and management keep working.
 */

export type KnowledgeCapability = 'upload' | 'reindex' | 'download' | 'search';

/** The server settings each capability needs (§10). */
const NEEDS: Readonly<Record<KnowledgeCapability, readonly string[]>> = {
  upload: ['STORAGE_S3_BUCKET', 'QDRANT_URL', 'AI_SERVICE_URL'],
  reindex: ['STORAGE_S3_BUCKET', 'QDRANT_URL', 'AI_SERVICE_URL'],
  download: ['STORAGE_S3_BUCKET'],
  search: ['QDRANT_URL', 'AI_SERVICE_URL'],
};

export interface LayerGap {
  /** Settings the server said are missing. */
  missing: string[];
  /** Capabilities refused without naming a setting (older servers, odd proxies). */
  refused: KnowledgeCapability[];
  /** When it was first seen, for the banner's key. */
  since: number;
}

interface LayerState {
  gaps: Record<string, LayerGap>;
}

export const useKnowledgeLayer = create<LayerState>(() => ({ gaps: {} }));

/** Records a 503 KNOWLEDGE_LAYER_NOT_CONFIGURED answer. */
export function recordLayerGap(
  workspaceId: string,
  missingConfiguration: readonly string[],
  capability?: KnowledgeCapability,
): void {
  useKnowledgeLayer.setState((state) => {
    const current = state.gaps[workspaceId];
    const missing = Array.from(new Set([...(current?.missing ?? []), ...missingConfiguration])).sort();
    const refused =
      capability && missingConfiguration.length === 0
        ? Array.from(new Set([...(current?.refused ?? []), capability]))
        : (current?.refused ?? []);
    if (current && current.missing.length === missing.length && current.refused.length === refused.length) return state;
    return { gaps: { ...state.gaps, [workspaceId]: { missing, refused, since: current?.since ?? Date.now() } } };
  });
}

/** "Check again": forget what was seen, so the next call finds out afresh. */
export function clearLayerGap(workspaceId: string): void {
  useKnowledgeLayer.setState((state) => {
    if (!state.gaps[workspaceId]) return state;
    const gaps = { ...state.gaps };
    delete gaps[workspaceId];
    return { gaps };
  });
}

/** Whether a capability is known not to work, given a workspace's gap. */
export function capabilityBlocked(gap: LayerGap | undefined, capability: KnowledgeCapability): boolean {
  if (!gap) return false;
  if (gap.refused.includes(capability)) return true;
  return NEEDS[capability].some((setting) => gap.missing.includes(setting));
}

/** Pulls `missingConfiguration` out of an error's details. */
export function missingConfigurationOf(details: Record<string, unknown> | undefined): string[] {
  const value = details?.missingConfiguration;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
