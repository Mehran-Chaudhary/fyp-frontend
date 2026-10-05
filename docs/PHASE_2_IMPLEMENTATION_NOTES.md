# Phase 2 — Frontend implementation notes

**For:** the backend engineer and project owner reviewing Phase 2 acceptance
**Handoff implemented:** [Phase 2 revision 3](PHASE_2_WORKSPACE_ADMINISTRATION.md) (5 October 2026, backend baseline `5b4efb7`; contracts re-checked against backend source at `979dfd5`)
**Status:** ready for review against a real backend. Typecheck, lint, unit tests and a mock-API browser run pass. No real-backend, inbox or second-session evidence has been captured yet.

## 1. What changed in this pass

The frontend already had Team and Settings screens from the earlier Phase 2 handoff. This pass brought them up to revision 3. It added the screens the new spec asks for and removed behaviour the backend doesn't support.

| Area | Before | Now |
|---|---|---|
| Settings layout | General (profile, retention, chunking, leave, danger zone), Security (policy + IP allowlist), API keys | Spec §4 routes: General, Defaults, Security, Networks, API keys, Danger zone. Each tab has its own read permission, so `/settings` opens the first tab you can see |
| Own membership | Leaving needed `workspace:read`; the profile was only reachable through the directory | `/w/:slug/my-workspace-profile`: edit your local name and title, and leave. Needs no admin permission. Linked from the avatar menu |
| Unknown outcomes | Only network errors and timeouts counted; mutations showed a generic error | Network errors, timeouts **and 5xx** count as "outcome unknown". Invite, transfer, delete, leave, remove member, role create/update, key create/revoke, IP rule and policy changes show a "check first" step instead of a retry. Nothing is replayed automatically |
| Role grants | Saving changed permissions silently turned `document:*` into a fixed list | Stored grants are shown as stored (wildcards, catalogue-unknown keys, and inert patterns such as `pii:policy:*` are flagged) with their current expansion. Replacing wildcards needs an explicit checkbox. Saves show a +/− diff. Metadata-only saves never send `permissionKeys` |
| Member roles | Unknown or deleted held roles were invisible; no diff | Every held role stays visible, including ones no longer in the list (save blocked until unticked). There's an Adds/Removes review and the new rank. The rank filter is labelled as this app's rule (P2-G03) |
| Concurrent edits | Not detected | The role editor, member role editor and workspace profile notice a newer server copy while you are dirty, and offer "load the latest" instead of silently overwriting it |
| Local display name | The form guessed whether the shown name was an override | Sends only changed fields. "Use the account name" clears the override explicitly (P2-T29) |
| Retention / chunking | "Keep forever: the platform default"; numbers guessed | "Deployment default" vs "Workspace value"; `null` removes an override. Retention says "subject to the platform minimum" |
| Policies | Turning a policy off had no review; no way to reset to default | Every MFA / verified-email change, including reset-to-default (`null`), shows a Now/After review and its impact. Domain changes show added/removed. The switcher and contextual access are re-read afterwards |
| Networks | Inactive rules hidden; lockout check counted them; recorded IP presented as fact | Inactive rules shown and excluded from checks. The address is labelled as recorded for the session; an IP the server reports in a refusal takes over. `RESOURCE_CONFLICT` for the last rule offers the deliberate choices. The page states the switch isn't proof of protection (P2-G08) |
| Invitations | "Sent" / "valid for 7 days"; lost answers could be resent | "Created; email delivery attempted". The expiry comes from the response. After a lost answer, pending invitations are checked first. Accepted rows link to the member; each resend refusal is explained |
| Role deletion | No mention of invitations | The dialog looks up pending invitations that offer the role and warns before they break (P2-G06) |
| Transfer | First 50 members; "you become an Administrator" | Every page of active members, owner excluded by `userId`. Both role replacements spelled out. After a lost answer the owner is read back |
| Delete workspace | Typed the slug; promised erasure "after 7 days" | Types the workspace name. Wording is "marked deleted, no restore in the app". A lost answer is reconciled through `GET /organizations` |
| API keys | Hide/show revoked only; creator from the first 100 members; "Never" for null expiry | Client-side status, search and creator filters over the complete list, labelled as local. Creator names come from all members (removed included), falling back to the ID. "No expiry". `usageCount` grouped as text |
| Key creation | One step; copy failures silent | Details → review → one request. Copy failures are explained in place. Orphan detection after a lost answer offers revoke-and-replace. The curl example matches the key's scopes |
| Suspension | "They lose access"; key behaviour unstated | Says plainly that API keys keep working (P2-G02), with links to that person's keys |
| Requests | Phase 2 list reads couldn't be cancelled | Every list/detail read passes the query's `AbortSignal`, so an outdated member search is cancelled |
| Layout | Tables could widen the page; 6 tabs overflowed at 360 px | Page grids use `minmax(0,1fr)`, and the table scroll area is positioned so `sr-only` headers can't escape it. No horizontal overflow at 360 px or 1440 px on any Phase 2 screen |

