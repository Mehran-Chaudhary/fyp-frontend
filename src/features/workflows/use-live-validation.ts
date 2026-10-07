import { useEffect, useRef, useState } from 'react';
import { workflowsApi } from '@/lib/api/workflows';
import { normalizeGraph } from '@/lib/workflows/graph';
import { createValidationQueue } from '@/lib/workflows/validation-queue';
import type { ValidationReport, WorkflowGraph } from '@/lib/workflows/types';

export function useLiveValidation(workspaceId: string, graph: WorkflowGraph, enabled: boolean, initial: ValidationReport) {
  const [report, setReport] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [revision, setRevision] = useState(0);
  const queue = useRef<ReturnType<typeof createValidationQueue<WorkflowGraph, ValidationReport>> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const next = createValidationQueue<WorkflowGraph, ValidationReport>({
      validate: (value, signal) => workflowsApi.validate(workspaceId, normalizeGraph(value), signal),
      onResult: (_, value) => { setReport(value); setError(null); },
      onError: (failure) => setError(failure instanceof Error ? failure : new Error('Validation could not finish.')),
      onPending: setPending,
    });
    queue.current = next;
    return () => { next.close(); queue.current = null; };
  }, [workspaceId, enabled]);
  useEffect(() => { if (enabled) queue.current?.submit(graph); }, [graph, enabled, workspaceId, revision]);
  return { report, pending: enabled && pending, error, retry: () => setRevision((value) => value + 1) };
}
