import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { piiApi } from '@/lib/api/endpoints';
import type { AnalyzeResult, UpdatePiiPolicyRequest } from '@/lib/api/types';
import { afterPolicyUpdated } from '@/lib/knowledge/cache';
import { queryKeys } from '@/lib/queries';
import { queryClient } from '@/lib/query-client';
import { useWorkspace } from '@/features/workspaces/workspace-context';

/**
 * P3-API-18. Never retried: every successful save bumps the version and writes an
 * audit record (P3-G05), so a lost answer is reconciled by reading the policy back.
 */
export function useUpdatePolicy() {
  const workspace = useWorkspace();
  return useMutation({
    mutationFn: (body: UpdatePiiPolicyRequest) => piiApi.updatePolicy(workspace.id, body),
    onSuccess: (policy) => void afterPolicyUpdated(workspace.id, policy),
  });
}

/** Re-reads the policy from the server (after a 409 or a lost answer). */
export function refetchPolicy(workspaceId: string) {
  return queryClient.fetchQuery({
    queryKey: queryKeys.piiPolicy(workspaceId),
    queryFn: ({ signal }) => piiApi.policy(workspaceId, signal),
    staleTime: 0,
  });
}

/** One analysis, as shown: what was asked, under which policy version, and the answer. */
export interface Analysis {
  result: AnalyzeResult;
  /** The policy version the preview ran under, to flag a result made stale by a save. */
  policyVersion: number | null;
  /** When revealed values hide again (epoch ms). */
  expiresAt: number | null;
}

/**
 * P3-API-20. The text and the result are sensitive (spec §9.2): they live in this
 * hook's state only, never in the query cache, storage, the URL or logs, and are
 * dropped when the screen goes away. Revealed values also hide when the tab is
 * hidden and after a minute.
 */
export function useAnalyze(revealForMs = 60_000) {
  const workspace = useWorkspace();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [failedAt, setFailedAt] = useState(0);
  const [pending, setPending] = useState(false);
  const request = useRef<AbortController | null>(null);

  const run = async (text: string, options: { reveal: boolean; policyVersion: number | null }) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      const result = await piiApi.analyze(workspace.id, { text, ...(options.reveal ? { reveal: true } : {}) }, controller.signal);
      if (controller.signal.aborted) return;
      setAnalysis({
        result,
        policyVersion: options.policyVersion,
        expiresAt: result.revealed ? Date.now() + revealForMs : null,
      });
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught);
      setFailedAt(Date.now());
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  };

  /** Drops revealed values but keeps a masked result: the values can't be told apart once hidden. */
  const hideValues = () => setAnalysis((current) => (current?.result.revealed ? null : current));

  const clear = () => {
    request.current?.abort();
    request.current = null;
    setAnalysis(null);
    setError(null);
    setPending(false);
  };

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') setAnalysis((current) => (current?.result.revealed ? null : current));
    };
    document.addEventListener('visibilitychange', onVisibility);
    const inFlight = request;
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      inFlight.current?.abort();
    };
  }, []);

  return {
    analysis,
    error,
    failedAt,
    pending,
    run: (text: string, options: { reveal: boolean; policyVersion: number | null }) => void run(text, options),
    hideValues,
    clear,
  };
}
