# UX-Parity Audit — Notion/Obsidian benchmark (#79)

Date: 2026-10-26 · Auditor: QA Engineer agent · Status: **first full pass complete**

## Scope & method

- **Product under test:** Lekhan web app (`/` landing, `/login`, dashboard, `/page/<id>` editor) at commit `df37744` (+billing-only local diff).
- **Environment:** `next dev -p 3721` (Turbopack), Chrome via agent-browser CDP, workspace with 2 pages, remote Supabase hub. New QA test account created; E2E creds in `tests/e2e/e2e.spec.ts` are **stale/invalid** (see GAP-8).
- **Emissions tracked via:** `agent-browser vitals` (FCP/TTFB/CLS/hydration), `agent-browser react renders stop --json` (render profile during typing), accessibility-tree snapshots, source inspection of `services/graph.ts`, `services/search.ts`, `components/{global-search-palette,slash-menu,sync-indicator,offline-banner,editor-workspace}.tsx`.
- **Caveats:** dev-mode timings overstate production by compiled-bundle overhead but understate by network/prod cache variance; single-page workspace (not 10k). Benchmarked **against the interaction contract**, not pixel-perfection, per anti-scope.

## 1. Latency budgets vs measurements

| Budget | Measured (dev mode) | Verdict | Evidence |
|---|---|---|---|
| Page open, warm < 100 ms | Navigational DCL ≈ 156 ms; editor visible only after ≥2 chained awaits (`getSession`/`getUser` → `fetchPageDetails`). Dominated by cloud round-trips + **full workspace fetch** in open path | **FAIL at scale** (likely >100 ms at 10k pages despite prod build) | `app/page/[id]/page.tsx`, `components/editor-workspace.tsx:156-175` |
| Page open, cold (IndexedDB) < 300 ms | **Not verifiable** — no observed IndexedDB page-cache path in the open critical path; page content is fetched from the Hub every open | **FAIL by construction** unless a cold local cache path exists | source review |
| Typing latency < 16 ms | Not directly measurable (CDP key events not surfaceable). Render profile: **7,285 React renders** during a 38-char burst (~41 fps avg, **drops to 20 fps**), `EditorWorkspace` self-time 117 ms, re-rendering incl. toolbar and dropdown scopes per keystroke | **AT RISK** — needs frame-level re-measure in prod build; strongest local-first asset here is TipTap/ProseMirror, and right now React state churn is the bottleneck | `agent-browser react renders` on `/page/<id>` |
| App boot to interactive < 1 s | Landing: FCP 212 ms, hydration 130 ms, TTFB 72 ms → ≈ 250-350 ms. Dashboard similar | **PASS** (dev) | `agent-browser vitals` |
| Search 10k pages < 200 ms keystroke-to-render | **FAIL by design**: 200 ms debounce (DEBOUNCE_MS) + Supabase `search_pages` RPC round trip — a single keystroke ≥ 200 ms + RTT alone; and every recent-pages open fetches all workspace pages via `fetchWorkspacePages` (`select('*')` unbounded) just to show 8 recents | **FAIL** | `components/global-search-palette.tsx`, `services/search.ts`, `services/graph.ts:27` |
| Sync indicator truthful | States implemented: Offline / Connecting(spinner) / Saving / Synced. Two deviations from budget: (a) "Connecting..." spinner is deliberately used to mask a **known** ~50 s Render cold-start — budget explicitly bans spinner-where-state-known; (b) "Offline" + "Saving..." can coappear with edits actually persisted locally w/o a distinct "local-only" state | **PARTIAL** | `components/sync-indicator.tsx`, `components/offline-banner.tsx` |
| Other | CLS on dashboard **0.126** (> 0.1 "good" threshold) — hydration layout shift | gap | `agent-browser vitals` |

## 2. Interaction-by-interaction vs incumbents

