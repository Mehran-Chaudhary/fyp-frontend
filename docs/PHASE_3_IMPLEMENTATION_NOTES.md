# Phase 3 — Frontend implementation notes

**For:** the backend engineer and project owner reviewing Phase 3 acceptance
**Handoff implemented:** [Phase 3 revision 1](PHASE_3_KNOWLEDGE_DOCUMENT_VAULT_PRIVACY.md) (6 October 2026, backend baseline `979dfd5` + P3-G01; contracts re-checked against the privacy controller and DTOs in the backend repository)
**Status:** ready for review against a real backend. Typecheck, lint, unit tests and a mock-API browser run pass. No real-backend, second-session or outage evidence has been captured yet.

## 1. What changed in this pass

The frontend already had knowledge screens from the superseded nine-phase plan. This pass brought them up to revision 1. It added the privacy settings screen and the two privacy operations that were missing, and changed behaviour wherever the new contract differs.

| Area | Before | Now |
|---|---|---|
| Operations | 21 of 23: no policy update (18), no text analysis (20) | All 23, each labelled with its register id in `src/lib/api/endpoints.ts` |
| Privacy settings | None: the policy was only read for a "redaction is off" banner | `/w/:slug/settings/privacy`: policy status and warnings, editor, entity catalogue, analysis preview (§5) |
| Shared adapter | JSON only; uploads used a separate XMLHttpRequest client | The Phase 1 adapter takes `FormData` (no Content-Type; the browser sets the boundary) and, for upload progress, an XHR transport that returns a real `Response`. Uploads now share token refresh, request ids, error envelopes and the global handler |
| Status labels | Mockup badges: Pending / Indexing / Indexed / Failed | Spec §4.1 labels: Queued / Processing (with "Reading text", "Saving chunks", "Indexing") / Ready / Failed / **Reindex failed · previous version still searchable**. A message on an in-progress document is a retry warning, not an error |
| Polling | Interval chosen by the age of `lastStatusAt`; never stopped | §9.3 exactly: 2 s for the first minute, 5 s to five minutes, 15 s to 30 minutes, then stop with "Still processing — refresh to check". Paused while hidden; refetched on focus. Waits for `Retry-After` on 429 and backs off 30 s on outages. "Taking longer than usual" after 10 minutes without a heartbeat |
| Status filter | One of five presets | Multi-select of Queued / Processing / Ready / Failed with an "In progress" shortcut, in the URL (`status=queued,processing`). Old links (`indexing`, `pending`, `indexed`) still work |
| Upload | Three at a time; a timeout offered "send again" | Two at a time (§5). Classification always sent; tags normalised. A timeout, dropped connection or 5xx leaves the file **"Outcome unknown"**: never resent. "Check the vault" searches by title and matches base, size, stored name and time. Found: counted as uploaded. Not found: "send again" is offered. 415 `details.reason` and `allowedTypes` are explained |
| Document detail | Version facts scattered | A status panel: label, `statusMessage`, failure hint and icon (open code set), `failureCode`, searchable version, current run, `lastStatusAt`, `processingCompletedAt`. Processing metrics show unknown keys too. Uploader names come from the full directory, removed members included |
| Reclassify / delete | A 5xx or timeout showed an error | Both read the document back ("Check its classification", "Check whether it's gone"); nothing is replayed. Reclassify warns in the spec's words |
| Chunks / report cache | Keyed by page only | Keyed by `activeIndexVersion` (chunks) and by `activeIndexVersion` + policy version (report), so a finished reindex or a policy save reloads them. Revealed pages are never cached |
| Redaction report | A switch revealed values at once; fixed 10 a page | Reveal sits behind a confirmation that it is audited. 5 / 10 / 20 a page. NER outage guidance points policy editors to the failure-mode setting. The tab lives at `…/:documentId/privacy` (the old `…/pii` redirects) |
| Knowledge-base settings | A background refetch silently reset a dirty form | The form keeps your edits and shows "changed since you opened it" with "Load the latest". Saves diff against the copy you opened. A lost answer re-reads the base. The base is refetched before the form opens |
| Reindex all | A toast with a count | A dialog listing what will and won't be reindexed (busy, permanently failed: opt-in), then every document's outcome. A 429 pauses the run for its `Retry-After`, and it can be stopped part-way |
| Access tab | Hidden on WORKSPACE bases; pickers vanished without permission | Grants listed on WORKSPACE bases under "Grants take effect only while this base is Restricted" (they can be prepared in advance). Pickers explain a missing `role:read` / `member:read` / `apikey:read`. After changing a grant that concerns you, the base is re-read: losing it navigates away, dropping below Manage says what's left |
| Search | Rerank switch "off" meant "deployment default"; links for everyone | Rerank Default / On / Off. Both clearances shown, plus the topK cap when it applied. Empty results are explained (no reachable base, documents still processing, nothing ready within clearance, narrowing too tight) with "Search everything you can reach". 503 / timeout offer "Try again" and keep the question. Document links need `document:read`. Leaving the page cancels a running search |
| Bulk actions | A 429 stopped the run | A 429 pauses and resumes; 409 "already processing" counts as done |

