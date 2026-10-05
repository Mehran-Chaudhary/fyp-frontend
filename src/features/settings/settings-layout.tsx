import { Navigate, Outlet } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { PageHeader } from '@/components/feedback/states';
import { Card } from '@/components/ui/card';
import { TabNav } from '@/components/ui/tab-nav';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { settingsTabs } from './settings-tabs';

/** Settings: one header and tab bar over the workspace's administration pages (spec §4). */
export function SettingsLayout() {
  const workspace = useWorkspace();
  const can = useCan();
  const tabs = settingsTabs(`/w/${workspace.slug}/settings`, can);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Settings"
        description={`The profile, defaults, security policy and machine access of ${workspace.name}.`}
      />
      {tabs.length > 0 ? (
        <>
          <TabNav items={tabs} aria-label="Settings sections" className="-mt-1" />
          <Outlet />
        </>
      ) : (
        <Card>
          <NoAccessState permissions={['workspace:read', 'security:read', 'apikey:read']} workspaceName={workspace.name} />
        </Card>
      )}
    </div>
  );
}

/** /settings opens the first tab this member can see. */
export function SettingsIndex() {
  const workspace = useWorkspace();
  const can = useCan();
  const first = settingsTabs(`/w/${workspace.slug}/settings`, can)[0];
  return first ? <Navigate to={first.to} replace /> : null;
}
