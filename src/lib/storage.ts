/**
 * localStorage wrapper that never throws. Private windows, blocked site data and
 * storage quotas all make the raw API throw; none of the values kept here are
 * critical, so a failure simply behaves like an empty store.
 *
 * Only non-sensitive values are allowed here. Tokens never touch storage.
 */
export const STORAGE_KEYS = {
  hasSession: 'av.hasSession',
  lastWorkspace: 'av.lastWorkspace',
  sidebarCollapsed: 'av.sidebarCollapsed',
  erasureDisabled: 'av.erasureDisabled',
} as const;

type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

export const storage = {
  get(key: StorageKey): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: StorageKey, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* storage unavailable: the value is a convenience only */
    }
  },
  remove(key: StorageKey): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  },
  /** True when storage itself cannot be read (not merely empty). */
  unavailable(): boolean {
    try {
      window.localStorage.getItem('av.probe');
      return false;
    } catch {
      return true;
    }
  },
};
