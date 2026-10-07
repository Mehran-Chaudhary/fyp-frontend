import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { createRealtimeSession, type LiveStatus, type RealtimeSession } from '@/lib/runs/realtime';
import { applyRunEvent, compareEventIds } from '@/lib/runs/state';
import { runKeys } from '@/lib/api/runs';
import type { RunDetail } from '@/lib/runs/types';
import { toast } from '@/lib/toast';
import { RealtimeContext } from './realtime-context';

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { id } = useWorkspace();
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<{ status: LiveStatus; reason?: string }>({ status: 'connecting' });
  const [session, setSession] = useState<RealtimeSession | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const cursors = new Map<string, string>();
    let reconcileTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = (...areas: string[]) => {
      for (const area of areas) void queryClient.invalidateQueries({ queryKey: ['ws', id, area] });
    };
    const reconcile = () => {
      clearTimeout(reconcileTimer);
      reconcileTimer = setTimeout(() => refresh('run', 'runs', 'approvals', 'dead-letters'), 350);
    };
    const client = createRealtimeSession(id, {
      status: (status, reason) => setConnection({ status, reason }), reconcile,
      event: event => {
        if (event.runId) {
          const previous = cursors.get(event.runId);
          if (!previous || compareEventIds(event.id, previous) > 0) {
            cursors.set(event.runId, event.id);
            queryClient.setQueryData<RunDetail>(runKeys.detail(id, event.runId), run => run ? applyRunEvent(run, event) : undefined);
          }
        }
        // REST supplies newly scheduled steps, loop metadata and final timings.
        reconcile();
      },
      notification: event => {
        const kind = event.data.kind;
        if (kind === 'agent_email') toast.info('Agent email sent');
        else if (kind === 'agent.circuit_opened') { toast.warning('An agent has been paused', { description: 'Review its circuit breaker in Governance.' }); refresh('circuits', 'circuit'); }
        else { toast.warning(kind === 'quota.exhausted' ? 'Token quota exhausted' : 'Token quota threshold reached', { description: 'Review consumption in Governance.' }); refresh('quotas', 'quota'); }
      },
    });
    // The setter is an external subscription initialisation, scheduled after setup.
    queueMicrotask(() => setSession(client));
    return () => { clearTimeout(reconcileTimer); client.close(); cursors.clear(); };
  }, [id, queryClient, attempt]);
  return <RealtimeContext.Provider value={{ ...connection, session, reconnect: () => { setConnection({ status: 'connecting' }); setAttempt(value => value + 1); } }}>{children}</RealtimeContext.Provider>;
}
