import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/**
 * The invite dialog's open state lives in the URL (`?invite=1`), so any tab can
 * open it without shared state and the dashboard can link straight to it.
 */
export function useInviteDialog(): [open: boolean, setOpen: (open: boolean) => void] {
  const [params, setParams] = useSearchParams();
  const open = params.get('invite') === '1';
  const setOpen = useCallback(
    (next: boolean) => {
      setParams(
        (previous) => {
          const updated = new URLSearchParams(previous);
          if (next) updated.set('invite', '1');
          else updated.delete('invite');
          return updated;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [setParams],
  );
  return [open, setOpen];
}
