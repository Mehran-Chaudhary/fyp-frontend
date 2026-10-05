import { createBrowserRouter, Navigate } from 'react-router';
import { Splash } from '@/components/feedback/global-states';
import { AuthLayout } from '@/features/auth/auth-layout';
import { GoodbyePage } from '@/features/misc/goodbye-page';
import { NotFoundPage } from '@/features/misc/not-found-page';
import { RootErrorBoundary } from '@/features/misc/root-error';
import { RootLayout } from '@/features/misc/root-layout';
import { linkTokenLoader } from '@/lib/auth/link-tokens';
import { Alias } from './alias';
import { PublicOnly, RequireAuth, RootRedirect } from './guards';

/**
 * Route table (Phase 1 spec §6). /auth/verify-email, /auth/reset-password and
 * /invitations/accept are fixed: the backend emails links to them. Their loaders
 * move the link token out of the address bar before anything renders, and they
 * work on direct navigation and reload. The spec's other route names
 * (/auth/login, /auth/register, …) are aliases of the routes here.
 */
export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RootErrorBoundary />,
    hydrateFallbackElement: <Splash />,
    children: [
      { index: true, element: <RootRedirect /> },

      {
        // Public diagnostics: the three health probes, on demand (P1-API-27–29).
        path: 'status',
        lazy: () => import('@/features/misc/status-page').then((m) => ({ Component: m.StatusPage })),
      },

      {
        path: 'auth',
        children: [
          { index: true, element: <Navigate to="/auth/sign-in" replace /> },
          { path: 'login', element: <Alias to="/auth/sign-in" /> },
          { path: 'register', element: <Alias to="/auth/sign-up" /> },
          // The MFA challenge lives in memory only; a reload restarts sign-in.
          { path: 'mfa', element: <Alias to="/auth/sign-in" /> },
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
                loader: linkTokenLoader('reset-password'),
                lazy: () =>
                  import('@/features/auth/reset-password-page').then((m) => ({ Component: m.ResetPasswordPage })),
              },
              {
                path: 'verify-email',
                loader: linkTokenLoader('verify-email'),
                lazy: () =>
                  import('@/features/auth/verify-email-page').then((m) => ({ Component: m.VerifyEmailPage })),
              },
              {
                path: 'check-email',
                lazy: () => import('@/features/auth/check-email-page').then((m) => ({ Component: m.CheckEmailPage })),
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
            loader: linkTokenLoader('invitation'),
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
              { path: 'security/mfa', element: <Alias to="/account/security" hash="#two-step" /> },
              { path: 'security/sessions', element: <Alias to="/account/security" hash="#devices" /> },
              {
                path: 'privacy',
                lazy: () => import('@/features/account/privacy-page').then((m) => ({ Component: m.PrivacyPage })),
              },
            ],
          },
          {
            // :workspaceSlug is a slug or the canonical UUID; the gate resolves both.
            path: 'w/:workspaceSlug',
            lazy: () =>
              import('@/features/workspaces/workspace-gate').then((m) => ({ Component: m.WorkspaceGate })),
            children: [
              {
                index: true,
                lazy: () => import('@/features/shell/home-page').then((m) => ({ Component: m.HomePage })),
              },
              ...(['agents', 'workflows', 'audit'] as const).map((section) => ({
                path: section,
                lazy: () =>
                  import('@/features/shell/section-page').then((m) => ({
                    Component: () => <m.SectionPage section={section} />,
                  })),
              })),

              // ── Knowledge (Phase 3 §5) ──
              {
                // The vault stays mounted under the document drawer, which has its own URL.
                path: 'documents',
                handle: { wide: true },
                lazy: () => import('@/features/knowledge/vault/vault-page').then((m) => ({ Component: m.VaultPage })),
                children: [
                  // No document open: the drawer's outlet renders nothing.
                  { index: true, Component: () => null },
                  {
                    path: ':documentId',
                    lazy: () =>
                      import('@/features/knowledge/document/document-drawer').then((m) => ({ Component: m.DocumentDrawer })),
                    children: [
                      {
                        index: true,
                        lazy: () =>
                          import('@/features/knowledge/document/overview-tab').then((m) => ({
                            Component: m.DocumentOverviewTab,
                          })),
                      },
                      {
                        path: 'chunks',
                        lazy: () =>
                          import('@/features/knowledge/document/chunks-tab').then((m) => ({ Component: m.DocumentChunksTab })),
                      },
                      {
                        path: 'pii',
                        lazy: () => import('@/features/knowledge/document/pii-tab').then((m) => ({ Component: m.DocumentPiiTab })),
                      },
                    ],
                  },
                ],
              },
              {
                path: 'knowledge-bases',
                lazy: () =>
                  import('@/features/knowledge/knowledge-bases/knowledge-bases-page').then((m) => ({
                    Component: m.KnowledgeBasesPage,
                  })),
              },
              {
                path: 'knowledge-bases/new',
                lazy: () =>
                  import('@/features/knowledge/knowledge-bases/new-knowledge-base-page').then((m) => ({
                    Component: m.NewKnowledgeBasePage,
                  })),
              },
              {
                path: 'knowledge-bases/:knowledgeBaseId',
                lazy: () =>
                  import('@/features/knowledge/knowledge-bases/knowledge-base-layout').then((m) => ({
                    Component: m.KnowledgeBaseLayout,
                  })),
                children: [
                  {
                    index: true,
                    lazy: () =>
                      import('@/features/knowledge/knowledge-bases/settings-tab').then((m) => ({
                        Component: m.KnowledgeBaseSettingsTab,
                      })),
                  },
                  {
                    path: 'access',
                    lazy: () =>
                      import('@/features/knowledge/knowledge-bases/access-tab').then((m) => ({
                        Component: m.KnowledgeBaseAccessTab,
                      })),
                  },
                ],
              },
              {
                path: 'search',
                handle: { wide: true },
                lazy: () => import('@/features/knowledge/search/search-page').then((m) => ({ Component: m.SearchPage })),
              },

              // ── Team (Phase 2 §4) ──
              {
                path: 'team',
                lazy: () => import('@/features/team/team-layout').then((m) => ({ Component: m.TeamLayout })),
                children: [
                  {
                    // The members list stays mounted under the member drawer.
                    lazy: () => import('@/features/team/members-page').then((m) => ({ Component: m.MembersPage })),
                    children: [
                      // No member open: the drawer's outlet renders nothing.
                      { index: true, Component: () => null },
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

              // ── Your own membership (Phase 2 §4): no admin permission needed ──
              {
                path: 'my-workspace-profile',
                lazy: () =>
                  import('@/features/team/my-workspace-profile-page').then((m) => ({
                    Component: m.MyWorkspaceProfilePage,
                  })),
              },

              // ── Settings (Phase 2 §4) ──
              {
                path: 'settings',
                lazy: () =>
                  import('@/features/settings/settings-layout').then((m) => ({ Component: m.SettingsLayout })),
                children: [
                  {
                    index: true,
                    lazy: () => import('@/features/settings/settings-layout').then((m) => ({ Component: m.SettingsIndex })),
                  },
                  {
                    path: 'general',
                    lazy: () =>
                      import('@/features/settings/general-page').then((m) => ({ Component: m.GeneralSettingsPage })),
                  },
                  {
                    path: 'defaults',
                    lazy: () =>
                      import('@/features/settings/defaults-page').then((m) => ({ Component: m.DefaultsSettingsPage })),
                  },
                  {
                    path: 'security',
                    lazy: () =>
                      import('@/features/settings/security-settings-page').then((m) => ({
                        Component: m.SecuritySettingsPage,
                      })),
                  },
                  {
                    path: 'networks',
                    lazy: () =>
                      import('@/features/settings/networks-page').then((m) => ({ Component: m.NetworksSettingsPage })),
                  },
                  {
                    path: 'api-keys',
                    lazy: () => import('@/features/settings/api-keys-page').then((m) => ({ Component: m.ApiKeysPage })),
                  },
                  {
                    path: 'danger',
                    lazy: () => import('@/features/settings/danger-page').then((m) => ({ Component: m.DangerZonePage })),
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
