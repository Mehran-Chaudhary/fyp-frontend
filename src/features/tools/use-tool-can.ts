import { useCan } from '@/features/workspaces/workspace-context';

export function useToolCan() {
  const can = useCan();
  return { read: can('tool:read'), create: can('tool:create'), update: can('tool:update'), delete: can('tool:delete'), test: can.all('tool:update', 'tool:execute'), ledger: can.all('tool:read', 'usage:read') };
}
