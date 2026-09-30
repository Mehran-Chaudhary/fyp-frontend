import { createBrowserRouter, Navigate } from 'react-router';
import { Splash } from '@/components/feedback/global-states';
import { AuthLayout } from '@/features/auth/auth-layout';
import { GoodbyePage } from '@/features/misc/goodbye-page';
import { NotFoundPage } from '@/features/misc/not-found-page';
import { RootErrorBoundary } from '@/features/misc/root-error';
import { RootLayout } from '@/features/misc/root-layout';
import { PublicOnly, RequireAuth, RootRedirect } from './guards';

/**
 * Route table (spec §6.1). Paths under /auth/reset-password, /auth/verify-email and
 * /invitations/accept are fixed: the backend emails links to them.
 */
export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RootErrorBoundary />,
    hydrateFallbackElement: <Splash />,
    children: [
      { index: true, element: <RootRedirect /> },

      {
        path: 'auth',
        children: [
          { index: true, element: <Navigate to="/auth/sign-in" replace /> },
          {
            element: <PublicOnly />,
            children: [
              {
                element: <AuthLayout />,
                children: [
                  {
                    path: 'sign-in',
                    lazy: () => import('@/features/auth/sign-in-page').then((m) => ({ Component: m.SignInPage })),
                  },
                  {
                    path: 'sign-up',
                    lazy: () => import('@/features/auth/sign-up-page').then((m) => ({ Component: m.SignUpPage })),
                  },
                  {
                    path: 'forgot-password',
                    lazy: () =>
                      import('@/features/auth/forgot-password-page').then((m) => ({
                        Component: m.ForgotPasswordPage,
                      })),
                  },
                ],
              },
            ],
          },
          {
            element: <AuthLayout />,
            children: [
              {
                path: 'reset-password',
                lazy: () =>
                  import('@/features/auth/reset-password-page').then((m) => ({ Component: m.ResetPasswordPage })),
              },
              {
                path: 'verify-email',
                lazy: () =>
                  import('@/features/auth/verify-email-page').then((m) => ({ Component: m.VerifyEmailPage })),
              },
            ],
          },
        ],
      },

      {
        // Public, signed in or out, in the sign-in page's split layout (Phase 2 §5.4).
        element: <AuthLayout />,
        children: [
          {
            path: 'invitations/accept',
            lazy: () =>
              import('@/features/invitations/accept-invitation-page').then((m) => ({
                Component: m.AcceptInvitationPage,
              })),
          },
        ],
      },

      { path: 'goodbye', element: <GoodbyePage /> },

      {
        element: <RequireAuth />,
        children: [
          {
            path: 'workspaces',
            lazy: () => import('@/features/shell/plain-layout').then((m) => ({ Component: m.PlainLayout })),
            children: [
              {
                index: true,
                lazy: () =>
                  import('@/features/workspaces/workspaces-page').then((m) => ({ Component: m.WorkspacesPage })),
              },
              {
                path: 'new',
                lazy: () =>
                  import('@/features/workspaces/create-workspace-page').then((m) => ({
                    Component: m.CreateWorkspacePage,
                  })),
              },
            ],
          },
          {
            path: 'account',
            lazy: () => import('@/features/account/account-layout').then((m) => ({ Component: m.AccountLayout })),
            children: [
              { index: true, element: <Navigate to="/account/profile" replace /> },
              {
                path: 'profile',
                lazy: () => import('@/features/account/profile-page').then((m) => ({ Component: m.ProfilePage })),
              },
              {
                path: 'security',
                lazy: () => import('@/features/account/security-page').then((m) => ({ Component: m.SecurityPage })),
              },
              {
                path: 'privacy',
                lazy: () => import('@/features/account/privacy-page').then((m) => ({ Component: m.PrivacyPage })),
              },
            ],
          },
          {
            path: 'w/:workspaceSlug',
            lazy: () =>
              import('@/features/workspaces/workspace-gate').then((m) => ({ Component: m.WorkspaceGate })),
            children: [
              {
                index: true,
                lazy: () => import('@/features/shell/home-page').then((m) => ({ Component: m.HomePage })),
              },
              ...(['agents', 'workflows', 'documents', 'audit'] as const).map((section) => ({
                path: section,
                lazy: () =>
                  import('@/features/shell/section-page').then((m) => ({
                    Component: () => <m.SectionPage section={section} />,
                  })),
              })),

              // ── Team (Phase 2 §5.1–§5.6) ──
              {
                path: 'team',
                lazy: () => import('@/features/team/team-layout').then((m) => ({ Component: m.TeamLayout })),
                children: [
                  {
                    // The members list stays mounted under the member drawer.
                    lazy: () => import('@/features/team/members-page').then((m) => ({ Component: m.MembersPage })),
                    children: [
                      { index: true },
                      {
                        path: 'members/:memberId',
                        lazy: () => import('@/features/team/member-drawer').then((m) => ({ Component: m.MemberDrawer })),
                      },
                    ],
                  },
                  {
                    path: 'invitations',
                    lazy: () =>
                      import('@/features/team/invitations-page').then((m) => ({ Component: m.InvitationsPage })),
                  },
                  {
                    path: 'roles',
                    lazy: () => import('@/features/team/roles-page').then((m) => ({ Component: m.RolesPage })),
                  },
                ],
              },
              ...['team/roles/new', 'team/roles/:roleId'].map((path) => ({
                path,
                lazy: () =>
                  import('@/features/team/role-editor-page').then((m) => ({ Component: m.RoleEditorPage })),
              })),

              // ── Settings (Phase 2 §5.7–§5.9) ──
              {
                path: 'settings',
                lazy: () =>
                  import('@/features/settings/settings-layout').then((m) => ({ Component: m.SettingsLayout })),
                children: [
                  {
                    index: true,
                    lazy: () =>
                      import('@/features/settings/general-page').then((m) => ({ Component: m.GeneralSettingsPage })),
                  },
                  {
                    path: 'security',
                    lazy: () =>
                      import('@/features/settings/security-settings-page').then((m) => ({
                        Component: m.SecuritySettingsPage,
                      })),
                  },
                  {
                    path: 'api-keys',
                    lazy: () => import('@/features/settings/api-keys-page').then((m) => ({ Component: m.ApiKeysPage })),
                  },
                ],
              },
              {
                path: '*',
                lazy: () =>
                  import('@/features/shell/section-page').then((m) => ({ Component: m.WorkspacePageNotFound })),
              },
            ],
          },
        ],
      },

      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
