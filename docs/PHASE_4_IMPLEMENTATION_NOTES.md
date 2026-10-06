# Phase 4 — Frontend implementation notes

**For:** the backend engineer and project owner reviewing Phase 4 acceptance
**Handoff implemented:** [Phase 4 revision 1](PHASE_4_AGENTS_MODELS_CONVERSATIONAL_AI.md) (6 October 2026, backend baseline `42ab352` + P4-G01). Contracts were re-checked against the agents, conversations and LLM controllers, DTOs, mappers and SSE writer in the backend repository.
**Status:** ready for review against a real backend. Typecheck, lint, unit tests (38 files, 340 tests), the production build and a mock-API browser run all pass. There is no real-backend, second-session or outage evidence yet.

## 1. What this pass delivers

Before this pass the frontend had no Phase 4 code: "AI agents" was a "planned" placeholder page, and there was no chat, supervision, model, playground or usage screen. Everything below is new, apart from the extensions to shared Phase 1–3 code listed under "Shared adapter", "Phase 3 hooks" and "Navigation".

| Area | What exists now |
|---|---|
| Operations | All 25, labelled P4-API-nn in `src/lib/api/endpoints.ts` (`agentsApi`, `conversationsApi`, `llmApi`) |
| Shared adapter | `accept` option; `timeoutMs: null` (no total timeout); `openEventStream()`, a POST event-stream reader on the same pipeline as every JSON call (bearer, refresh-and-replay on a pre-stream 401, request id, JSON envelope, global handler), with a 45 s idle watchdog and no reconnect. Sends and direct chat get 310 s, prompt preview 65 s |
| Streaming | `lib/api/sse.ts` (line parser, any chunking, CRLF, heartbeats) and `lib/agents/stream.ts` (`postEventStream` → `done / failed(afterOpen) / aborted / interrupted`). Every running stream is tracked and aborted on session end; a `BroadcastChannel` carries ids only (never content) so a second tab shows "Answering in another tab" |
| Turn engine | `features/chat/use-turn.ts`: one turn at a time. Streamed (19) or whole (18). Stop aborts, then the newest page is read back (§9.4): answered, partial (CANCELLED/FAILED shown), running (polled every 2.5 s up to the 300 s budget, with "Stop waiting"), or not stored (the text returns to the composer). Governance refusals show a countdown and retry **once** automatically with the same `clientMessageId`; `MESSAGE_DUPLICATE` is reconciled quietly; a failure after `generating` is read back rather than resent |
| Agents | Directory (name search, Published/Drafts filter for managers and authors, no sort control); overview; builder/editor in the spec's section order; versions (history, full configuration, compare with instructions line diff, "Identical to vN", restore); prompt preview (masked messages with placeholder chips, context-budget bar, masking + egress, retrieval reach); publish / unpublish / delete with the spec's confirmation copy |
| Editor rules | Create sends only what was filled in. Edit sends `agentPatch` (changed keys, `parameters` whole, order-insensitive comparison, `expectedVersion`), shows "Saving will create version N+1" only for behaviour edits, takes a change note, warns on navigation. 409 conflict: a panel lists what the other save changed and offers "Re-apply my changes" (your fields win) or "Discard mine". A background refetch while you're editing raises "changed since you opened it" (P4-G05). 409 name, 404 knowledge base/role and 422 model/field errors land on their fields |
| Chat | Two panes (list grouped by recency, agent and status filters, rename/archive/delete; thread). `/chat/new?agent=…` shows the greeting and creates the conversation only on the first send. Safe Markdown answers (no HTML path), `[S1]` superscripts linked to sources (cited first, "Also consulted", relative bar, never a percentage, Phase 3 document link with `document:read`), tool chips, notices for withheld/cancelled/failed/masked/degraded, per-turn details (model, version, tokens, timings, reach, masking, context budget), cursor-paged history keeping your scroll place, day separators, polite live region speaking whole sentences, "Stop the answer and leave?" guard, per-turn options (stream on/off, retrieval off, narrow to some of the agent's bases, temperature, max answer) |
| Supervision | `scope=all` table/cards with owner name (`member:read`) or "API client", masked titles; read-only drawer, masked by default; Reveal (`pii:reveal`) behind an audited-event confirmation, held in component state only and dropped on close or tab hide; delete names the owner (P4-G09) |
| Models | Settings → Models: effective limits including the endpoint classification ceiling, catalogue with Allowed/Default badges and the unverified notice, policy editor (`llm:manage`) sending only changes + `expectedVersion`, `null` = inherit, 409 rebase, warning for models removed from the list |
| Playground | System prompt, model, sampling, streaming on/off, Stop, per-reply masking report (entities, types, placeholders put back, degraded) and timings; the transcript lives in component memory only |
| Usage | Window presets + custom dates (start after end is refused, P4-G14); headline tiles; outcome part-to-whole bar with icons and a labelled legend; masking overhead; by model / by agent with names resolved ("Direct chat", "Deleted agent"); "—" for empty percentiles |
| Navigation | `LIVE_PHASE = 4`; Chat under the dashboard; Agents and Playground under Build; Supervision and Usage under Govern; Models in Settings; breadcrumbs show agent names and conversation titles; full-height chat and playground screens |
| Phase 3 hooks | Document deletion/reclassification, grant changes and role changes now invalidate open conversations (labels can now withhold messages, §9.5) |

## 2. Operation coverage (all 25)

| ID | Where in the UI |
|---|---|
| P4-API-01 | Agent directory; chat agent picker and filters; usage names; dashboard step |
| P4-API-02 | Agents → New agent |
| P4-API-03 | Agent pages (refetched on every visit); chat header, greeting, composer options; draft chat |
| P4-API-04 | Agent → Configure |
| P4-API-05 | Agent → ⋯ → Delete agent (typed name) |
| P4-API-06 / 07 | Agent header Publish; ⋯ → Unpublish; after-create "Publish" |
| P4-API-08 | Agent → Versions (history) |
| P4-API-09 | Agent → Versions → a version outside the loaded page, Compare |
| P4-API-10 | Agent → Versions → Restore |
| P4-API-11 | Agent → Prompt preview (optionally with one of your conversations; also from the thread's ⋯ menu) |
| P4-API-12 | Chat list (`mine`), Supervision (`all`), dashboard card, preview's history picker |
| P4-API-13 | First send from `/chat/new` |
| P4-API-14 | Thread, supervision drawer, breadcrumbs |
| P4-API-15 | Rename, archive, unarchive (list, thread menu, composer notice, "Unarchive and send") |
| P4-API-16 | Delete from list, thread menu, supervision table and drawer |
| P4-API-17 | Thread history (infinite, `before`), reconciliation reads, supervision (masked) and reveal (`reveal=true`, never cached) |
| P4-API-18 | Composer options → "Stream the answer" off |
| P4-API-19 | Every streamed turn |
| P4-API-20 / 21 | Playground (stream off / on) |
| P4-API-22 / 23 | Settings → Models; model pickers; output-ceiling hints; classification ceiling notes |
| P4-API-24 | Settings → Models → Workspace model policy |
| P4-API-25 | Usage |

## 3. Decisions the spec left open

- **New chats are created lazily.** "New chat" and "Start chat" open `/chat/new?agent=…` with the greeting. `POST /conversations` runs on the first send, so browsing agents leaves no empty conversations. The first question is handed to the thread in memory, never through the URL or history state (§9.2). An optional title can be set before sending.
- **Automatic retry.** Only `TOKEN_RATE_LIMITED`, `LLM_BUSY` and `RATE_LIMIT_EXCEEDED` with a wait of 30 s or less retry by themselves, once, with the same key. `QUOTA_EXCEEDED` and `AGENT_CIRCUIT_OPEN` show the countdown only.
- **Where reconciliation reads.** Only the newest page is re-read and merged into the cache, so a long history isn't refetched after every turn.
- **Someone else's conversation at `/chat/:id`.** It points to Supervision, which carries the masking and audit context, instead of rendering a second supervision view.
- **Message length.** The 16,000 cap (`AGENT_MAX_MESSAGE_LENGTH`) isn't exposed by any endpoint, so `lib/agents/limits.ts` holds it. The counter appears near the cap, and the server's 422 still explains.
- **Markdown.** Answers, greetings and instructions go through a small parser written for this (`lib/agents/markdown.ts`): paragraphs, lists, tables, code, links (http/https/mailto only, `noopener noreferrer`). Raw HTML stays text. Questions are always plain text.
- **Supervision with masking off.** If the workspace policy disables redaction, the server returns others' content as stored with `masked: false` (found in source). The drawer says so instead of claiming it is masked.

## 4. Acceptance checks (P4-T01–P4-T42)

Evidence levels: **U** unit test (`npm test`). **M** headless-Chrome run against a mock API (scripted, not committed; owner only). **I** implemented and reviewed, not run end to end. **R** needs the real backend, a second account or a disposable outage. Nothing is ticked as accepted: acceptance needs **R** evidence and the owner's demonstration.

| ID | Status | Evidence / note |
|---|---|---|
| T01 | U, I | `agentCapabilities` from the permission list, checked against the spec's live role lists (`agent-form.test`); no role names anywhere |
| T02 | I | Path and header from one id; the workspace tree remounts per workspace, so streams abort and partial text is discarded; session end aborts every stream |
| T03 | M, I | Loading, empty, filtered-empty, forbidden, hidden-404, streaming and retry states on every new list, detail and thread |
| T04 | U, M | 310 s plain sends; fetch-based SSE with JSON-before / event-after failures (`sse.test`, `stream.test`) |
| T05 | M, I | No horizontal overflow at 360 px; focus-visible; polite live region; icons beside colour; reduced motion; no HTML rendering path. No screen-reader audit yet |
| T06 | M, I, R | Name search, visibility filter, no sort |
| T07 | U, M, R | `createInput` sends only filled fields; name collision on the field |
| T08 | M, I, R | Picker of readable bases; hidden count; hidden bases never sent; 404 drops the base |
| T09 | M, I | Allowed models + "Workspace default"; ceiling hint; 422 on the field |
| T10 | U, M | `agentPatch`/`createsVersion`; version notice; conflict panel and rebase |
| T11 | U, I, R | Creator without `agent:update`: no Configure tab or Publish; the create page warns |
| T12 | M, R | Publish/unpublish confirmations; members' effect needs a second session |
| T13 | U, M | History, detail, compare + line diff, digest twins, restore (current version can't be restored) |
| T14 | I, R | Typed-name delete; 409 `AGENT_UNAVAILABLE` → "start a new conversation" |
| T15 | M | Masked messages, context bar, masking + empty egress, reach |
| T16 | R | Needs other roles |
| T17 | M, I | Greeting banner; derived title after the first send; optional explicit title |
| T18 | U, M | Stage labels, streamed text, `done` replaces the bubbles; ids from `meta` |
| T19 | U, M | Cited vs consulted, document links only with `document:read`, no percentages |
| T20 | M | Stop → CANCELLED partial answer after reconciliation; next send works |
| T21 | U, I | Interrupted → read back; resend reuses the key; `MESSAGE_DUPLICATE` reconciled |
| T22 | I, R | Composer locked while busy; cross-tab channel; 409 `CONVERSATION_BUSY` keeps the draft (Try again) |
| T23 | I | Options popover: stream, retrieval off, narrowing, temperature, max answer |
| T24 | M | Newest page first, older pages keep the reader's place, end at `nextBefore: null` |
| T25 | U, M | Withheld rows with reasons, never errors (`turn.test`); REDACTION_UNAVAILABLE needs **R** |
| T26 | M, I | Rename/archive/unarchive; archived composer offers Unarchive; 409 handled |
| T27 | I, R | Delete own; supervisor delete names the owner |
| T28 | M | Masked list and thread, owner kind, reveal behind confirmation, not cached |
| T29 | M | Tool chips; denied/error reasons in tooltips; no tool picker |
| T30–T31 | U, M | Catalogue badges and unverified notice; policy patch, null-to-inherit, 409 rebase (`llm-policy.test`), ceiling shown |
| T32 | M | Playground streamed and plain; masking report; memory only |
| T33 | U, M | Windows, empty window as "—", names resolved, deleted agents labelled |
| T34 | U, M | Countdown + one automatic retry (mocked `TOKEN_RATE_LIMITED`); real throttles need **R** |
| T35–T37 | I, R | Overflow, AI outage, unpublish/delete under an open chat |
| T38 | R | Second session |
| T39 | R | All 25 operations through the UI against a running backend |
| T40 | I | Content in memory only: query cache (never persisted), component state for previews, reveals and the playground; no URLs carry questions |
| T41–T42 | — | Owner decisions (§5 below), commit record, owner review |

## 5. Backend constraints (spec §13): what the frontend does

| ID | Frontend behaviour |
|---|---|
| P4-G01 | Never sends `null` except where §6 allows it (clearing description, model, contextWindow, persona role/language/greeting, minScore, maxClassification) |
| P4-G02 | Every source-only code has wording, a remedy and the right retry rule; untested live |
| P4-G03 | Instructions are shown to every reader, with "never put secrets here" in the overview and editor |
| P4-G04 | No Configure or Publish without `agent:update` / `agent:publish`; the create page warns authors |
| P4-G05 | Agent refetched on every visit; "changed since you opened it" while editing |
| P4-G06 | Usage is labelled "All model calls in this workspace" |
| P4-G07 | The endpoint ceiling is shown in the directory, overview, editor, chat greeting and models page |
| P4-G08 | No sort controls on agents or conversations |
| P4-G09 | Supervisor delete names whose conversation it is |
| P4-G10 | Delete copy says it's final and the name is freed |
| P4-G11 | Tool calls are shown read-only; no granting |
| P4-G12 | Per-message "Names weren't masked for this answer" |
| P4-G13 | Error events use their own `status`; nothing-stored vs stored follows `generating` |
| P4-G14 | Custom windows are validated before the call |
| P4-G15 | Path and header always from one id |
| P4-G16 | Masked and withheld outcomes of the same outage are both rendered |

## 6. Running and checking it

- `npm run typecheck`, `npm run lint`, `npm test` (38 files, 340 tests) and `npm run build` pass.
- **Mock run on Windows.** In Git Bash: `MSYS_NO_PATHCONV=1 VITE_API_BASE_URL=/api/v1 BACKEND_URL=http://localhost:<port> npx vite --port 5180 --force`. On a cold start, wait until the optimizer has finished before loading pages. Otherwise the first load can mix two dependency bundles and fail with "Invalid hook call".
- The real-backend run should follow the spec's §12 fixtures: Owner, Administrator, Member, Viewer and an "Agent Author" (`agent:create` without `agent:update`), a RESTRICTED knowledge base granted to one member, two workspaces, real model calls, and an AI service that can be stopped.
