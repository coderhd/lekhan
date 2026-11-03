# Code Review — PR #200: truthful sync indicator (SIL-229)

**Reviewer:** Clean-Room Reviewer (independent, fresh context — did not author this change)
**Commit under review:** `53e74c1` (`feat/sil-229-sync-indicator-truthfulness`), base `origin/main`
**Date:** 2026-11-03

## Verdict: **CHANGES REQUIRED**

No blockers. Two majors (one truthfulness, one accessibility contrast), five minors, six nits.
The component logic itself is correct and matches the spec's precedence table exactly; the two
majors are about the *inputs* the chip trusts and the *rendered* contrast of the new state.

> Environmental note: the shared working tree was switched to `docs/sil-224-brevo-templates` by a
> concurrent process at ~14:57 while this review was in progress. All findings below were verified
> against the immutable commit in a detached worktree at `53e74c1` (`git worktree add --detach`),
> not against the moving working tree.

---

## Acceptance criteria

| AC | Status | Evidence |
| --- | --- | --- |
| 1. Offline + pending edits → **Local edits only** | **PASS with caveat** | `sync-indicator.tsx:87-91`; test `sync-indicator.test.tsx:11-23`. Caveat: the hook's `hasUnsyncedChanges` cannot see edits persisted by a previous session — see **MAJOR-1(b)**. |
| 2. Connecting + pending edits → **Local edits only** | PASS | `sync-indicator.tsx:87-89`; test `:25-34` |
| 3. Connecting without edits → **Connecting to hub...** | PASS | `sync-indicator.tsx:91`; test `:36-43` |
| 4. Connected-but-not-synced → **Saving...** (even with dirty flag) | PASS | `sync-indicator.tsx:83-85`; test `:50-62` |
| 5. Synced → **Synced**; offline without edits → **Offline** | PASS | `sync-indicator.tsx:83-84`, `:63-68`; tests `:6-9`, `:64-67` |
| 6. Both call sites pass `hasUnsyncedChanges` | PASS (untested — **MINOR-4**) | `editor-workspace.tsx:1322-1326`, `:1424-1427`; `mobile-header-menu.tsx:80-84` |
| 7. `role="status"` + cold-start/durability `title` | PASS on letter of spec; AT exposure weak — **MINOR-2** | `sync-indicator.tsx:103-108` |
| 8. Tests cover precedence; typecheck/lint/test/build pass | PASS (test gaps **MINOR-4/5**) | 9 focused tests; author-reported typecheck/lint/build clean; full-suite billing failures pre-existing |

`resolveState` (`sync-indicator.tsx:78-92`) reproduces the spec table exactly, including the
deliberate "connected wins over hasUnsyncedChanges" rule. No precedence bug found in the component.

---

## Axis 1 — Spec & acceptance criteria

### MAJOR-1 — `hasUnsyncedChanges` is not a reliable "pending edits" signal; the new chip can lie in both directions

The component is correct; the flag it consumes is not. `hasUnsyncedChanges` is
`isDirty && (!isConnected || !isSynced)` (`hooks/use-editor-collab.ts:212`), and `isDirty` is only
set on local doc updates (`:178-183`) and cleared **only** inside the websocket `sync` handler
(`:155-160`).

(a) **False "Local edits only" after ordinary edits (common flow, new user-visible lie).**
`y-websocket` sets `provider.synced = true` once per connection
(`node_modules/y-websocket/src/y-websocket.js:39-46`) and emits `sync` only when that boolean
*changes* (`:416-421`). Local updates are written to the socket immediately (`:353-360`), but no
event clears `isDirty`. Therefore, after the first edit of a session, `isDirty` stays `true` until
the next reconnect. Any later blip (laptop sleep, Wi-Fi flap, hub cold start) flips
`connectionState` to `connecting` with `isConnected === false`, and the chip immediately claims
**"Local edits only"** with the title *"These edits are kept on this device and will sync when the
hub reconnects"* — even though the edit was already delivered. Reproduction: connect → wait for
"Synced" → type one character → drop the websocket → chip shows the durability claim for the whole
grace window even though nothing is pending.