## 2. Operation coverage (all 23)

| ID | Where in the UI |
|---|---|
| P3-API-01 | Knowledge bases list; sidebar; vault filter and statistics; upload dialog; home dashboard |
| P3-API-02 | Knowledge bases → New |
| P3-API-03 | Knowledge base page (refetched on mount); "check whether it's gone"; self-lockout re-check |
| P3-API-04 | Knowledge base → Settings |
| P3-API-05 | Knowledge base → Settings → Danger zone (typed name) |
| P3-API-06–08 | Knowledge base → Access; Add access dialog |
| P3-API-09 | Upload dialog, page drop zone, upload activity panel |
| P3-API-10 | Document Vault; polling; upload check; reindex-all planning |
| P3-API-11 | Document drawer (polled while processing); delete/reclassify checks |
| P3-API-12 | Document drawer → Chunks |
| P3-API-13 | Row menu and drawer → Download original (blob, `filename*` first) |
| P3-API-14 | Drawer → Edit details, Reclassify; bulk reclassify |
| P3-API-15 | Row menu, drawer, bulk bar, Reindex all |
| P3-API-16 | Row menu, drawer, bulk bar |
| P3-API-17 | Settings → Privacy; redaction tab and vault preview (policy version in the cache key) |
| P3-API-18 | Settings → Privacy → Review and save |
| P3-API-19 | Settings → Privacy (catalogue); labels in reports |
| P3-API-20 | Settings → Privacy → Test the policy |
| P3-API-21 | Drawer → Redaction; vault's redaction preview panel |
| P3-API-22 | Search page; vault "Ask" |
| P3-API-23 | Search page "Your access" panel and empty-result explanations |

## 3. Decisions the spec left open

