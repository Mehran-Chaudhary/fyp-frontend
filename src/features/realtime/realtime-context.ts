import { createContext, useContext } from 'react';
import type { LiveStatus, RealtimeSession } from '@/lib/runs/realtime';
import { createRunEventJournal } from '@/lib/runs/state';
export interface RealtimeContextValue { status: LiveStatus; reason?: string; session: RealtimeSession | null; reconnect: () => void; journal: ReturnType<typeof createRunEventJournal> }
export const RealtimeContext = createContext<RealtimeContextValue>({ status: 'connecting', session: null, reconnect: () => {}, journal: createRunEventJournal() });
export const useRealtime = () => useContext(RealtimeContext);
