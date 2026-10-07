import { createContext, useContext } from 'react';
import type { LiveStatus, RealtimeSession } from '@/lib/runs/realtime';
export interface RealtimeContextValue { status: LiveStatus; reason?: string; session: RealtimeSession | null; reconnect: () => void }
export const RealtimeContext = createContext<RealtimeContextValue>({ status: 'connecting', session: null, reconnect: () => {} });
export const useRealtime = () => useContext(RealtimeContext);
