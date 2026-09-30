import { useCallback, useState } from 'react';

/**
 * Open state plus the thing a dialog acts on. The target is kept after closing so
 * the dialog's text doesn't blank out during its exit animation.
 */
export function useDialogTarget<T>() {
  const [state, setState] = useState<{ open: boolean; target: T | null }>({ open: false, target: null });
  const show = useCallback((target: T) => setState({ open: true, target }), []);
  const onOpenChange = useCallback((open: boolean) => setState((current) => ({ ...current, open })), []);
  return { open: state.open, target: state.target, show, onOpenChange };
}
