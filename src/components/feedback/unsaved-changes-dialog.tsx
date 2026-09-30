import { TriangleAlert } from 'lucide-react';
import type { Blocker } from 'react-router';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/** "Discard unsaved changes?" while a navigation is held by `useUnsavedChanges`. */
export function UnsavedChangesDialog({ blocker }: { blocker: Blocker }) {
  return (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => {
        if (!open && blocker.state === 'blocked') blocker.reset();
      }}
      icon={<TriangleAlert />}
      tone="warning"
      title="Discard unsaved changes?"
      description="You've made changes on this page that haven't been saved. Leaving now discards them."
      confirmLabel="Discard and leave"
      confirmVariant="danger"
      onConfirm={() => {
        if (blocker.state === 'blocked') blocker.proceed();
      }}
    />
  );
}
