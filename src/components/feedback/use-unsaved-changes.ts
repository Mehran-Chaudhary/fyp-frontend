import { useCallback, useEffect, useRef } from 'react';
import { useBlocker, type Blocker } from 'react-router';

/**
 * Warns before leaving a page with unsaved edits: in-app navigation is held by
 * a router blocker (render <UnsavedChangesDialog blocker={…} />), and closing or
 * reloading the tab gets the browser's own prompt. Call `allowNavigation()` right
 * before navigating away on purpose, e.g. after a successful save.
 */
export function useUnsavedChanges(when: boolean): { blocker: Blocker; allowNavigation: () => void } {
  const bypass = useRef(false);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      when && !bypass.current && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!when) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [when]);

  const allowNavigation = useCallback(() => {
    bypass.current = true;
  }, []);

  return { blocker, allowNavigation };
}
