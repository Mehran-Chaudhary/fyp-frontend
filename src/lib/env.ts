/**
 * Runtime configuration. Nothing here may hard-code a host: production serves the
 * API from the frontend's own site through a reverse proxy (spec §3.9).
 */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/+$/, '');

export const APP_NAME = import.meta.env.VITE_APP_NAME || 'AgentVault';

/**
 * The liveness probe lives outside the `/api/v1` prefix, on the same origin as the
 * API (spec §3.1, E29).
 */
export const HEALTH_URL = (() => {
  try {
    const api = new URL(API_BASE_URL, window.location.origin);
    return new URL('/health/live', api.origin).toString();
  } catch {
    return '/health/live';
  }
})();

export const IS_DEV = import.meta.env.DEV;
