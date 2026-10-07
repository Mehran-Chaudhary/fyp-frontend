import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRealtimeSession, type RealtimeHandlers, type RealtimeSession } from './realtime';
import type { NotificationEvent, RealtimeEvent } from './types';

const mocks = vi.hoisted(() => ({
  io: vi.fn(),
  getAccessToken: vi.fn<() => Promise<string | null>>(),
  refreshAccessToken: vi.fn<() => Promise<string | null>>(),
  authListeners: new Map<string, Set<() => void>>(),
}));
vi.mock('socket.io-client', () => ({ io: mocks.io }));
vi.mock('@/lib/api/token-manager', () => ({
  getAccessToken: mocks.getAccessToken,
  refreshAccessToken: mocks.refreshAccessToken,
  authEvents: {
    on: (event: string, listener: () => void) => {
      const listeners = mocks.authListeners.get(event) ?? new Set<() => void>();
      listeners.add(listener); mocks.authListeners.set(event, listeners);
      return () => listeners.delete(listener);
    },
  },
}));

type Listener = (...args: unknown[]) => void;
type PendingMessage = { event: string; payload: Record<string, unknown>; reply: (error: Error | null, acknowledgement: unknown) => void };
class FakeSocket {
  connected = false;
  auth: unknown;
  listeners = new Map<string, Listener[]>();
  managerListeners = new Map<string, Listener[]>();
  messages: PendingMessage[] = [];
  hold = new Set<string>();
  responses = new Map<string, unknown>();
  order: string[] = [];
  on = vi.fn((event: string, callback: Listener) => { this.listeners.set(event, [...this.listeners.get(event) ?? [], callback]); return this; });
  removeAllListeners = vi.fn(() => { this.listeners.clear(); return this; });
  connect = vi.fn(() => { this.connected = true; return this; });
  disconnect = vi.fn(() => {
    const wasConnected = this.connected; this.connected = false;
    if (wasConnected) this.fire('disconnect', 'io client disconnect');
    return this;
  });
  io = {
    on: vi.fn((event: string, callback: Listener) => { this.managerListeners.set(event, [...this.managerListeners.get(event) ?? [], callback]); }),
    removeAllListeners: vi.fn((event: string) => this.managerListeners.delete(event)),
  };
  timeout = vi.fn(() => ({ emit: (event: string, payload: Record<string, unknown>, reply: PendingMessage['reply']) => {
    this.order.push(event);
    this.messages.push({ event, payload, reply });
    if (this.hold.has(event)) return;
    reply(null, this.responses.get(event) ?? { ok: true, events: [], replayed: 0, ...(event === 'auth:refresh' ? { expiresAt: Date.now() + 900000 } : {}) });
  } }));
  fire(event: string, ...args: unknown[]) { for (const callback of this.listeners.get(event) ?? []) callback(...args); }
  fireManager(event: string, ...args: unknown[]) { for (const callback of this.managerListeners.get(event) ?? []) callback(...args); }
  ready(expiresAt: number | null = null) { this.fire('ready', { organizationId: 'workspace-a', rooms: [], expiresAt, serverTime: new Date().toISOString() }); }
}

