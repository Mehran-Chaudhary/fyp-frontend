# Phase 1 — Frontend implementation notes

**For:** the backend engineer and project owner reviewing Phase 1 acceptance
**Handoff implemented:** [Phase 1 revision 2](PHASE_1_FOUNDATION_AUTH_WORKSPACE.md) (5 October 2026, backend baseline `877de76`; source re-checked at `979dfd5`)
**Status:** ready for review against a real backend. Unit tests and a mock-API browser run pass; real cookie, email and database evidence has **not** been captured yet.

## 1. What changed in this pass

The frontend already had Phase 1–3 screens from the earlier handoffs. This pass brought Phase 1 up to revision 2 and fixed places where the old code relied on backend gaps that no longer exist:

| Area | Before | Now |
|---|---|---|
| Permissions | Rebuilt from roles + catalogue; "unknown" allowed everything | Contextual `/auth/me` permissions only; omitted = `[]`; `can()` fails closed (P1-T32) |
| Workspace entry | Needed the workspace in the 100 embedded memberships; `members/me` was a hard gate | Slug or UUID resolved through contextual `/auth/me`; own membership optional (platform-admin break-glass gets a 500 there); detail only with `workspace:read` |
| Switcher | Embedded memberships (max 100) | `GET /organizations`, paged on demand |
| Cross-tab | Web Locks for refresh only; no fallback | One auth lock for refresh, login, register, MFA verify, logout and logout-all; localStorage-lease fallback |
| Late answers | A refresh finishing after sign-out could resurrect the session | Session epoch plus sign-out time: late refreshes and stale broadcasts are discarded; replays never cross sessions |
| Ambiguous refresh | Timeout retried automatically | Never retried automatically (no reuse grace window); user chooses "Try again" or "Sign in again" |
| Password change | Waited 1.1 s before refreshing | Refreshes immediately (the backend compares in milliseconds) |
| Logout failure | Silent | "Signed out on this device, but not confirmed", no auto-restore, "Finish signing out" |
| Email links | Token stayed in the URL and travelled in `next=` | Loaders move it into this tab's sessionStorage (short expiry) and replace the history entry |
| Validation | Mapped first-word keys (`Password`, `That`, `property`) | Property-path keys; unknown properties go to the form summary |
| Responses | Non-JSON 200 became `data: null` | `UNEXPECTED_RESPONSE` client error; client errors never carry a request ID |
| Rate limits | `Retry-After` only | Also `X-RateLimit-*` (reset read as Unix seconds) |
| Email gate | Any `ACCOUNT_EMAIL_NOT_VERIFIED` triggered the global gate | Global gate only without `details.requiredBy: 'workspace'`; workspace policy shows a workspace recovery state |
| Profile | No avatar | `avatarUrl` (http/https only, no referrer, initials fallback) |
| Devices | Couldn't sign out this device; no refresh | Current-device sign-out exits immediately; manual refresh |
| MFA disable | Status refetch only | Explicit refresh (drops MFA assurance), then re-checks every workspace |
| Create workspace | A timeout could invite a duplicate | "We couldn't confirm" state; "Check my workspaces" finds it before a retry |
| Health | Liveness only, for the offline banner | `/status` page runs all three probes on demand, showing component names and states only |

## 2. Decisions the spec asked for

**Refresh coordination and browser support (P1-T24, INT-03).** Supported: browsers with Web Locks and BroadcastChannel in a secure context (HTTPS or `localhost`): Chrome/Edge 69+, Firefox 96+, Safari 15.4+. Elsewhere, for example plain HTTP on a LAN IP or an old browser, a localStorage lease takes over. A tab claims it, waits 60 ms, and confirms. The lease (45 s) outlives the slowest guarded request and is renewed every 5 s, so it can't lapse while its holder is alive; a crashed holder blocks others for at most one lease. If storage is blocked too, the app is safe in one tab only, and `/status` says so ("This browser" card).

**Route names.** The three mail callback routes are exact. The other routes keep the names already in use; the spec's names redirect: `/auth/login` → `/auth/sign-in`, `/auth/register` → `/auth/sign-up`, `/auth/mfa` → `/auth/sign-in` (the challenge lives in memory only), `/account/security/mfa` and `/account/security/sessions` → anchors on `/account/security`. Workspace URLs show the immutable slug; `/w/<uuid>` works and is rewritten to the slug. Every API call uses the canonical UUID for both path and header.

**`AUTH_TOKEN_REVOKED`.** The guard returns it for a revoked session and for an access token cut off by a password change, so the client allows one coordinated refresh and lets that decide: a revoked family fails the refresh and ends the session. `AUTH_TOKEN_INVALID` ends the session at once.

**Deferred items that already existed.** Personal-data export and account erasure (Phase 5 in the new plan) were built earlier and still work under Account → Privacy. Phase 2/3 screens remain and use the Phase 1 foundation.

## 3. Acceptance checks (P1-T01–P1-T48)

Evidence levels: **U** unit test (`npm test`), **M** headless-Chrome run against a mock API (scripted; not committed), **I** implemented and reviewed but not yet run end-to-end, **R** needs the real backend, inbox or a second device. Nothing is ticked as accepted: acceptance needs **R** evidence and the owner's demo.