| Interaction | Notion | Obsidian | Lekhan today | Gap |
|---|---|---|---|---|
| Create page | ⌘N, click, nested under any page | ⌘N + file tree | "Create" button works (→ `/page/<uuid>`); **no keyboard shortcut**; nesting not surfaced in grid | Keyboard; hierarchy |
| Open/navigate | Quick switcher ⌘⇧O, sidebar tree | Quick switcher ⌘O + file tree + graph | Sidebar arcs to several screens; no page tree, quick switcher = same ⌘K search | Tree nav, quick switcher parity |
| Search | Cloud-fast, scoped filters | Instant local | ⌘K palette works (recent, keyboard nav) but ≥ 200 ms debounce + RPC RTT; separate header "Search..." input = second search affordance | Latency; affordance duplication |
| Slash menu | Full block palette | (n/a/tab-complete) | Works (headings, tables, callout, code, divider, Ask Bot) with keyboard nav | OK |
| `[[` autocomplete | Link popup w/ create affordance | Popup + "Create new note" fallback | Exists in code (`lib/wikilink.ts`); **popup did not appear** while testing mid-block; only 2-page workspace may mask it | Verify + empty-state affordance |
| Editing forgiveness | Robust | Robust | Edits made while indicator said "Offline" **survived reload** — no data loss observed. Paste/round-trip audit deferred to #78 pairing | Partially verified |
| Sync indicator | n/a | Instant truth | See table: spinner-masking cold start is the main deviation | Fix states |
| Empty states | Designed | Designed | Dashboard empty state well-designed (CTA + hint). Editor minimal | OK |
| Error states | Designed | Designed | Login error renders visibly (form-level box); silent 400 on stale creds during first pass showed **no surfaced error to browser session** until re-submit | Verify login failure surfacing |
| Mobile web | Responsive | n/a (native) | Responsive reflow works (menu collapses, Export accessible), full toolbar present on 390 px; unthrottled long-toolbar scroll not assessed | P2 verify |
| Login → workspace | Direct to workspace | Direct (no login land) | ⌘K works post-login; login redirect `/` lands on dashboard generic (not last page) — acceptable, note for polish | P3 |

## GAP tickets (filed as GitHub issues)

| ID | Sev | Ticket |
|---|---|---|
| GAP-1 | P1 | [#137](https://github.com/coderhd/lekhan/issues/137) — Unbounded workspace fetches in page-open & palette paths block warm <100 ms and 10k-page scale |
| GAP-2 | P1 | [#138](https://github.com/coderhd/lekhan/issues/138) — Search must be local-first edge over graph index; replace cloud RPC as primary path |
| GAP-3 | P1 | [#140](https://github.com/coderhd/lekhan/issues/140) — No full keyboard shortcut map / shortcut help surface |
| GAP-4 | P1 | [#139](https://github.com/coderhd/lekhan/issues/139) — No IndexedDB-cold open path: page content fetched from Hub every open |
| GAP-5 | P2 | [#144](https://github.com/coderhd/lekhan/issues/144) — Typing render storms (7,285 renders / 38 chars); re-measure to < 16 ms in prod build |
| GAP-6 | P2 | [#141](https://github.com/coderhd/lekhan/issues/141) — Sync indicator honesty: spinner masks known ~50 s cold start; missing "Local edits only" state |
| GAP-7 | P2 | [#142](https://github.com/coderhd/lekhan/issues/142) — `[[` popup absent mid-typing + no "create page" empty-state affordance |
| GAP-8 | P1 | [#143](https://github.com/coderhd/lekhan/issues/143) — Stale E2E credentials; login-path e2e verification broken |
| GAP-9 | P2 | [#145](https://github.com/coderhd/lekhan/issues/145) — Dashboard CLS 0.126 during hydration |
| GAP-10 | P3 | [#146](https://github.com/coderhd/lekhan/issues/146) — Login lands on generic dashboard, not last-opened page |

## UX-parity checklist (standing gate) — first peer verdicts

- [x] Latency budgets **measured** (not all met — gaps filed above)
- [x] Keyboard path audited: exists for core flow, **gap filed** for full map
- [x] Empty/loading/error states audited: designed where observed, verification tickets for login-failure + `[[` empty states
- [x] 10k-pages scale verdict reached by static path analysis (fails, GAP-1/2)
- [x] Offline behavior observed: edits survive reload; indicator honesty gap filed
- [x] Copy audited against CONTEXT.md vocabulary: "document", "note"... acceptable on core screens; = follow-up

No blocking visual-polish findings per anti-scope.