let socket: FakeSocket;
let sessions: RealtimeSession[];
const flush = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); };
const event = (id: string, runId = 'run-a', organizationId = 'workspace-a'): RealtimeEvent => ({ id, type: 'step.completed', organizationId, at: '2026-10-08T00:00:00.000Z', runId, nodeId: 'step', data: { iteration: 0, handles: ['out'] } });
const notification = (id: string): NotificationEvent => ({ id, type: 'notification', organizationId: 'workspace-a', at: '2026-10-08T00:00:00.000Z', data: { kind: 'quota.threshold' } });
function create() {
  const handlers: RealtimeHandlers = { status: vi.fn(), event: vi.fn(), notification: vi.fn(), reconcile: vi.fn(() => socket.order.push('REST')) };
  const session = createRealtimeSession('workspace-a', handlers);
  sessions.push(session);
  return { session, handlers };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authListeners.clear();
  mocks.getAccessToken.mockResolvedValue('initial-token');
  mocks.refreshAccessToken.mockResolvedValue('refreshed-token');
  socket = new FakeSocket();
  mocks.io.mockReturnValue(socket);
  sessions = [];
});
afterEach(() => { sessions.forEach((session) => session.close()); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('workspace real-time session', () => {
  it('cannot create a socket after cleanup while token acquisition is pending', async () => {
    let release!: (token: string) => void;
    mocks.getAccessToken.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const remove = vi.spyOn(document, 'removeEventListener');
    const { session, handlers } = create();
    session.watch('run-a');
    session.close();
    release('late-token');
    await flush();
    expect(mocks.io).not.toHaveBeenCalled();
    expect(handlers.status).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect([...mocks.authListeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
  });

  it('shares a run subscription until its last screen leaves', async () => {
    const { session } = create();
    const leaveOne = session.watch('run-a');
    const leaveTwo = session.watch('run-a');
    await flush(); socket.ready(); await flush();
    expect(socket.messages.filter((message) => message.event === 'subscribe')).toHaveLength(1);
    expect(socket.messages.find((message) => message.event === 'subscribe')?.payload).toEqual({ runId: 'run-a', lastEventId: '0-0' });
    leaveOne(); await flush();
    expect(socket.messages.filter((message) => message.event === 'unsubscribe')).toHaveLength(0);
    leaveTwo(); await flush();
    expect(socket.messages.filter((message) => message.event === 'unsubscribe')).toHaveLength(1);
    expect(socket.messages.find((message) => message.event === 'unsubscribe')?.payload).toEqual({ runId: 'run-a' });
  });

  it('sorts replay numerically, deduplicates live overlap, and uses each run cursor', async () => {
    socket.responses.set('subscribe', { ok: true, events: [event('100-1'), event('9-2'), event('100-0'), event('9-2')], replayed: 4 });
    const { session, handlers } = create();
    session.watch('run-a');
    await flush(); socket.ready(); await flush();
    expect(vi.mocked(handlers.event).mock.calls.map(([item]) => item.id)).toEqual(['9-2', '100-0', '100-1']);
    socket.fire('event', event('100-1'));
    socket.fire('event', event('101-0'));
    socket.fire('event', event('1000-0', 'run-a', 'another-workspace'));
    socket.fire('notification', notification('200-0'));
    socket.fire('notification', notification('200-0'));
    expect(vi.mocked(handlers.event).mock.calls.map(([item]) => item.id)).toEqual(['9-2', '100-0', '100-1', '101-0']);
    expect(handlers.notification).toHaveBeenCalledTimes(1);
    socket.messages = [];
    session.recover(); await flush();
    expect(socket.messages.find((message) => message.event === 'subscribe')?.payload).toEqual({ runId: 'run-a', lastEventId: '101-0' });
    expect(socket.messages.find((message) => message.event === 'resume')?.payload).toEqual({ lastEventId: '200-0' });
    session.watch('run-b'); await flush();
    expect(socket.messages.filter((message) => message.event === 'subscribe').at(-1)?.payload).toEqual({ runId: 'run-b', lastEventId: '0-0' });
  });

  it('reconciles REST after subscription and room replay have both recovered', async () => {
    const { session } = create();
    session.watch('run-a');
    await flush(); socket.ready(); await flush();
    socket.order = [];
    session.recover(); await flush();
    expect(socket.order).toEqual(['subscribe', 'resume', 'REST']);
  });

  it('renews the token in place without a second socket or reconnect', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T00:00:00.000Z'));
    create(); await flush(); socket.ready(Date.now() + 30000); await flush();
    mocks.getAccessToken.mockResolvedValue('new-token');
    await vi.advanceTimersByTimeAsync(5000); await flush();
    expect(mocks.io).toHaveBeenCalledTimes(1);
    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(socket.messages.find((message) => message.event === 'auth:refresh')?.payload).toEqual({ token: 'new-token' });
    expect(socket.auth).toEqual({ token: 'new-token', organizationId: 'workspace-a' });
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('pushes an HTTP token change and never reconnects after access is revoked', async () => {
    const { session, handlers } = create(); await flush(); socket.ready(); await flush();
    mocks.getAccessToken.mockResolvedValue('updated-http-token');
    for (const listener of mocks.authListeners.get('token-changed') ?? []) listener();
    await flush();
    expect(socket.messages.find((message) => message.event === 'auth:refresh')?.payload).toEqual({ token: 'updated-http-token' });
    socket.fire('auth:revoked', { code: 'PERMISSION_DENIED' }); await flush();
    const connections = socket.connect.mock.calls.length;
    session.recover();
    for (const listener of mocks.authListeners.get('token-changed') ?? []) listener();
    await flush();
    expect(handlers.status).toHaveBeenLastCalledWith('revoked', expect.any(String));
    expect(socket.connect).toHaveBeenCalledTimes(connections);
    expect(socket.disconnect).toHaveBeenCalled();
    expect(mocks.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('refreshes a refused token once and keeps the same socket instance', async () => {
    const { handlers } = create(); await flush();
    const expired = Object.assign(new Error('Expired'), { data: { code: 'AUTH_TOKEN_EXPIRED' } });
    socket.fire('connect_error', expired); await flush();
    expect(mocks.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(mocks.io).toHaveBeenCalledTimes(1);
    expect(socket.auth).toEqual({ token: 'refreshed-token', organizationId: 'workspace-a' });
    socket.fire('connect_error', expired); await flush();
    expect(mocks.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(handlers.status).toHaveBeenLastCalledWith('offline', expect.stringContaining('refused'));
  });

  it('reports an offline state after a server close and after retries are exhausted', async () => {
    const { handlers } = create(); await flush(); socket.ready(); await flush();
    socket.connected = false;
    socket.fire('disconnect', 'io server disconnect');
    expect(handlers.status).toHaveBeenLastCalledWith('offline', expect.stringContaining('server closed'));
    socket.fireManager('reconnect_failed');
    expect(handlers.status).toHaveBeenLastCalledWith('offline', expect.stringContaining('repeated failures'));
    expect(handlers.reconcile).toHaveBeenCalled();
  });

  it('removes socket and manager listeners on close and ignores late acknowledgements', async () => {
    socket.hold.add('subscribe');
    const { session, handlers } = create();
    session.watch('run-a'); await flush(); socket.ready(); await flush();
    const pending = socket.messages.find((message) => message.event === 'subscribe');
    vi.mocked(handlers.reconcile).mockClear();
    session.close();
    pending?.reply(null, { ok: true, events: [event('100-0')], replayed: 1 });
    await flush();
    expect(socket.removeAllListeners).toHaveBeenCalled();
    expect(socket.io.removeAllListeners).toHaveBeenCalledWith('reconnect_failed');
    expect(handlers.event).not.toHaveBeenCalled();
    expect(handlers.reconcile).not.toHaveBeenCalled();
  });
});