| ID | Status | Evidence / note |
|---|---|---|
| T01 | M, R | Nested-route reload keeps the session; no console errors besides expected HTTP statuses. Real origin pending |
| T02 | I, R | Client never reads `refreshToken`; cookie host/path to verify in DevTools |
| T03 | U | Envelope, pagination, field errors, network, non-JSON (`errors.test`, `token-manager.test`) |
| T04 | U, R | Unknown property → form summary. The UI never sends `limit` > 20 |
| T05 | U | Request IDs come only from server answers; copy button on every error |
| T06 | U, I | `Retry-After`, then `X-RateLimit-Reset` (seconds). An aborted request is never shown as an error |
| T07 | I, R | Only the four API fields are sent; duplicate, weak and breached handled; uncertain outcome points to sign-in |
| T08 | U, I | No workspace → `/workspaces/new`; a pending invitation comes first |
| T09 | U, M | No strength check on login; wrong credentials never refresh |
| T10 | I | Lockout countdown from `lockedUntil`; suspended / locked mid-session (`ACCOUNT_SUSPENDED`) ends the session with a reason |
| T11 | U, I, R | One POST per token (module single-flight); missing/expired/used states; success survives a reload |
| T12 | I | Copy never asserts that the account exists or the email arrived |
| T13 | R | Reset link end-to-end |
| T14 | I, R | Gate keeps the session, shows verification, no refresh loop; test with `REQUIRE_EMAIL_VERIFICATION=true` |
| T15 | I | MFA challenge never installs tokens or renders protected routes |
| T16 | I, R | TOTP and recovery modes; wrong code keeps the challenge; expired restarts |
| T17 | I | TOTP kept as a string; exactly one factor sent |
| T18 | I, R | QR rendered locally (`qrcode.react`); replacement token installed at once |
| T19 | I | Codes shown once, copy/download deliberate, acknowledgement required, cleared on close |
| T20 | I, R | Regenerate uses TOTP only; doesn't assume a code count |
| T21 | I, R | Disable → explicit refresh → workspace policies re-checked |
| T22 | M | Reload restores without a sign-in flash; a browser that never signed in skips the refresh probe |
| T23 | U | Concurrent expired calls share one refresh and replay once |
| T24 | U, R | Two-"tab" lease test (`auth-lock.test`); real two-tab run pending |
| T25 | U | Late refresh after sign-out discarded; replay across sessions refused |
| T26 | U | Definitive failure ends the session; 429, outage and timeout keep it |
| T27 | U, R | Renewal right after change-password; other devices signed out (server) |
| T28 | M, R | Devices list, current badge, placeholders, current/other sign-out, sign out everywhere |
| T29 | I | Unconfirmed sign-out banner; no auto-restore; "Finish signing out" |
| T30 | I, R | Omitted / taken (suffix) / reserved slug, quota, uncertain outcome; returned id/slug drive navigation |
| T31 | I | Picker and switcher page through `/organizations` |
| T32 | U | Omitted permissions → `[]`; `can()` fails closed |
| T33 | I | Entry doesn't need `workspace:read`; account settings never need a workspace |
| T34 | U, I | Keys under `['ws', uuid]`; the previous workspace's requests are cancelled; path and header from one value |
| T35 | M, R | Suspended membership/workspace, IP, MFA (shown in the mock run), workspace email policy |
| T36 | M | Not-found deep link offers picker, account settings and sign-out |
| T37 | U, M, R | Token kept out of URLs across sign-up/sign-in/MFA/verification (`link-tokens.test`) |
| T38 | I, R | Wrong address: sign out and switch while keeping the invitation; no refresh |
| T39 | I, R | Conflicts re-read memberships and offer entry only when it is real |
| T40 | I | Break-glass: membership is optional and its 500 is tolerated. Live check pending (needs a platform admin) |
| T41 | M | Identity refetched after save; unsafe avatar URL rejected; no upload or email editor |
| T42 | I | Loading/empty/error/pending states; no fake statistics |
| T43 | I | Radix dialogs/menus; field errors are live regions and focus the first invalid field. No separate screen-reader audit yet |
| T44 | M | 360 px: no horizontal overflow on the dashboard and security pages |
| T45 | I | No tokens, passwords or codes in storage, logs or query keys (invitation token hashed in its key); only link tokens in sessionStorage |
| T46 | R | `/status` exposes readiness; INT-01 evidence still to be captured on the integration machine |
| T47 | U | `npm run build`, `npm run lint`, `npm test` (26 files, 220 tests) pass |
| T48 | — | Owner acceptance |

## 4. Known limitations

- **Real-backend evidence is outstanding.** The backend `.env` in this workspace points at a shared remote Supabase database, S3 and Qdrant. Starting it would write sessions and audit rows there, so this pass used a mock API. Capture the **R** rows on a disposable environment.
- **Browser auto-retry after a network failure.** A refresh whose request never got an answer (connection refused) is retried after the API comes back. A connection reset after the server rotated the cookie would look the same; that window is very small. A timeout, the common ambiguous case, is never retried.
- **MFA disable on other clients.** Other clients' existing access tokens keep MFA assurance until they expire (INT-02); only this client is renewed.
- **Revoking another device** stops it renewing; its current access token works until it expires (≤ 15 min), because the guard checks the token, not the session row.
- **No step-up MFA.** A session that signed in without a code must sign in again to enter an MFA-required workspace (the UI says so).

## 5. Running it

`npm install`, copy `.env.example` to `.env` (API at `http://localhost:3000/api/v1`), `npm run dev`, open `http://localhost:5173`. Use `localhost` everywhere (cookies). The backend needs `CORS_ORIGINS` to include `http://localhost:5173`, `CORS_CREDENTIALS=true` and the refresh cookie enabled. `/status` shows whether the API is reachable and ready.