(b) **False negative after reload (AC1 gap).** `isDirty` is React state, so it resets on reload.
Pending edits persisted in IndexedDB are replayed with `origin === indexeddbProvider` and are
explicitly filtered out of the dirty check (`use-editor-collab.ts:180`), so a reload while offline
with genuinely pending local edits shows **"Offline"**, not "Local edits only". This is exactly the
situation AC1 is meant to cover; the chip also never asserts durability when it would be true.

**Fix (small, in-scope-adjacent):** clear `isDirty` once a local update is flushed on a live
connection, e.g. in the `doc.on('update')` handler schedule `setIsDirty(false)` on the next tick
when `wsProvider.wsconnected && wsProvider.synced` (the send is synchronous); and persist a
per-document "pending" marker (localStorage/IndexedDB) that survives reload and is cleared on
`sync === true`. If the team prefers to defer the hook work (spec non-goal), that must be an
explicit follow-up issue **and** (a) still needs fixing or softening, because the new state's
headline claim is false in a routine flow.

### MINOR-1 — "Offline" title asserts the user is offline when only the hub is unreachable

`connectionState === 'offline'` has two sources in the hook: browser `navigator.onLine === false`
(`use-editor-collab.ts:67-74`) **and** the 60 s grace period expiring while the browser is online
(`:83-100`). The new tooltip *"You are offline. Changes cannot reach the hub right now."*
(`sync-indicator.tsx:65`) is therefore false in the hub-down case — the exact "known state told
honestly" problem the ticket targets. Suggest *"Can't reach the hub right now."* or plumb
`navigator.onLine`/`isOffline` distinction. (The visible label "Offline" is spec-mandated; this is
about the newly authored tooltip.)

### NIT-1 — "Saving..." tooltip describes the wrong direction during the initial handshake

`isSynced === false` while connected is also the initial-download handshake. *"Sending your latest
edits to the hub"* (`sync-indicator.tsx:43`) is wrong when the client is receiving, and when the
user has not typed. Suggest *"Syncing with the hub..."*.

### NIT-2 — "Synced" tooltip overstates `isSynced`

`isSynced` is the y-websocket handshake flag, not an acknowledgement of the most recent keystroke.
*"All changes are synced with the hub."* (`:37`) can be momentarily untrue while typing. Acceptable
for a status chip, but worth a wording pass (*"Connected to the hub."*).

### NIT-3 — Doc-switch remount staleness is safe today, by luck of an external key

The hook cleanup (`use-editor-collab.ts:196-201`) resets `ydoc`, `provider`, `isConnected`,
`isSynced`, `isLocalSynced`, and `connectionState`, but **not** `isDirty`. If `documentId` changed
without a remount, the new document would render "Local edits only" from the previous document's
dirty flag. Today that is prevented only by `key={params.id}` at `app/page/[id]/page.tsx:118`.
No defect in this PR; but the hook's contract is fragile, and resetting `isDirty` in cleanup is one
line. Also worth adding `isDirty` to the cleanup dependencies story so a future refactor that drops
the `key` cannot resurrect the bug.

---

## Axis 2 — Frontend & accessibility

### MAJOR-2 — Light-mode chip text fails WCAG AA (1.4.3); the new headline state has the worst ratio

Chip text is `text-xs` (12 px) `font-semibold` → 4.5:1 required. Measured against the actual
surfaces (header `bg-surface-container/80` over cream `#f9f8f4`, mobile menu
`bg-surface-container-high`, chip tint composited over that):

| State | Light ratio | Result | Dark ratio | Result |
| --- | --- | --- | --- | --- |
| Local edits only / Saving (`text-amber-600` on `bg-amber-500/10`) | **2.79:1** | **FAIL** | 6.21:1 | pass |
| Offline (`text-red-600` on `bg-red-500/10`) | **4.00:1** | **FAIL** | 5.39:1 | pass |
| Synced (`text-emerald-600` on `bg-emerald-500/10`) | **3.25:1** | **FAIL** | 6.96:1 | pass |
| Connecting (`text-slate-600` on `bg-slate-500/10`) | 6.34:1 | pass | 10.78:1 | pass |

