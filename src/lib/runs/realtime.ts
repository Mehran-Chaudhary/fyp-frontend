import { io, type Socket } from 'socket.io-client';
import { authEvents, getAccessToken, refreshAccessToken } from '@/lib/api/token-manager';
import { API_BASE_URL } from '@/lib/env';
import { compareEventIds } from './state';
import type { Ack, NotificationEvent, ReadyPayload, RealtimeEvent, ResumeAck, SubscribeAck, RefreshAck } from './types';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'revoked';
export interface RealtimeHandlers {
  status: (status: LiveStatus, reason?: string) => void;
  event: (event: RealtimeEvent) => void;
  notification: (event: NotificationEvent) => void;
  reconcile: () => void;
}
export interface RealtimeSession { watch: (runId: string) => () => void; recover: () => void; close: () => void }
const REFRESH_CODES = new Set(['AUTH_TOKEN_MISSING', 'AUTH_TOKEN_INVALID', 'AUTH_TOKEN_EXPIRED', 'AUTH_TOKEN_REVOKED']);

/** One instance per mounted workspace. All cursors and notifications are memory-only. */
export function createRealtimeSession(ws: string, handlers: RealtimeHandlers): RealtimeSession {
  let socket: Socket | null = null;
  let closed = false;
  let ready = false;
  let revoked = false;
  let refreshedHandshake = false;
  let roomCursor = '0-0';
  let lastToken = '';
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const runs = new Map<string, { count: number; cursor: string }>();
  const seen = new Set<string>();
  const emit = <T extends Ack>(event: string, payload: unknown): Promise<T> => new Promise(resolve => {
    if (!socket?.connected) { resolve({ ok: false, code: 'DISCONNECTED', message: 'Live updates are disconnected.' } as T); return; }
    socket.timeout(10_000).emit(event, payload, (error: Error | null, ack: T) => resolve(error ? { ok: false, code: 'ACK_TIMEOUT', message: 'Live updates did not acknowledge the request.' } as T : ack));
  });
  const deliver = (event: RealtimeEvent | NotificationEvent) => {
    if (closed || event?.organizationId !== ws || !/^\d+-\d+$/.test(event.id) || !event.data || seen.has(event.id)) return;
    seen.add(event.id);
    if (seen.size > 5000) seen.delete(seen.values().next().value!);
    if (compareEventIds(event.id, roomCursor) > 0) roomCursor = event.id;
    if (event.runId) {
      const watched = runs.get(event.runId);
      if (watched && compareEventIds(event.id, watched.cursor) > 0) watched.cursor = event.id;
    }
    if (event.type === 'notification') handlers.notification(event);
    else handlers.event(event);
  };
  const replay = (events: Array<RealtimeEvent | NotificationEvent>) => [...events].sort((a, b) => compareEventIds(a.id, b.id)).forEach(deliver);
  const subscribe = async (runId: string, cursor: string) => {
    const ack = await emit<SubscribeAck>('subscribe', { runId, lastEventId: cursor });
    if (closed || !runs.has(runId)) return;
    if (ack.ok) replay(ack.events);
    // A refusal must reconcile and evict content through the REST visibility check.
    handlers.reconcile();
  };
  const recover = () => {
    if (!ready || closed) return;
    const lastEventId = roomCursor;
    const snapshot = [...runs].map(([id, state]) => [id, state.cursor] as const);
    void (async () => {
      // Limit outbound messages: one current screen normally watches one run.
      for (const [id, cursor] of snapshot) await subscribe(id, cursor);
      const ack = await emit<ResumeAck>('resume', { lastEventId });
      if (closed) return;
      if (ack.ok) replay(ack.events);
      handlers.reconcile();
    })();
  };
  const fail = (status: LiveStatus, reason: string) => {
    if (closed) return;
    ready = false;
    clearTimeout(refreshTimer);
    socket?.disconnect();
    handlers.status(status, reason);
    handlers.reconcile();
  };
  const scheduleRefresh = (expiry: number | null) => {
    clearTimeout(refreshTimer);
    if (!expiry || closed) return;
    refreshTimer = setTimeout(() => { void pushToken(); }, Math.max(1000, expiry - Date.now() - 25_000));
  };
  const pushToken = async () => {
    try {
      const token = await getAccessToken();
      if (closed || !token || !ready) return;
      lastToken = token;
      const ack = await emit<RefreshAck>('auth:refresh', { token });
      if (ack.ok) scheduleRefresh(ack.expiresAt);
      else fail('offline', 'The live connection needs to be reconnected.');
    } catch { fail('offline', 'Session renewal paused live updates. HTTP refresh remains available.'); }
  };
  const connect = async (forceRefresh = false) => {
    try {
      const token = await (forceRefresh ? refreshAccessToken() : getAccessToken());
      if (closed || revoked || !token) return;
      lastToken = token;
      if (socket) {
        socket.auth = { token, organizationId: ws };
        socket.connect();
        return;
      }
      socket = io(new URL(API_BASE_URL, window.location.origin).origin, {
        path: '/realtime', transports: ['websocket'], auth: { token, organizationId: ws },
        autoConnect: false, reconnectionAttempts: 8, reconnectionDelay: 2000, reconnectionDelayMax: 30_000,
      });
      socket.on('ready', (payload: ReadyPayload) => {
        if (payload.organizationId !== ws || closed) return;
        ready = true;
        refreshedHandshake = false;
        handlers.status('live');
        scheduleRefresh(payload.expiresAt);
        recover();
      });
      socket.on('event', deliver);
      socket.on('notification', deliver);
      socket.on('disconnect', () => { if (!closed && !revoked) { ready = false; handlers.status('reconnecting', 'Reconnecting live updates. REST remains available.'); } });
      socket.on('connect_error', (error: Error & { data?: { code?: string } }) => {
        const code = error.data?.code;
        if (code && REFRESH_CODES.has(code) && !refreshedHandshake) { refreshedHandshake = true; void connect(true); }
        else if (code) { fail('offline', `Live connection refused (${code}).`); }
        else handlers.status('offline', 'Live connection unavailable. Check the network and backend origin settings.');
      });
      socket.on('auth:expired', () => {
        ready = false;
        if (!refreshedHandshake) { refreshedHandshake = true; void connect(true); }
        else fail('offline', 'The live session expired. Reconnect to continue.');
      });
      socket.on('auth:revoked', () => { revoked = true; fail('revoked', 'Live access was revoked. Refresh your workspace access.'); });
      socket.on('error', (error: { code?: string }) => {
        if (error.code === 'RATE_LIMIT_EXCEEDED') fail('offline', 'Live updates were rate limited. Wait before reconnecting.');
      });
      socket.connect();
    } catch { fail('offline', 'Could not establish the live session.'); }
  };
  const visibility = () => { if (document.visibilityState === 'visible') recover(); };
  document.addEventListener('visibilitychange', visibility);
  const stopAuth = authEvents.on('session-ended', () => { revoked = true; fail('revoked', 'Your session ended.'); });
  const stopToken = authEvents.on('token-changed', () => {
    if (!closed && ready) void getAccessToken().then(token => { if (token && token !== lastToken) void pushToken(); }).catch(() => {});
  });
  void connect();
  return {
    watch(runId) {
      const state = runs.get(runId);
      if (state) state.count += 1;
      else { runs.set(runId, { count: 1, cursor: '0-0' }); if (ready) void subscribe(runId, '0-0'); }
      return () => {
        const current = runs.get(runId);
        if (!current || --current.count > 0) return;
        runs.delete(runId);
        if (ready) void emit('unsubscribe', { runId });
      };
    }, recover,
    close() { closed = true; clearTimeout(refreshTimer); stopAuth(); stopToken(); document.removeEventListener('visibilitychange', visibility); socket?.removeAllListeners(); socket?.disconnect(); runs.clear(); seen.clear(); },
  };
}