- **Routes.** The spec's suggestions: `/documents` (filters in the URL), `/documents/:documentId` with `/chunks` and `/privacy`, `/knowledge-bases`, `/knowledge-bases/new`, `/knowledge-bases/:kbId` (+ `/access`), `/search`, `/settings/privacy`. The document detail is a drawer over the vault, so the list keeps its filters.
- **Clearance source.** Clearance and assignable classifications come from the contextual permission list, not from P3-API-23, which Viewers can't call (§3.7).
- **Unknown outcomes.** A network error, client timeout, 408 or 5xx (except the 503s after which nothing is stored) is "outcome unknown" for uploads, deletes, reclassifications, grant changes, base edits and policy saves. The UI re-reads and never resends.
- **Masking more vs less.** The editor confirms every change the server audits as "weakened" (off, removed types, higher threshold, REFUSE → DEGRADE, longer allow list). It also confirms removed deny-list terms, which mask less too.
- **409 on the policy.** The newer version is re-read; the panel lists what changed on the server and offers "Re-apply my changes" (fields you changed keep your value, others take the server's) or "Discard". The result is reviewed again before saving with the new version.
- **Preview length.** The textarea warns past the 20,000-character default but doesn't block, because a deployment can raise the cap; the server's 422 message is shown as is.
- **Uploads across workspaces.** Uploads already sending continue if you switch workspace (aborting mid-transfer would only create unknown outcomes); each belongs to the workspace it was queued in and appears only there. Reads and polling stop with the workspace tree.
- **Search question.** Kept out of the URL (§9.2). The vault's "Ask" hands it to the search page in memory.

## 4. Acceptance checks (P3-T01–P3-T42)

Evidence levels: **U** unit test (`npm test`). **M** headless-Chrome run against a mock API (scripted, not committed; owner only). **I** implemented and reviewed, not run end to end. **R** needs the real backend, a second account or a disposable outage. Nothing is ticked as accepted: acceptance needs **R** evidence and the owner's demonstration.

| ID | Status | Evidence / note |
|---|---|---|
| T01 | U, I | Every control derives from `can()` and the §3.5 rule table (`access.test`: Owner/Admin/Member/Viewer/custom matrix) |
| T02 | U, I | `workspacePath()` builds path and header from one id; every Phase 3 read takes the query's `AbortSignal` |
| T03 | M, I | Loading, empty, filtered-empty, forbidden, hidden-404 ("doesn't exist or you don't have access") and retry states on vault, drawer, bases, access, search, privacy |
| T04 | U, M | Multipart through the shared adapter (`client.test`); download parses JSON errors; request ids shown on failures |
| T05 | M, I | No horizontal overflow at 360 px on the new screens; icons and text alongside colour; `motion-reduce` on new transitions. No screen-reader audit yet |
| T06–T07 | M, I, R | List, search, sort; name collision and overlap errors map to fields |
| T08 | U, I | Only assignable defaults offered; 403 mapped to the field |
| T09 | U, I | Dirty-field PATCH against the copy opened; `null` restores inheritance; embedding model read-only |
| T10 | I, R | Restricting confirms the automatic Manage grant and opens the Access tab |
| T11–T12 | M, I, R | Labels from `subjectLabel`; membership ids; upsert keeps the grant; repeat revoke handled |
| T13 | U, I, R | `affectsOwnAccess` + `myLevelAfter`; warning in the spec's words; re-check and navigate after losing access |
| T14 | I, R | Typed name; caches evicted (detail, rows, lists, scope) |
| T15 | U, M | Upload via drop in the mock run; classification always sent; tags normalised (`upload.test`) |
| T16 | U | Every 415/413/400/422/403/503 refusal described (`upload-errors.test`) |
| T17 | U | Link only with `existingDocumentId` |
| T18 | U | Unknown → check → found/not found (`upload-queue.test`); never resent |
| T19 | U, M | `polling.test`; hidden-tab pause by TanStack; workspace switch unmounts the queries |
| T20 | U, M | `status.test`; vault and drawer screenshots of every state |
| T21 | U, M | `filters.test`; URL state |
| T22 | M | Chunk viewer with pages; empty state for never-indexed documents |
| T23 | U, I, R | Blob download with `filename*`; Members have no download control (permission) |
| T24 | I, R | Needs a second session to see the document disappear |
| T25 | I, M | 409 `DOCUMENT_PROCESSING` → "already processing" |
| T26 | I | Destruction warning; second delete treated as done |
| T27–T29 | U, M | Source/version/warnings; deny list hidden for readers; catalogue grouped with availability (`pii-policy.test`) |
| T30–T31 | M, I | Masked output, detections, degraded banner, 422 message; reveal behind confirmation, component state only, hidden after 60 s or when the tab is hidden |
| T32 | M, I | Report pages ≤20; empty report; Viewer has no tab |
| T33 | M, R | REFUSE 503 guidance shown in the mock run; DEGRADE needs the real AI service stopped |
| T34–T36 | M, I | Narrowing, mode, topK, minScore (dense), rerank; relative score bar only; empty-result explanation; hidden-base 404 drops the base |
| T37 | R | Needs a lower-clearance second session |
| T38 | M, R | Mocked 503 shows the temporary state with "Try again"; real outage pending |
| T39 | R | All 23 operations through the UI against a running backend |
| T40 | I | Chunk text, passages, analysis text and revealed values live in memory only: no storage, URLs, logs or persisted caches |
| T41–T42 | — | Owner decisions (§5 below), commit record, owner review |

## 5. Backend constraints (spec §13): what the frontend does

| ID | Frontend behaviour |
|---|---|
| P3-G01 | Nothing needed: masking output is rendered as returned |
| P3-G02 | Implemented per source contract (encrypted PDF, OCR, quota, integrity, stalls, 429); untested live |
| P3-G03 | Chunks and passages shown unmasked to cleared users, labelled as such; kept in memory only |
| P3-G04 | Inert grants on WORKSPACE bases are shown under an explicit banner |
| P3-G05 | No-op saves impossible: the save button needs a real change, and only changed fields are sent |
| P3-G06 | Path and header always from one id |
| P3-G07 | Self-lockout warning, then a re-check and navigation |
| P3-G08 | "Reindex all" and bulk actions are explicit loops; no trash or restore is promised; realtime waits for Phase 5 |
| P3-G09 | "No relevance floor" stated on the search page; scores never shown as percentages |
| P3-G10 | Duplicate messages say "in this knowledge base" |
| P3-G11 | Masked text is rendered as returned; offsets are never used to splice the original |
| P3-G12 | The Add-access dialog and Access tab say Managers can grant Manage |

## 6. Running and checking it

- `npm run typecheck`, `npm run lint`, `npm test` (31 files, 270 tests) and `npm run build` pass.
- A busy Windows machine can time out Vitest workers at startup. `npx vitest run --maxWorkers=2` avoids that; it isn't a test failure.
- **Mock run on Windows.** In Git Bash, prefix `MSYS_NO_PATHCONV=1` when pointing Vite at a proxy: `MSYS_NO_PATHCONV=1 VITE_API_BASE_URL=/api/v1 BACKEND_URL=http://localhost:<port> npx vite --port 5180`.
- The real-backend run should use disposable fixtures: Owner, Administrator, Member, Viewer and a custom role holding `clearance:restricted`, two workspaces, real PDF/DOCX/TXT/Markdown files, and an AI service that can be stopped to see the outage states.
