import { API_BASE_URL } from '@/lib/env';
import { readJson } from './errors';
import type { HealthReport, Liveness } from './types';

/**
 * The three root health probes (P1-API-27/28/29). They live on the API's origin,
 * outside `/api/v1`, are public, and are diagnostics only: nothing in the app waits
 * on them, and they are never polled to gate navigation (spec §10). Liveness alone
 * proves the process runs, not that sign-in works.
 */

/** The API's origin: `http://localhost:3000` for `http://localhost:3000/api/v1`, or this site's for `/api/v1`. */
export function apiOrigin(): string {
  try {
    return new URL(API_BASE_URL, window.location.origin).origin;
  } catch {
    return window.location.origin;
  }
}

export const healthUrl = (path: '' | '/live' | '/ready') => `${apiOrigin()}/health${path}`;

export type ProbeOutcome<T> =
  | { kind: 'ok'; status: number; data: T; requestId: string | null; ms: number }
  /** The server answered with a failure (503 when a check fails). */
  | { kind: 'failed'; status: number; data: T | null; message: string | null; requestId: string | null; ms: number }
  /** No answer at all, or one that isn't the API's. */
  | { kind: 'unreachable'; message: string; ms: number };

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: unknown };
  meta?: { requestId?: string };
}

async function probe<T>(path: '' | '/live' | '/ready', signal?: AbortSignal): Promise<ProbeOutcome<T>> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  let res: Response;
  try {
    res = await fetch(healthUrl(path), {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { kind: 'unreachable', message: 'No answer from the API.', ms: elapsed() };
  }

  const body = (await readJson(res)) as Envelope<T> | T | null;
  const envelope = body && typeof body === 'object' && ('success' in body || 'error' in body) ? (body as Envelope<T>) : null;
  const requestId = envelope?.meta?.requestId ?? res.headers.get('x-request-id');

  if (!envelope && body === null) {
    return { kind: 'unreachable', message: `The API answered HTTP ${res.status} with something other than JSON.`, ms: elapsed() };
  }

  if (res.ok) {
    const data = (envelope ? envelope.data : body) as T;
    return { kind: 'ok', status: res.status, data, requestId, ms: elapsed() };
  }

  // Terminus puts the report in the error's details when a check fails.
  const details = envelope?.error?.details;
  const data = details && typeof details === 'object' ? (details as T) : null;
  return {
    kind: 'failed',
    status: res.status,
    data,
    message: envelope?.error?.message ?? null,
    requestId,
    ms: elapsed(),
  };
}

export const healthApi = {
  live: (signal?: AbortSignal) => probe<Liveness>('/live', signal),
  ready: (signal?: AbortSignal) => probe<HealthReport>('/ready', signal),
  full: (signal?: AbortSignal) => probe<HealthReport>('', signal),
};

export interface ComponentStatus {
  name: string;
  status: string;
}

/**
 * Component names and their up/down status from a Terminus report, without the
 * messages inside: a summary, never an infrastructure dump (spec §10, P1-API-29).
 */
export function summarizeReport(report: Partial<HealthReport> | null | undefined): ComponentStatus[] {
  if (!report || typeof report !== 'object') return [];
  const source = (report.details ?? { ...report.info, ...report.error }) as Record<string, unknown> | undefined;
  if (!source || typeof source !== 'object') return [];
  return Object.entries(source)
    .map(([name, value]) => ({
      name,
      status:
        value && typeof value === 'object' && typeof (value as { status?: unknown }).status === 'string'
          ? String((value as { status: string }).status)
          : 'unknown',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
