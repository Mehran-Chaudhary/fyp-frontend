# AgentVault — Web

The frontend for **AgentVault**, the Distributed AI Agent Management Platform (FYP, Air
University Islamabad). This repository implements:

- **Phase 1: Foundation, Authentication & Workspace Shell**
  ([`docs/PHASE_1_FOUNDATION_AUTH_WORKSPACE.md`](docs/PHASE_1_FOUNDATION_AUTH_WORKSPACE.md))
- **Phase 2: Workspace Administration**: team, roles, invitations, API keys and
  security settings ([`docs/PHASE_2_WORKSPACE_ADMINISTRATION.md`](docs/PHASE_2_WORKSPACE_ADMINISTRATION.md))
- **Phase 3: Knowledge Bases & Document Vault**: the vault, uploads, the pipeline, document
  detail, PII reports, knowledge bases and their access grants, and the retrieval playground
  ([`docs/PHASE_3_KNOWLEDGE_DOCUMENT_VAULT.md`](docs/PHASE_3_KNOWLEDGE_DOCUMENT_VAULT.md))

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
# Copy .env.example to .env before starting (PowerShell: Copy-Item .env.example .env).
npm run dev -- --port 5173 --strictPort
```

Open `http://localhost:5173`. The local `.env` sends API requests directly to
`http://localhost:3000/api/v1`. Use `localhost` consistently, including in the
browser; restart Vite after changing environment files. `.env.development` must
not override this URL. All `VITE_` values are public: never copy backend secrets.

The backend must allow origin `http://localhost:5173` with credentials and use its
local HTTP cookie settings (`COOKIE_SECURE=false`, `COOKIE_SAME_SITE=lax`, refresh
cookie enabled, no cookie domain). Backend email currently uses Ethereal; check
its test inbox for verification, reset, and invitation messages.

Check `http://localhost:3000/health/ready` and `http://localhost:3000/docs`, then
sign in and confirm API requests target port 3000. Confirm login sets the HttpOnly
refresh cookie, `/auth/me` succeeds, reloading restores the session through
`POST /auth/refresh`, and logout ends it. Then test workspace creation, document
upload, processing, and retrieval. Chat and workflow runs require their frontend
features to be implemented. There is currently no Socket.IO client; when added,
connect to `http://localhost:3000` with `path: '/realtime'` and
`transports: ['websocket']` (the path is not a namespace).

### Environment

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | `/api/v1` fallback | Local `.env`: `http://localhost:3000/api/v1`. For production, set the deployed API URL or `/api/v1` in `.env.production` or the build environment to override local `.env`. |
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
    knowledge/    the access model (clearance, levels, what each action needs), document status
                  and polling, file checks, the XHR upload and the upload queue, downloads, PII
                  placeholders, vault filters, bulk runs, knowledge-layer gaps, and what to
                  refetch after each knowledge change (cache.ts)
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
    knowledge/    vault/ (table, toolbar, Ask, panels, bulk actions, drop zone), upload/ (dialog,
                  activity, watcher), document/ (drawer: overview, chunks, PII report),
                  knowledge-bases/ (list, form, settings, access grants), search/ (playground),
                  shared/ (badges, file glyphs, masked text, access hooks)
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

## Things worth knowing before you change knowledge code (Phase 3)

- **Hidden means 404.** The server never confirms that something you can't see exists, so a
  hidden and a deleted document or knowledge base get the same words ("doesn't exist or you
  don't have access to it"). Two people can see different totals for the same workspace;
  never "fix" that on the client.
- **Three gates: permission, level, clearance.** `useKnowledgeAccess()` resolves the
  permission snapshot (wildcards included) into the concrete set `lib/knowledge/access.ts`
  expects; `useActionGate()` turns a missing permission into *hidden* and a low level on a
  knowledge base (or a server that can't do it yet) into *disabled, with the reason*.
  Classifications offered anywhere are only those within your clearance.
- **Uploads don't go through `request()`.** `fetch` can't report upload progress, so
  `lib/knowledge/upload.ts` uses XHR with the client's token handling. Files go through the
  app's upload queue (`lib/knowledge/app-upload-queue.ts`): at most three at a time, held
  when `x-ratelimit-remaining` reaches 0 (until `x-ratelimit-reset`), requeued after a 429's
  `Retry-After`, and the waiting files are stopped by errors every file would hit (quota,
  permission, the knowledge layer). Uploads carry on after the dialog closes; signing out
  aborts them, and leaving the page while they run asks first.
- **No push events: poll.** The vault's current page and an open document poll with
  `pollInterval` (2 s, 5 s, 15 s as statuses age; none when nothing is processing).
  `useSettleWatcher` refreshes stats, chunks and PII reports when a document finishes.
- **A missing knowledge layer is remembered for the session.** The first `503
  KNOWLEDGE_LAYER_NOT_CONFIGURED` is recorded (`lib/knowledge/layer.ts`, from the global error
  handler or the upload queue); uploads, reindexing, downloads or search are disabled
  according to the settings it names, and the banner offers "Check again".
- **Document text stays in memory.** Retrieval runs as a mutation with `gcTime: 0`; revealed
  PII is fetched outside the query cache and hidden after 60 s or when the tab is hidden; a
  question handed from the vault's Ask box to Search goes through module memory, never the URL.
- **No bulk endpoints.** Bulk reindex, reclassify and delete (and "reindex all" on a
  knowledge base) run the single calls one at a time, at most four per second
  (`lib/knowledge/bulk.ts`), skip what you can't act on, and report per-row failures.
- **For local work** the backend's `npm run start:standins` (Phase 3 spec §13) serves the
  real API with in-memory stand-ins for object storage, Qdrant and the AI service.
