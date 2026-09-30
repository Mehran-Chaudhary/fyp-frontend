# AgentVault — Web

The frontend for **AgentVault**, the Distributed AI Agent Management Platform (FYP, Air
University Islamabad). This repository implements:

- **Phase 1: Foundation, Authentication & Workspace Shell**
  ([`docs/PHASE_1_FOUNDATION_AUTH_WORKSPACE.md`](docs/PHASE_1_FOUNDATION_AUTH_WORKSPACE.md))
- **Phase 2: Workspace Administration**: team, roles, invitations, API keys and
  security settings ([`docs/PHASE_2_WORKSPACE_ADMINISTRATION.md`](docs/PHASE_2_WORKSPACE_ADMINISTRATION.md))

## Stack

| Concern | Choice |
|---|---|
| Build | Vite 8, React 19, TypeScript (strict) |
| Routing | React Router 7 (data router, lazy routes) |
| Server state | TanStack Query 5 |
| Session state | Zustand (the access token itself lives only in the token manager) |
| UI | Tailwind CSS 4, Radix primitives, lucide-react icons |
| Forms | React Hook Form + Zod 4 |
| Toasts, QR, dates | sonner, qrcode.react, date-fns |
| Tests | Vitest + jsdom |

## Getting started

```bash
npm install
npm run dev          # http://localhost:5173 (the port is fixed: backend emails link to it)
```

The dev server proxies `/api` and `/health` to the backend **without rewriting the
path**, so the `daiap_rt` refresh cookie (scoped to `/api/v1/auth`) stays first-party.
Set `BACKEND_URL` if the backend is not on `http://localhost:3000`.

For development, raise the backend's auth throttle so page reloads don't exhaust it
(spec §13): `THROTTLE_AUTH_LIMIT=200`, and use `MAIL_TRANSPORT=log` to read emailed
links (verify email, reset password) from the backend console.

### Environment

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | `/api/v1` | API prefix. Keep it relative; production serves the API from the same site. |
| `VITE_APP_NAME` | `AgentVault` | Product name in the UI |
| `VITE_QUERY_DEVTOOLS` | unset | `true` shows TanStack Query devtools in development |
| `BACKEND_URL` | `http://localhost:3000` | Dev/preview proxy target (never sent to the browser) |

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with HMR |
| `npm run build` | Type-check and production build to `dist/` |
| `npm run typecheck` | `tsc -b` only |
| `npm run lint` | ESLint (includes the React Compiler rules) |
| `npm test` | Unit tests |
| `npm run preview` | Serve `dist/` with the same proxy |

## Project layout

```
src/
  app/            router, providers, route guards
  lib/
    api/          fetch client, typed errors, token manager, endpoint functions, global error handler
    auth/         session store (boot, sign-in, sign-out), landing and `next` rules
    permissions/  wildcard expansion (mirrors the server), permission loading, can()
    rbac/         the anti-escalation rules (rank, "grant only what you hold"), mirrored from the server
    workspace/    invitation/API-key status, IP/CIDR matching (copied from the backend), email
                  masking, allowed domains, and what to refetch after each admin change (cache.ts)
    validation/   password policy and slug rules mirrored from the backend, Zod schemas
    queries.ts    query keys and query options (every workspace key starts with ['ws', id])
  components/     UI kit (ui/), brand, loading/error/empty states (feedback/)
  features/
    auth/         sign in (+ MFA step), sign up, forgot/reset password, verify email
    workspaces/   workspace list, create, switcher, workspace gate and access states
    shell/        app shell, navigation, home, reserved sections for later phases
    account/      profile, security (password, MFA, devices), privacy (export, erase)
    team/         members (+ drawer), invitations, roles and the role editor
    settings/     general (profile, retention, chunking, leave, transfer, delete), security
                  (MFA / verified-email requirements, allowed domains, IP allowlist), API keys
    invitations/  the public invitation landing page the backend emails
    misc/         root layout, error boundary, 404, goodbye
```

## Things worth knowing before you change auth code

- **One refresh at a time, across all tabs.** Refresh tokens rotate and a reused one
  signs the user out everywhere. `lib/api/token-manager.ts` is the only code that calls
  `POST /auth/refresh`: single-flight within a tab, a Web Lock across tabs, and the new
  token is shared over a `BroadcastChannel`. Session restore runs once, outside React,
  so StrictMode cannot double it.
- **Refresh on demand only**, never on a timer, and only for the four token 401 codes.
  Wrong-input 401s (`AUTH_INVALID_CREDENTIALS`, `AUTH_PASSWORD_MISMATCH`, …) never
  refresh or sign out. A `429` or an outage on refresh keeps the session.
- **Workspace header = path.** Build workspace calls with `workspacePath(id, …)`, which
  produces both the URL and `X-Organization-Id` from one value.
- **Known backend issues** (spec §14) have workarounds in place: permissions are computed
  from roles until `/auth/me` returns them (BF-1), the refresh after a password change
  waits 1.1 s (BF-3), and validation keys `Password` / `That` / `property` are mapped
  to the right field (BF-4).

## Things worth knowing before you change admin code (Phase 2)

- **The UI predicts the server's two anti-escalation rules** (`lib/rbac/rules.ts`): you can
  only act on members ranked strictly below you, and you can only grant roles, permissions
  or API-key scopes you hold yourself. Screens only offer what can succeed; the server
  still decides, and every refusal code has a designed message (`lib/errors.ts`).
- **Some codes are local on some calls.** `MFA_REQUIRED` and `ACCOUNT_EMAIL_NOT_VERIFIED`
  from E30, and `MEMBERSHIP_SUSPENDED` from E46, refuse *that change*; they are not
  "you lost access". Those calls pass `localCodes` so the global handler leaves the
  workspace alone.
- **Send only what changed.** Workspace settings are a partial update; a role edit sends
  `permissionKeys` only when the selection changed (a role holding a permission you lack
  can still be renamed or recoloured).
- **Transfer ownership takes the member's `userId`**, not the membership `id`.
- **IP allowlist lockout** is checked on the client before enabling enforcement or
  deleting a rule (`lib/workspace/ip.ts` is the server's own parser), and the server's
  `IP_ALLOWLIST_SELF_LOCKOUT` is handled with an "Add my address" action.
- **API-key secrets** are held only in component state while the one-time dialog is open;
  they never enter the query cache, storage, URLs or logs.
- Filters on the Members and Invitations tabs live in the URL, so a filtered view survives
  reloads, the back button and opening a member's drawer.
