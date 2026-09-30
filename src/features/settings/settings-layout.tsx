import { KeySquare, Settings2, ShieldCheck } from 'lucide-react';
import { Outlet } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { PageHeader } from '@/components/feedback/states';
import { Card } from '@/components/ui/card';
import { TabNav, type TabNavItem } from '@/components/ui/tab-nav';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';

/**
 * Settings: General, Security and API keys (spec §4). Each tab checks its own
 * permission, so someone with only apikey:read still reaches API keys.
 */
export function SettingsLayout() {
  const workspace = useWorkspace();
  const can = useCan();
  const base = `/w/${workspace.slug}/settings`;

  const tabs: TabNavItem[] = [];
  if (can('workspace:read')) {
    tabs.push({ to: base, label: 'General', icon: Settings2, isActive: (path) => path === base });
    tabs.push({ to: `${base}/security`, label: 'Security', icon: ShieldCheck });
  }
  if (can('apikey:read')) tabs.push({ to: `${base}/api-keys`, label: 'API keys', icon: KeySquare });

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Settings"
        description={`The profile, security policy and machine access of ${workspace.name}.`}
      />
      {tabs.length > 0 ? (
        <>
          <TabNav items={tabs} aria-label="Settings sections" className="-mt-1" />
          <Outlet />
        </>
      ) : (
        <Card>
          <NoAccessState permissions={['workspace:read', 'apikey:read']} workspaceName={workspace.name} />
        </Card>
      )}
    </div>
  );
}