## 2. Operation coverage (all 30)

| ID | Where in the UI |
|---|---|
| P2-API-01 | Settings → General / Defaults / Security (`useUpdateWorkspace`, merge patch of changed keys only) |
| P2-API-02 | Settings → Danger zone → Delete |
| P2-API-03 | Settings → Danger zone → Transfer |
| P2-API-04–07 | Settings → Networks |
| P2-API-08 | Team → Members; transfer picker; role member counts; creator names |
| P2-API-09 | Member drawer (`/team/members/:membershipId`) |
| P2-API-10 | Member drawer → Change roles |
| P2-API-11 | Member drawer → Edit; Your workspace profile |
| P2-API-12/13/14 | Member drawer and row menu |
| P2-API-15 | Your workspace profile → Leave |
| P2-API-16–19 | Team → Invitations; Invite dialog (`?invite=1`) |
| P2-API-20 | Role editor, permission grid, key scope descriptions, `useAccess` |
| P2-API-21–25 | Team → Roles; role editor (`/team/roles/new`, `/team/roles/:roleId`) |
| P2-API-26 | Team → Roles → ⋯ → Recompute permissions |
| P2-API-27–30 | Settings → API keys |

The endpoint functions carry their register ID in `src/lib/api/endpoints.ts`.

## 3. Decisions the spec left open

- **Routes.** The spec's suggested paths are used: `/settings/{general,defaults,security,networks,api-keys,danger}` and `/my-workspace-profile`. Member detail stays a drawer at `/team/members/:memberId` so the list keeps its filters underneath; it uses the membership ID, as required.
- **Ambiguous mutations.** "Outcome unknown" is any network error, client timeout or 5xx answer. The UI never resends. It offers a check (list, detail or workspace list), and the submit button stays disabled until that check runs.
- **Rank rule for role assignment (P2-G03).** The UI offers only roles ranked below you whose permissions you hold, and says this is the app's rule. The server is unchanged; direct API calls can still assign higher roles.
- **Wildcard conversion.** Changing permissions on a role with wildcards requires ticking "Replace the wildcard grants … with these N explicit permissions". Duplicating a role always converts to explicit keys, and the header says so.
- **Your address on Networks.** There is no current-IP endpoint, so the page uses the IP the server recorded for this session (`GET /auth/sessions`), labelled as such. An IP returned in `IP_ALLOWLIST_SELF_LOCKOUT.details.ip` replaces it.
- **API-key creator names** need `member:read` and read up to 10 pages of active plus removed members. Without it, or for an unknown creator, the short user ID is shown.

## 4. Acceptance checks (P2-T01–P2-T68)

Evidence levels: **U** unit test (`npm test`). **M** headless-Chrome run against a mock API (scripted, not committed; owner role only). **I** implemented and reviewed but not run end to end. **R** needs the real backend, an inbox or a second account. Nothing is ticked as accepted: acceptance needs **R** evidence and the owner's demo.

