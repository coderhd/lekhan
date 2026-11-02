# Clean-room review — PR for SIL-208 / GV-T3 (backlink drawer)

**Branch:** `feat/208-gv-t3-backlink-pane` (base `origin/main` @ `c1a7127`)
**Reviewer:** independent clean-room subagent (fresh context), auditing `git diff origin/main...HEAD`
**Spec:** `docs/superpowers/specs/2026-11-02-h1-graph-view-backlink-pane-design.md` (GV-T3, lines 55-65, 82-92)
**Verdict:** REVISE — 2 medium delivery gaps, 3 medium a11y/security-evidence gaps, 6 low.

---

### 🔍 Clean-Room Review Summary

| Axis | Status | Summary |
|---|---|---|
| 1. Spec & ADRs | **FAIL** | Drawer, lazy mount, service reuse, click-through and the three states all land; `fetchPageBacklinks` and `services/graph.ts` are untouched and no ADR/tier invariant is crossed. But the required "one-line context" is dead code with no producer (and is wired to the wrong title), and the "unresolved row" branch cannot be produced by the real query — it is only exercised with a fabricated `from_page_id: ''`. |
| 2. Frontend & a11y | **FAIL** | Native `<button>`s, labelled close, `role="dialog"` + `aria-labelledby`, Escape, dynamic-row-aware trap and desktop focus restore are present. The trap is panel-scoped and leaks to the editor once focus lands on `<body>`; global editor shortcuts still fire behind the modal; the mobile entry point cannot restore focus. |
| 3. CRDT & Storage | **PASS** | Zero CRDT/IndexedDB surface. Delta is components/lib/tests/env only; no `Y.Doc`, no engine, no transaction, no write path. Read-only by construction (`fetchPageBacklinks` is a `select`). |
| 4. Backend & Security | **FAIL** | Errors propagate (service throws → error state → retry); no title leakage to anon (both entry points gated on `anonVisitor`) and no new query. But the mandatory "real Supabase fixture proof" never runs in CI, and the always-on fixture is a self-fulfilling stub whose stranger branch is a literal `apiKey === 'member-key'`; even the gated real test cannot detect the policy regression it exists to guard. |

---

### Actionable Findings

#### 💡 [MEDIUM]: Backlink context is centred on the *linking* page's title, not the page being viewed
- **File**: `components/backlink-pane.tsx:119`
- **Issue**: `buildBacklinkContext(bodyByPage?.[from_page_id], backlink.from_title)` passes `from_title`, but the helper searches for `[[target]]`/`target` — i.e. the title of the *linked* page (the one the drawer is open for). For `Alpha source → [[Beta target]]` the snippet is centred on a mention of "Alpha source" (or falls back to offset 0), not on the link. Verified against the real helper:
  ```
  WRONG target(from_title):  Alpha source is a long note. … references [[Beta target]] in the middle…
  RIGHT target(page title):  …t explains many things … and then references [[Beta target]] in the middle… keep…
  ```
  Latent only because nothing supplies bodies (see next finding) — it becomes user-visible the moment `bodyByPage` is wired.
- **Recommended Fix**: pass the current page's title (`BacklinkPane` needs a `targetTitle` prop from `editor-workspace`, which already has `title`):
```diff
- context: buildBacklinkContext(bodyByPage?.[backlink.from_page_id], backlink.from_title),
+ context: buildBacklinkContext(bodyByPage?.[backlink.from_page_id], targetTitle),
```

#### 💡 [MEDIUM]: The "one-line context" deliverable has no producer — production rows are title-only
- **File**: `components/backlink-pane.tsx:89,119` · `components/editor-workspace.tsx:1394-1399`
- **Issue**: `bodyByPage` is never passed anywhere (`grep bodyByPage` returns only `backlink-pane.tsx`), and `fetchPageBacklinks` selects only `from_page_id` + `pages(title)`. So `context` is always `undefined` in the shipped UI; the only proof is `tests/unit/backlink-pane.test.tsx:73-82` hand-feeding an object literal. GV-T3's "list, context line, …" and the PR summary's claim of a context line are not demonstrable in the app. The spec (lines 63-65) tolerates "otherwise page title only", so this is a delivery/claim gap, not a schema violation.
- **Recommended Fix**: either state explicitly that v1 is title-only and delete the unused seam + helper, or wire a real producer and record a screenshot/test through `editor-workspace` (not just the hand-fed prop).

