import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useWorkspace } from '@/features/workspaces/workspace-context';
import { createRealtimeSession, type LiveStatus, type RealtimeSession } from '@/lib/runs/realtime';
import { applyRunEvent, compareEventIds, createRunEventJournal } from '@/lib/runs/state';
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
  const [journal] = useState(createRunEventJournal);
  useEffect(() => {
    let disposed = false;
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
      status: (status, reason) => {
        if (disposed) return;
        setConnection({ status, reason });
        if (status === 'revoked') {
          void queryClient.cancelQueries({ queryKey: ['ws', id] });
          queryClient.removeQueries({ predicate: query => query.queryKey[0] === 'ws' && query.queryKey[1] === id && ['run', 'runs', 'approvals', 'run-trace'].includes(String(query.queryKey[2])) });
          void queryClient.invalidateQueries({ queryKey: ['ws', id, 'context'] });
        }
      }, reconcile,
      event: event => {
        if (event.runId) {
          const previous = cursors.get(event.runId);
          if (!previous || compareEventIds(event.id, previous) > 0) {
            cursors.set(event.runId, event.id);
            journal.record(event);
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
    queueMicrotask(() => { if (!disposed) setSession(client); });
    return () => { disposed = true; clearTimeout(reconcileTimer); client.close(); cursors.clear(); journal.clear(); };
  }, [id, queryClient, attempt, journal]);
  return <RealtimeContext.Provider value={{ ...connection, session, journal, reconnect: () => { setConnection({ status: 'connecting' }); setAttempt(value => value + 1); } }}>{children}</RealtimeContext.Provider>;
}
