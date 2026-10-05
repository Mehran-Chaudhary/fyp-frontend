/**
 * Browser storage wrappers that never throw. Private windows, blocked site data and
 * storage quotas all make the raw API throw; none of the values kept here are
 * critical, so a failure simply behaves like an empty store.
 *
 * Only non-sensitive values are allowed here. Access and refresh tokens never touch
 * storage (Phase 1 spec §4). The one exception is `sessionStore`, which holds a
 * single email-link token for the flow in progress (spec §2), never a session token.
 */
export const STORAGE_KEYS = {
  /** This browser signed in and hasn't signed out: worth a refresh at boot. */
  hasSession: 'av.hasSession',
  /** A sign-out the server never confirmed (spec §4 "Logout network failure"). */
  signOutPending: 'av.signOutPending',
  sidebarCollapsed: 'av.sidebarCollapsed',
  erasureDisabled: 'av.erasureDisabled',
} as const;

type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** Keys that belong to one user: `userKey('lastWorkspace', id)`. */
export type UserScopedKey = 'lastWorkspace';

export function userKey(name: UserScopedKey, userId: string): string {
  return `av.${name}:${userId}`;
}

function local(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const storage = {
  get(key: StorageKey | string): string | null {
    try {
      return local()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key: StorageKey | string, value: string): void {
    try {
      local()?.setItem(key, value);
    } catch {
      /* storage unavailable: the value is a convenience only */
    }
  },
  remove(key: StorageKey | string): void {
    try {
      local()?.removeItem(key);
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

/** The last workspace this user opened: a hint for landing, never authority (spec §5). */
export const lastWorkspace = {
  get: (userId: string): string | null => storage.get(userKey('lastWorkspace', userId)),
  set: (userId: string, workspaceId: string): void => storage.set(userKey('lastWorkspace', userId), workspaceId),
  /** Forget it when it points at `workspaceId` (or always, without one). */
  clear: (userId: string, workspaceId?: string): void => {
    if (!workspaceId || storage.get(userKey('lastWorkspace', userId)) === workspaceId) {
      storage.remove(userKey('lastWorkspace', userId));
    }
  },
};

/** sessionStorage: per tab, survives a reload, gone when the tab closes. */
export const sessionStore = {
  get(key: string): string | null {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  /** Returns false when the value could not be stored. */
  set(key: string, value: string): boolean {
    try {
      window.sessionStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string): void {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      /* unavailable */
    }
  },
};