#### 💡 [MEDIUM]: Modal focus trap leaks to the editor when focus is not inside the panel
- **File**: `components/backlink-pane.tsx:144-166` (`onKeyDown`), `:176-183`
- **Issue**: The trap is a React `onKeyDown` on the dialog, so it only runs when the key event originates inside the panel. Clicking a non-focusable part of an open drawer — the empty list region, header padding, the loading skeleton, the space below a one-row list — blurs to `<body>` in Chrome; the next Tab is handled by the browser, not the panel, and lands on the editor toolbar behind the backdrop. There is also no `inert`/`aria-hidden` on the background and no `focusin` guard, so programmatic/AT focus outside is untrapped. Escape likewise stops working once focus is outside.
- **Recommended Fix**: bind a `document` `keydown` listener in an effect while mounted (cleanup on unmount), give the panel `tabIndex={-1}` and refocus it on `focusout` to the background, and mark the editor region `inert` while the drawer is open.

#### 💡 [MEDIUM]: Global editor shortcuts still fire behind the modal and can stack drawers
- **File**: `components/editor-workspace.tsx:955-969` · `components/global-search-palette.tsx:57`
- **Issue**: `Cmd/Ctrl+Shift+S` runs `setIsHistoryOpen(true)` without touching `isBacklinksOpen`, so opening backlinks then pressing the shortcut renders `VersionDrawer` (600 px, `z-50`) while the backlink drawer (400 px, `z-[60]`) stays mounted — two drawers and two `onClose` paths at once. `Cmd/Ctrl+L` opens the Lekhan Bot bar behind the backdrop and `Cmd/Ctrl+K` opens the command palette over the modal. The header buttons correctly close siblings; the keyboard paths do not.
- **Recommended Fix**: gate the shortcut effect on `isBacklinksOpen` (or a single `anyPanelOpen` flag), and have one shared "open panel" action that closes all others.

#### 💡 [MEDIUM]: The "real Supabase fixture proof" is skipped by default and, even when run, cannot catch the policy it claims to guard
- **File**: `tests/unit/backlink-supabase-fixture.test.ts:63` (stub) · `:125` (`describe.skipIf`) · `:186-204` (real test) · `.github/workflows/` (only `pullfrog.yml`; no `TEST_SUPABASE_*` anywhere)
- **Issue**: Acceptance requires "real Supabase fixture test against `fetchPageBacklinks`". (a) The always-on layer is an in-process HTTP stub whose member-visibility decision is `apiKey === 'member-key' && toPageId === …` — it asserts the service's mapping and `to_page_id` filter, nothing about RLS; calling it a "contract fixture" is fair, calling it a proof of member-visibility is not. (b) The real test is skipped unless three env vars are present, no workflow sets them, and the run leaves no evidence it ever executed. (c) The real test's two pages are both private, so the pre-`20260814000001` policy (`can_access_page(from) OR can_access_page(to)`) also returns `[]` for the stranger. It cannot fail if the restrictive policy is reverted — the exact leak (`from` private, `to` public → private linking title exposed) is never constructed.
- **Recommended Fix**: set the target page `is_public: true` and still assert the stranger gets `[]` (that is the regression oracle); assert the member row; add a stub case where the `pages` embed is `null`; and record one green run of the real suite (CI job with the disposable project, or an attached run log) on the PR.

#### 🔍 [LOW]: The "unresolved (title-only)" row is unreachable from the real query
- **File**: `components/backlink-pane.tsx:117` · `tests/unit/backlink-pane.test.tsx:61-76`
- **Issue**: `page_links.from_page_id` is `NOT NULL`, so `backlink.from_page_id || null` can never be null. The genuine title-only path in `fetchPageBacklinks` is `row.from_title` when `row.pages` is null — but `from_title` is not in the select and `.filter(row => row.pages || row.from_title)` drops those rows anyway. The component test therefore fabricates `from_page_id: ''`, a shape the service cannot return, and GV-T3's "resolved/unresolved rows" evidence is nominal.
- **Recommended Fix**: define unresolved as "`pages` embed null" (map that to a null `pageId`, stop filtering it out, and keep the RLS-safe title from `to_title`/nothing), or delete the branch and the test and mark unresolved rows out of scope for the backlink pane.