Locations: `components/sync-indicator.tsx:39` (emerald), `:46` (amber), `:52` (amber — new state),
`:61` (slate), `:67` (red).

The emerald/amber/red classes are inherited from the pre-change component, but this PR makes
"Local edits only" a primary, frequently-seen state using the lowest-contrast pair, and it adds a
new tooltip-heavy interaction on top. A colour-token tweak is not a "design-system overhaul" and is
a one-line change per chip: light-mode `text-amber-800` (6.22:1) or `text-amber-700` (4.40:1 —
still short), `text-emerald-700` (4.73:1), `text-red-700` (5.36:1); keep the current `dark:` tokens,
which pass.

### MINOR-2 — The cold-start and durability explanations are `title`-only; that meaning is not reliably exposed

`title` (`sync-indicator.tsx:106`) renders a hover tooltip. On a non-focusable `<div>` it is
unreachable by keyboard and inconsistently exposed to screen readers; the `aria-live` region
announces only the short label. So the two facts AC7 exists to deliver ("the hub can take up to a
minute", "edits are kept on this device") are invisible to exactly the users who rely on AT.
This matches the letter of the spec but not its intent. Suggested fix: keep `title` for mouse users
and add a visually hidden description inside the status region, e.g.
`<span className="sr-only">{description}</span>`, or bind an `aria-describedby` to a hidden node.
(Note: `aria-describedby` on a non-focusable node is also weakly supported; the `sr-only` span is
the reliable option.)

### NIT-4 — Decorative icons are not `aria-hidden`

`lucide-react@0.400` emits SVG with no `role`/`aria-hidden` (verified in
`node_modules/lucide-react/dist/esm/defaultAttributes.js`). Inside a live region, some screen
readers announce the graphic on every state change ("graphic Synced"). Add `aria-hidden='true'` to
`<Icon>` at `sync-indicator.tsx:109`.

### NIT-5 — `role="status"` already implies `aria-live="polite"`

`sync-indicator.tsx:104-105` sets both. Harmless, spec-mandated; no change required.

### Verified good (frontend)

- **No duplicate announcements:** the desktop chip is inside `hidden md:flex`
  (`editor-workspace.tsx:1320`) and the mobile chip is inside a `md:hidden` menu that only mounts
  when open (`mobile-header-menu.tsx:65`, `:75`), so only one status region is in the a11y tree at a
  time. No chatty toggle: `isSynced` does not flip per keystroke, so "Saving..."/"Synced" do not
  cycle while typing.
- **React rules:** `APPEARANCE` is a module-level `Record` (`sync-indicator.tsx:34`), no inline
  component definitions, no list keys needed, no `useEffect` in the component. `ICON` is rendered
  via a stable reference.
- **SSR/hydration:** `'use client'`, no `window`/`Date`/random; initial `connectionState` is
  `'connecting'` on both server and client → deterministic first paint.
- **State is derived synchronously** from props (no timer mirroring props), so no stale-render
  window.

---

## Axis 3 — CRDT & storage truthfulness

### MINOR-3 — "kept on this device" is unconditional, but local persistence is not guaranteed

`y-indexeddb` only writes updates once `this.db` has opened; if the IndexedDB open fails (quota,
restricted private mode, corrupted DB), `_storeUpdate` silently no-ops
(`node_modules/y-indexeddb/src/y-indexeddb.js:104-124`). The hook already exposes exactly the
signal needed — `isLocalSynced` (`use-editor-collab.ts:33`, set at `:130-132`, returned at `:214`)
— but the indicator does not accept or consume it, so the chip promises durability even when there
is none. Suggest an optional `isLocalSynced` prop: only assert "kept on this device" once local
persistence has synced; otherwise fall back to *"Changes stay in this tab until the hub
reconnects."* This is the one concrete over-promise found.

### Verified good / non-findings

- **Edits made before IndexedDB finishes opening are not lost:** `fetchUpdates` writes an
  `encodeStateAsUpdate(doc)` snapshot as soon as the DB opens
  (`y-indexeddb.js:78-99`), so the pre-open window is captured.
- **Cross-tab:** `y-websocket` BroadcastChannel updates are applied with `origin === provider` and
  are correctly excluded from `isDirty` (`use-editor-collab.ts:180`); this tab will not claim
  another tab's edits. Consequence: if *only* another tab has pending edits, this tab shows
  "Offline"/"Connecting" — acceptable, and not a claim this PR makes.
- **Multiple tabs / provider destruction:** remount destroys the doc/provider; the hook's state is
  recreated. The `isDirty` cleanup gap is covered in NIT-3.
- "will sync when the hub reconnects" holds for durability across reloads while site data survives;
  it is an assurance, not a guarantee (cleared storage, different device). Standard product copy;
  no change requested.

---

## Axis 4 — Backend security & errors

**No findings.** The diff touches only three presentational files plus a test and two docs. There
are no API routes, auth checks, DB queries, or error-propagation paths in the delta. The new strings
contain no user data, IDs, tokens, or page content — only fixed status copy and a `title`. Nothing
leaks state beyond what the old chip already showed. No server-side regression is possible from
this diff.

---

## Test quality

### MINOR-4 — AC6 prop plumbing is untested and silently masked by optional defaults

Both `hasUnsyncedChanges` props are optional with `= false`
(`sync-indicator.tsx:97`, `mobile-header-menu.tsx:47`). If a future refactor drops the forwarding at
`mobile-header-menu.tsx:83` or `editor-workspace.tsx:1325`, the chip silently falls back to
"Offline" and every test still passes. Add a `MobileHeaderMenu` render test (open the menu, assert
the forwarded value reaches the indicator) and/or an `editor-workspace` assertion that the mocked
hook value reaches both call sites.

### MINOR-5 — The "no spinner where the state is known" invariant is not pinned

`tests/unit/sync-indicator.test.tsx:25-34` asserts the label but not the absence of
`animate-spin`. Swapping the `HardDrive` icon for `Loader2 + animate-spin` on `local-edits-only`
would pass the suite while violating the ticket's headline rule. Add
`expect(container.querySelector('.animate-spin')).toBeNull()` for the local-edits-only cases (and
optionally assert the connecting state *does* spin).

### Verified good

- The tests are **not tautological**: they assert exact visible labels per branch and include
  negative assertions (`queryByText('Offline')` at `:22`, `queryByText('Local edits only')` at
  `:61`), so a precedence regression (`offline`/`connecting` winning over `hasUnsyncedChanges`, or
  `saving` losing to `local-edits-only`) fails immediately.
- All six precedence rows are covered; `role`/`aria-live` and both `title` explanations have
  assertions.
- Focused run re-executed on the reviewed tree: **9/9 pass**.

---

## Hygiene

- `implementation_plan.md` is **untouched** (`git diff origin/main...HEAD -- implementation_plan.md`
  is empty).
- File scope is exactly the intended six files: `components/sync-indicator.tsx`,
  `components/mobile-header-menu.tsx`, `components/editor-workspace.tsx`,
  `tests/unit/sync-indicator.test.tsx`, plus the SIL-229 spec and plan (expected artifacts under
  `docs/superpowers/`). No unrelated files in the diff.
- `git diff --check origin/main...HEAD` is clean (no whitespace errors).
- Copy vocabulary follows `CONTEXT.md` ("hub", "this device"; no "server"/"cloud") in the new
  strings. Pre-existing `beforeunload` copy at `editor-workspace.tsx:501` still says "synced with
  the server" — outside this diff, optional cleanup for consistency (NIT-6).

---

## What would move this to PASS

1. **MAJOR-1:** fix the `isDirty` lifecycle (clear on live flush; persist pending across reload) or
   explicitly accept + file the follow-up and soften the "these edits" claim so it cannot assert
   pending edits that do not exist.
2. **MAJOR-2:** darken the light-mode text tokens for amber/emerald/red (keep `dark:` variants).
3. Minors as capacity allows — MINOR-1 (offline tooltip), MINOR-2 (sr-only explanation), MINOR-3
   (gate durability on `isLocalSynced`), MINOR-4/5 (tests). None of the minors are merge-blocking
   on their own.