| ID | Status | Evidence / note |
|---|---|---|
| T01 | R | Phase 1 real-backend evidence still outstanding |
| T02 | U, R | `workspacePath()` builds path and header from one ID; two-tenant run pending |
| T03 | I | Workspace tree remounts per UUID; mutations capture the ID at dispatch; `forgetWorkspace` cancels before evicting |
| T04 | M, I | Loading, empty, filtered-empty, error and retry on members, invitations, roles, rules, keys |
| T05 | I, R | Mock ran as owner only; admin/member/viewer/custom-role runs pending |
| T06 | I | Missing `role:read` → "This editor also needs role:read"; missing `workspace:read` → explained per page; enforcement state explained |
| T07 | M | No horizontal overflow at 360 px on the new pages; Radix dialogs restore focus. No screen-reader audit yet |
| T08 | U, I | Field-path errors, request references, non-UUID IDs never sent (`isUuid`) |
| T09–T13 | M, I, R | Forms send changed keys only; `null` resets; overlap checked when both values are known |
| T14 | I, R | Delete with name confirmation, tenant eviction, session kept, lost-answer check |
| T15–T16 | M, I, R | Transfer review shown in the mock run; owner-only actions hidden after access is re-read |
| T17 | M | Empty and populated lists, inactive rule, "None recorded" |
| T18–T21 | U, I, R | Validator mirrors backend `ip.util.ts` (`ip.test`); proxy IP and operator recovery need a disposable environment |
| T22–T24 | M, I | Debounced, cancellable search; filters in the URL; membership vs user ID kept apart |
| T25–T27 | M, I, R | Role diff shown in the mock run; P2-G03 labelled as UI policy |
| T28–T29 | I | Own profile without permissions; explicit "Use the account name" |
| T30–T33 | I, R | Honest key notice on suspend; removal shows the revoked-key count; partial outcome re-reads both lists |
| T34 | I, R | Leave from Your workspace profile; owner pointed to transfer |
| T35 | U, M | Elapsed PENDING shown as Expired; no server search/sort offered |
| T36–T38 | M, I, R | Default role without `role:read`; every refusal mapped |
| T39–T42 | R | Mailbox, acceptance and old-link checks need SMTP and a second account |
| T43 | M | Mock answered 504 after storing the invitation; "Check pending invitations" found it, with no second send |
| T44 | — | Owner decision (P2-G04, P2-G06) |
| T45–T46 | U, M | Canonical `key` everywhere; wildcards and inert patterns shown (`grants.test`) |
| T47–T48 | I, R | Collision, rank and grant refusals mapped to fields |
| T49 | U, M | Metadata saves omit `permissionKeys`; wildcard replacement needs the checkbox |
| T50–T53 | I, R | Own access re-read after role changes; pending-invitation warning; recompute never automatic |
| T54–T55 | U, M | Scopes ∩ your permissions; status order revoked → expired → active; `usageCount` as text (`api-keys.test`) |
| T56–T57 | M, I | Review step and one-time panel shown in the mock run; copy failure explained |
| T58 | I | Secret held only in the API-keys page's component state: not in query/mutation caches, storage, URLs, toasts or logs |
| T59 | I | Lost answer → matching key found by name and time, revoke offered, no retry |
| T60 | I, R | Reason sent in the DELETE body; repeat is harmless |
| T61–T62 | R | Need a downstream fixture and an owner decision on P2-G02 |
| T63 | I | Concurrent-change notices in the role editor, member roles editor and workspace profile |
| T64 | U, I | `isOutcomeUnknown` covers network, timeout and 5xx (`errors.test`); no mutation retries |
| T65 | R | Backend's own live run covers the API; frontend against a running API still pending |
| T66–T68 | — | Owner decisions, commit record, owner review |

## 5. Backend constraints (spec §12): what the frontend does

The frontend mitigates these but doesn't fix them; each still needs a backend decision.

| ID | Frontend behaviour |
|---|---|
| P2-G02 | Suspend dialog, member drawer, key list and secret panel say keys keep working; each links to the person's keys |
| P2-G03 | Conservative role selector, labelled as UI policy |
| P2-G04/05 | Not enforceable client-side; the seat-limit message says pending invitations don't hold seats |
| P2-G06 | Delete-role dialog lists pending invitations offering the role |
| P2-G07 | No delivery claims anywhere; "Sent" counts attempts |
| P2-G08 | Networks page explains the switch isn't proof of protection, and that recovery goes through an operator |
| P2-G09 | Failed or unknown member removal re-reads members and keys |
| P2-G10 | Canonical `key` only; inert wildcards flagged; no free-form wildcard entry |
| P2-G11 | No invented endpoints: rules are add-then-remove, keys are create-then-revoke, no restore |
| P2-G12 | Inherited values are shown as "Deployment default", never as a guessed number |

## 6. Running and checking it

- `npm run typecheck`, `npm run lint`, `npm test` (28 files, 230 tests) and `npm run build` pass.
- A busy Windows machine can time out Vitest workers at startup. `npx vitest run --maxWorkers=2` avoids that; it is not a test failure.
- **Mock run on Windows.** In Git Bash, `VITE_API_BASE_URL=/api/v1` is rewritten into `C:/Program Files/Git/api/v1`. Prefix the command with `MSYS_NO_PATHCONV=1` (or use PowerShell) when pointing Vite at a proxy: `MSYS_NO_PATHCONV=1 VITE_API_BASE_URL=/api/v1 BACKEND_URL=http://localhost:<port> npx vite --port 5180`.
- The real-backend run should use disposable fixtures: owner/admin/member/viewer/custom role in two workspaces, a test mailbox, and an operator who can turn IP enforcement off.