#### 🔍 [LOW]: `bodyByPage` in the effect deps will refetch on every parent render once wired
- **File**: `components/backlink-pane.tsx:130`
- **Issue**: `[pageId, reloadKey, bodyByPage]` is exhaustive-deps-correct, but `editor-workspace` re-renders on every keystroke/awareness tick. Any inline `bodyByPage={{…}}` changes identity → `setStatus('loading')` → a new `fetchPageBacklinks` per render, blanking rows while the user is clicking one. No current caller, so latent.
- **Recommended Fix**: derive a stable key (memoised map in the parent, or a ref updated without re-running the fetch) rather than depending on the object identity.

#### 🔍 [LOW]: Modal drawer plus push-layout leaves 80 px of canvas under the pane
- **File**: `components/editor-workspace.tsx:1326` · `components/backlink-pane.tsx:182`
- **Issue**: The drawer is `md:w-[400px]` but the editor reserves `lg:mr-80` (320 px), and the drawer also paints a full-screen backdrop that dims the pushed canvas — so the reflow is redundant *and* under-sized. Same pattern exists for `VersionDrawer`, so this is consistency-with-legacy rather than a new break, but the net effect at `lg` is 80 px of the "made room for" canvas sitting under the panel.
- **Recommended Fix**: either drop `.lg:mr-80` for this modal drawer (no push needed behind a backdrop) or use `md:w-80` to match the reserved space.

#### 🔍 [LOW]: Mobile entry point cannot restore focus on close
- **File**: `components/mobile-header-menu.tsx:102-114` · `components/backlink-pane.tsx:132-138`
- **Issue**: The "Backlinks" menu item calls `setIsOpen(false)` in the same click that opens the drawer, so the focused element is unmounted and `document.activeElement` at drawer mount is `<body>`. On close, `restoreFocusRef.current` is `<body>` and focus is not returned to the "More options" hamburger — a #79 a11y regression on the only mobile entry point.
- **Recommended Fix**: have `MobileHeaderMenu` own the return (focus the hamburger after the drawer closes), or pass an explicit `returnFocusRef`/element into `BacklinkPane`.

#### 🔍 [LOW]: Desktop trigger's accessible name is "link" between `md` and `lg`
- **File**: `components/editor-workspace.tsx:1083-1084`
- **Issue**: The material-symbol `<span>link</span>` is exposed to AT (no `aria-hidden`) and the `Backlinks` label is `hidden` below `lg`, so the control announces as "link" — and `title="Backlinks"` does not override non-empty content. The new tests use `getByTitle`/`getByRole(dialog)`, so they do not catch it.
- **Recommended Fix**: add `aria-label="Backlinks"` to the button and `aria-hidden="true"` to the icon span (same for the mobile menu item).

#### 🔍 [LOW]: Error/retry state is implemented but untested
- **File**: `components/backlink-pane.tsx:217-228` · `tests/unit/backlink-pane.test.tsx`
- **Issue**: A rejected `fetchPageBacklinks` renders `role="alert"` + "Try again", which bumps `reloadKey`. No test asserts the message, the retry refetch, or that the rejection is surfaced rather than swallowed. The acceptance list does not require it, but this is the only error path in the feature.
- **Recommended Fix**: add one test: `mockRejectedValueOnce`, assert the alert + click "Try again", assert a second `fetchPageBacklinks` call and the ready state.

---

### Verified positively (fresh-context checks)

