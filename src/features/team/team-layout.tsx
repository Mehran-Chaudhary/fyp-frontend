import { useQuery } from '@tanstack/react-query';
import { KeyRound, MailPlus, Plus, UserPlus, Users } from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router';
import { NoAccessState } from '@/components/feedback/no-access';
import { PageHeader } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TabNav, type TabNavItem } from '@/components/ui/tab-nav';
import { workspaceDetailsQuery } from '@/lib/queries';
import { pluralize } from '@/lib/utils';
import { useCan, useWorkspace } from '@/features/workspaces/workspace-context';
import { InviteDialog } from './invite-dialog';
import { useInviteDialog } from './use-invite-dialog';

/**
 * Team: Members, Invitations and Roles behind one header and tab bar (spec §4).
 * Tabs the member can't see are hidden; opening one directly shows a no-access
 * state rendered by the tab itself.
 */
export function TeamLayout() {
  const workspace = useWorkspace();
  const can = useCan();
  const { pathname } = useLocation();
  const [inviteOpen, setInviteOpen] = useInviteDialog();
  const base = `/w/${workspace.slug}/team`;
  const details = useQuery({ ...workspaceDetailsQuery(workspace.id), enabled: can('workspace:read') });

  const onRoles = pathname.startsWith(`${base}/roles`);
  const canInvite = can('member:invite');

  const tabs: TabNavItem[] = [];
  if (can('member:read')) {
    tabs.push({
      to: base,
      label: 'Members',
      icon: Users,
      isActive: (path) => path === base || path.startsWith(`${base}/members`),
    });
    tabs.push({ to: `${base}/invitations`, label: 'Invitations', icon: MailPlus });
  }
  if (can('role:read')) tabs.push({ to: `${base}/roles`, label: 'Roles', icon: KeyRound });

  const count = details.data?.memberCount;

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Team"
        description={
          count !== undefined ? (
            <>
              <span className="font-medium text-ink-soft tabular">{pluralize(count, 'active member')}</span> in{' '}
              {workspace.name}. Invite people, decide what each of them can do, and keep access tidy.
            </>
          ) : (
            `The people in ${workspace.name}, their roles, and what each of them can do.`
          )
        }
        actions={
          onRoles ? (
            can('role:create') ? (
              <Button asChild>
                <Link to={`${base}/roles/new`}>
                  <Plus />
                  New role
                </Link>
              </Button>
            ) : null
          ) : canInvite ? (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus />
              Invite people
            </Button>
          ) : null
        }
      />

      {tabs.length > 0 ? (
        <>
          <TabNav items={tabs} aria-label="Team sections" className="-mt-1" />
          <Outlet />
        </>
      ) : (
        <Card>
          <NoAccessState permissions={['member:read', 'role:read']} workspaceName={workspace.name} />
        </Card>
      )}

      {canInvite ? <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} /> : null}
    </div>
  );
}
