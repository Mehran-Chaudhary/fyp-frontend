import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { PiiEntityType } from '@/lib/api/types';
import { piiEntityTypesQuery, piiPolicyQuery } from '@/lib/queries';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';

/** P3-API-17 for holders of pii:policy:read; idle for everyone else. */
export function usePiiPolicy() {
  const workspace = useWorkspace();
  const can = useCan();
  return useQuery({ ...piiPolicyQuery(workspace.id), enabled: can('pii:policy:read') });
}

/**
 * The policy version a redaction report depends on (spec §9.1). Reports wait until
 * the policy has been read (or failed to be), so a report is fetched once, under its
 * final key, instead of twice from the 30-per-minute privacy budget.
 */
export function useReportPolicyVersion(): { version: number | null; settled: boolean } {
  const policy = usePiiPolicy();
  return { version: policy.data?.version ?? null, settled: !policy.isPending || policy.fetchStatus === 'idle' };
}

/** P3-API-19, with a lookup by type, for labels and legends. Best effort: a failure only loses labels. */
export function useEntityTypes() {
  const workspace = useWorkspace();
  const can = useCan();
  const query = useQuery({ ...piiEntityTypesQuery(workspace.id), enabled: can('pii:policy:read') });
  const byType = useMemo(
    () => new Map<string, PiiEntityType>((Array.isArray(query.data) ? query.data : []).map((type) => [type.type, type])),
    [query.data],
  );
  return { ...query, list: query.data ?? [], byType };
}