- **Read-only (Axis 3):** the delta touches only `components/`, `lib/backlinks/`, `tests/unit/`, `.env.example`; no `Y.Doc`, `engine`, `indexedDB`, storage, service or migration change. `services/graph.ts` is byte-identical to `origin/main` — `fetchPageBacklinks` untouched, one source of backlinks.
- **Lazy mount is real:** `next/dynamic(..., { ssr: false })` is only rendered under `isBacklinksOpen`; `tests/unit/editor-workspace-anon.test.tsx:142-155` proves the dialog and the query are absent until the trigger is clicked, then calls `fetchPageBacklinks('page-1')`.
- **States:** labelled `role="status"` skeleton ("Loading backlinks"), exact "No backlinks yet" empty copy, `role="alert"` error with retry, resolved rows route to `/page/<id>` (matches every other page navigation in the repo).
- **a11y basics:** native `<button type="button">` for rows/close/retry; close is `aria-label="Close backlinks"`; `role="dialog"` + `aria-modal` + `aria-labelledby`; Escape handled; the trap recomputes focusables on every keydown, so rows that arrive after mount are included (the "dynamically loaded rows" question is answered: yes, handled); desktop focus capture/restore works.
- **Async hygiene:** `active` flag guards both resolve and reject; reopening remounts the component so no stale rows survive a close; `onNavigate` is memoised on `router`.
- **Anon leakage:** both entry points are under `!anonVisitor` (`editor-workspace.tsx:1076`, `:1110`); `page_links` has no anon policy at all, and `select_page_links` is scoped to `can_access_page(from_page_id)`, so a logged-in viewer of a public page still cannot see titles of private linking pages. No leakage path found.

### Verification run

```
npx vitest run tests/unit/backlink-context.test.ts tests/unit/backlink-pane.test.tsx \
  tests/unit/backlink-supabase-fixture.test.ts tests/unit/editor-workspace-anon.test.tsx
→ 4 files passed, 25 passed | 1 skipped (the gated real-DB test)

npx eslint <changed files>   → clean
npx tsc --noEmit             → clean
npm run build                → fails at page-data collection: "supabaseUrl is required"
                               (missing local env, pre-existing; not caused by this diff)
```

---

## Adjudication (author responses, second pass)

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | MEDIUM | Context centred on the linking page title | **Fixed** — `BacklinkPane` now takes `pageTitle` from the editor and searches for the *viewed* page's title; regression test uses `[[This page]]`. |
| 2 | MEDIUM | Context line has no producer | **Dismissed with reason** — spec lines 63-65: "otherwise page title only (no body scan in v1 — the backlink query stays as is)". v1 rows are title-only by design; `bodyByPage` is the opt-in seam for a future caller and never widens `fetchPageBacklinks`. |
| 3 | MEDIUM | Focus trap leaks when focus lands on `<body>` | **Fixed** — keydown listener moved to `document` capture phase while mounted; Tab from outside the panel goes to first/last, Escape still closes; test blurs to body and asserts. |
| 4 | MEDIUM | Global shortcuts fire behind the modal | **Fixed** — editor shortcut effect gated on `isBacklinksOpen`, plus the capture handler swallows Cmd/Ctrl+K/L/Shift+S while the drawer is mounted; test asserts a bubble listener never runs. |
| 5 | MEDIUM | Real-Supabase proof skipped / stub self-fulfilling | **Partially fixed, remainder dismissed with reason** — the stub now models the current `from_page_id`-only policy (`20260814000001`) and includes the public-target/private-source regression shape; the real test now sets the target `is_public: true` and still asserts the stranger gets `[]`, which fails under the old OR policy. The real test remains opt-in because no disposable project/CI secret exists and mutating the shared project is unsafe; the env contract is documented in `.env.example`. Evidence of a green real run must be attached once a disposable project is configured. |
| 6 | LOW | Unresolved rows unreachable | **Dismissed with reason** — the service filters rows with a null `pages` embed, so unresolved rows are a defensive rendering branch (requested by the acceptance list), not a service shape. The fixture now proves null-embed rows are dropped. |
| 7 | LOW | `bodyByPage` in fetch deps | **Fixed** — rows derive through `useMemo`; the fetch effect depends only on `pageId`/`reloadKey`. |
| 8 | LOW | 320px reserve under a 400px pane | **Fixed** — `lg:mr-[400px]` while the drawer is open. |
| 9 | LOW | Mobile close restores focus to `<body>` | **Fixed** — cleanup falls back to a `[data-backlink-trigger]` element when the captured element unmounted (desktop button + mobile hamburger). |
| 10 | LOW | Trigger announces as "link" at md–lg | **Fixed** — `aria-label="Backlinks"` on the button and `aria-hidden` on the icon ligature. |
| 11 | LOW | Error/retry untested | **Fixed** — test covers rejection → alert → retry → ready. |

