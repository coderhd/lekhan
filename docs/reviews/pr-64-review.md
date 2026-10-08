### 🔍 Clean-Room Review Summary

| Axis | Status | Summary |
|---|---|---|
| 1. Spec & ADRs | PASS | ADR 0006 content path implemented as written: local-first `y-indexeddb` read (`vault-export-source.ts:59-76`), gap-sync via `WebsocketProvider` (`:82-104`), bounded concurrency default 4 (`vault-export-loader.ts:35,67,98`), per-page timeout (`vault-export-source.ts:19,31-45`), conversion through the engine seam `yjsStateToJson` (`engine.ts:255-264`). No server export route added (`git diff 524e3f0..HEAD -- app/api` is empty; no `route.ts` in the delta) and no `fetch(` in any export source (verified by grep). `lib/tier-limits.ts` untouched. Symmetric `FidelityReportCard` reuse with direction-aware copy (`fidelity-report-card.tsx:15-18,91`). |
| 2. Frontend & a11y | FAIL | Dialog uses plain `<button>`/no `AlertDialogCancel` → broken initial focus + misleading Escape dismissal that does not abort the async export (surprise download + stale state on reopen). Export affordance is `hidden md:flex` with no mobile FAB, unlike Import/New (UX-parity #79 gap). Progressbar lacks an accessible name. |
| 3. CRDT & Storage | PASS | `yjsStateToJson` is a correct schema-true inverse of `seedToYjsBase64` (same `getLiveSchema()`, same `default` fragment; round-trip test passes). IndexeddbPersistence/WebsocketProvider teardown in `finally` is correct; `withTimeout` timers are cleared. Concurrency pool has no lost/duplicated pages. Nits: `hasContent` conflates empty-with-unreadable (false warnings) and `readLocalCopy` pollutes IndexedDB for never-opened pages. |
| 4. Backend & Security | PASS | No new server surface, no `fetch`, token obtained from `supabase.auth.getSession()` and passed only as the collab websocket `params.token` (same authz as the live editor). `fetchWorkspacePageTags` chunking (200) is URL-safe and propagates errors (`graph.ts:177-179`); the dialog surfaces them (`vault-export-dialog.tsx:98-101`). Per-page read failures degrade to a surfaced `FidelityWarning`, not a silent drop or permissive fallback. |

---
### Actionable Findings

#### ⚠️ [HIGH]: Escape dismisses the dialog mid-export but the async export keeps running — surprise download + stale state on reopen
- **File**: `components/vault-export-dialog.tsx:55-58`, `:138-150`, `:60-103`
- **Issue**: The `exporting` phase renders no footer and no cancel button (`:138-150`). Because there is no `AlertDialogCancel`, Radix's `DismissableLayer` routes Escape to `onDismiss → onOpenChange(false)` (verified in `@radix-ui/react-dialog/dist/index.js:282`). `handleOpenChange(false)` (`:55-58`) calls `reset()` and closes the dialog but does **not** abort the in-flight `runExport()`. When the export later finishes it runs `downloadBlob(...)` (`:88`) and `setReport(...)/setPhase('done')` (`:90-92`) while the dialog is closed. Failure scenario: a user on a large workspace (many uncached pages, up to 8s timeout each) presses Escape to back out; the dialog vanishes, then a zip downloads unprompted, and the next open (`handleOpenChange(true)`, which does not reset) shows a stale `done` report from the abandoned run. Two overlapping runs also race on the shared `phase`/`report` state.
- **Recommended Fix**:
```diff
+ const runIdRef = useRef(0)
  const runExport = async () => {
    ...
-   setPhase('exporting')
+   const runId = ++runIdRef.current
+   setPhase('exporting')
    ...
    try {
      ...
-     setWarnings(loadWarnings); setReport(exportReport); setPhase('done')
+     if (runId !== runIdRef.current) return
+     setWarnings(loadWarnings); setReport(exportReport); setPhase('done')
    } catch (err) {
+     if (runId !== runIdRef.current) return
      ...
    }
  }
  const handleOpenChange = (next: boolean) => {
    if (!next) {
+     runIdRef.current++       // invalidate any in-flight run
      reset()
    }
    onOpenChange(next)
  }
```
Additionally, either disable Escape dismissal during `exporting` (pass an `onEscapeKeyDown` that ignores it while `phase === 'exporting'`) or provide an explicit Cancel button that aborts.

#### ⚠️ [HIGH]: No `AlertDialogCancel`/`AlertDialogAction` → Radix prevents auto-focus and focuses a null ref, so nothing receives focus when the dialog opens
- **File**: `components/vault-export-dialog.tsx:108-196` (all footer controls are plain `<button>`; `:122-133`, `:162-167`, `:179-190`)
- **Issue**: `AlertDialogContent` (Radix 1.1.18) sets `onOpenAutoFocus` to `event.preventDefault()` then `cancelRef.current?.focus(...)`. With no `AlertDialogCancel` mounted, `cancelRef.current` is `null`, so the `preventDefault()` leaves keyboard focus on the dashboard "Export" trigger behind the modal overlay. Failure scenario: a keyboard/screen-reader user opens the dialog and focus never enters the `alertdialog`; Tab navigation starts behind the overlay, breaking the modal interaction and focus management (WCAG 2.4.3 / 1.3.1).
- **Recommended Fix**:
```diff
+ import { AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog'
  ...
- <button onClick={() => handleOpenChange(false)} ...>Cancel</button>
+ <AlertDialogCancel onClick={() => handleOpenChange(false)} ...>Cancel</AlertDialogCancel>
- <button onClick={runExport} ...>Export vault</button>
+ <AlertDialogAction onClick={runExport} ...>Export vault</AlertDialogAction>
```
(or pass an explicit `onOpenAutoFocus`/`onOpenChange` that focuses the primary action when no cancel exists). Repeat for the `done`/`error` footers.

#### ⚠️ [HIGH]: Export is unreachable on mobile — no parity with Import/New (#79 UX-parity)
- **File**: `components/dashboard.tsx:478` (trigger) vs `:665` and `:668` (mobile FABs)
- **Issue**: The Export trigger is `hidden md:flex` and has no mobile equivalent, while Import (`:665`) and New (`:668`) each have a `md:hidden` floating action button. Failure scenario: on a viewport below `md` a user has Import and New but no way to trigger "Export to Obsidian vault", so acceptance criterion 1 ("From the dashboard, an Export action…") and the #79 UX-parity scope fail on mobile.
- **Recommended Fix**:
```diff
+ <button onClick={() => setVaultExportOpen(true)} className="md:hidden fixed bottom-40 right-8 z-[100] w-14 h-14 bg-surface-container text-on-surface rounded-full shadow-2xl border border-black/10 dark:border-white/10 flex items-center justify-center active:scale-90 premium-transition" title="Export to Obsidian vault">
+   <span className="material-symbols-outlined text-3xl">download</span>
+ </button>
```

#### 💡 [MEDIUM]: `hasContent` conflates "empty page" with "unreadable page" → false "content could not be read" warnings for never-edited pages
- **File**: `lib/markdown/vault-export-source.ts:47-49` (`hasContent`), `lib/markdown/vault-export-loader.ts:83-84`
- **Issue**: A page created via "New" (`services/graph.ts:39` inserts no `contentYjsBase64`; `hydrateOnOpen` no-ops on empty `initialContent`, `lib/import-hydration.ts:14`) has an empty `default` `Y.XmlFragment`. `hasContent` returns `false` for it, so `readLocalCopy` → `null`, `readRemoteCopy` (empty room) → `null`, and the loader emits `{ stage: 'content', error: 'page content was not available' }`. Failure scenario: a user who scaffolds structure (creates pages, leaves them blank) sees every blank page listed under "N pages need attention: content could not be read", which is false — there is nothing to read. This is common and erodes the "honest report" trust the feature is built around. (Imported pages are unaffected: `services/obsidian-import.ts:436` seeds `EMPTY_PAGE_DOC`, a non-empty heading.)
- **Recommended Fix**: Distinguish "successfully read but empty" from "read failed". e.g. have the source return a tri-state (`{ doc } | { empty: true } | null`) and only warn on `null` (timeout/error), exporting the empty case as a title-only note with no warning:
```diff
  async function readLocalCopy(pageId, timeoutMs) {
    ...
-   return hasContent(doc) ? toJson(doc) : null
+   return hasContent(doc) ? toJson(doc) : EMPTY
  }
```
(and treat `EMPTY` as "no warning" in `loadVaultPageDocs`).

#### 💡 [MEDIUM]: Progressbar has no accessible name
- **File**: `components/vault-export-dialog.tsx:146`
- **Issue**: The `<div role="progressbar" aria-valuenow aria-valuemin aria-valuemax>` has no `aria-label`/`aria-labelledby`. Failure scenario: screen readers announce "progress bar, 42 percent" with no context (which process?). The surrounding description (`:143`) is not programmatically associated with the bar.
- **Recommended Fix**:
```diff
- <div className="w-full h-2 ..." role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
+ <div className="w-full h-2 ..." role="progressbar" aria-label="Export progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
```

#### 🔍 [LOW]: `readLocalCopy` writes an empty `y-indexeddb` DB for every never-opened page
- **File**: `lib/markdown/vault-export-source.ts:59-75`
- **Issue**: `y-indexeddb`'s `fetchUpdates` runs a `beforeApplyUpdatesCallback` that `addAutoKey`s `Y.encodeStateAsUpdate(doc)` (the fresh, empty doc) before applying any stored updates (confirmed in `node_modules/y-indexeddb/src/y-indexeddb.js`). So a page that has never been opened on this device gets an IndexedDB database created and an empty update row persisted, purely as a side effect of the local-first read, and the DB is never deleted (`destroy()` only closes it). Failure scenario: exporting a 1,000-page workspace creates ~1,000 empty IndexedDB databases that linger and inflate browser storage quota.
- **Recommended Fix**: Peek before persisting, or avoid the write path — e.g. use `IndexeddbPersistence.get`/a read-only lookup first, or `clearData()` after a read that found no content:
```diff
  } finally {
    persistence.destroy()
+   if (!hadContent) persistence.clearData().catch(() => {})
    doc.destroy()
  }
```

#### 🔍 [LOW]: Progress `total` briefly counts folder pages before the loader corrects it
- **File**: `components/vault-export-dialog.tsx:66` vs `lib/markdown/vault-export-loader.ts:68-69`
- **Issue**: The dialog seeds `setProgress({ done: 0, total: pages.length })` (all pages, folders included), but `loadVaultPageDocs` reports `total = targets.length` (non-folder only). Failure scenario: during the tag fetch and before the first `onProgress`, the "Reading page content (0/N)" line shows the wrong denominator; with all-folder workspaces the bar is stuck at 0%. Cosmetic, no data impact.
- **Recommended Fix**: Compute the non-folder count once and use it for the initial total, or drop the initial `total: pages.length` and let the loader own the total.

---
**Non-blocking observations (not findings):** `services/graph.fetchWorkspacePageTags` is a Supabase metadata read (tags), not a server export route — consistent with the dashboard's existing metadata path and ADR 0006's "no export endpoint" invariant. `lib/markdown/vault-export-loader.ts` worker pool is race-free under JS's single-threaded event loop (synchronous `cursor`/`done` increments between `await`s), verified by the concurrency test. `event-instrumentation.test.tsx` correctly asserts `omissions: 0` for the import direction since `fromImportReport` supplies `omissions: []`.

---
**Reviewed range**: `524e3f0..HEAD` (`feat/64-vault-export-ui` @ `1b0ff62`, SIL-64 delta). Review performed independently by a clean-room reviewer (not the author), with verification commands: `git diff 524e3f0..HEAD`, `grep` for `fetch(` (none in export source), `git diff -- app/api` (empty), and `npx vitest run tests/unit/vault-export-loader.test.ts tests/unit/vault-export.test.ts tests/unit/fidelity-report.test.ts tests/unit/event-instrumentation.test.tsx` → **4 files / 34 tests passed**.

**VERDICT: CHANGES REQUIRED**

---

## Resolution (Dev, same branch)

All three HIGH findings and both MEDIUM/LOW items were fixed; the one remaining LOW is resolved by construction.

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | ⚠️ HIGH | Escape mid-export left the run alive → surprise download + stale report | `runIdRef` monotonic guard: `handleOpenChange(false)` invalidates the run, and `runExport` no longer downloads or writes state once superseded; Escape is blocked while `phase === 'exporting'` and an explicit Cancel is offered (`components/vault-export-dialog.tsx:48-70,102-120,128-135,164-181`). |
| 2 | ⚠️ HIGH | No `AlertDialogCancel` → Radix auto-focus targeted a null ref | The confirm/exporting phases now use `AlertDialogCancel`, registering `cancelRef` so focus enters the `alertdialog` on open. Non-closing primary actions stay plain `<button>` because `AlertDialogAction` is a `Dialog.Close` and would dismiss mid-flow (`components/vault-export-dialog.tsx:148-159`). |
| 3 | ⚠️ HIGH | Export unreachable on mobile (#79 UX-parity) | Added a `md:hidden` export FAB stacked above Import/New (`components/dashboard.tsx`, `bottom-40`). |
| 4 | 💡 MEDIUM | `hasContent` conflated empty with unreadable → false "content could not be read" | `readRemoteCopy` now returns the Page's (empty) doc on a successful sync and `null` only on timeout/error, so a never-edited Page serializes as a title-only note with no warning (`lib/markdown/vault-export-source.ts`). Covered by a new engine test (`yjsStateToJson` on an empty Yjs state → `{ type: 'doc', content: [] }`). |
| 5 | 💡 MEDIUM | Progressbar had no accessible name | Added `aria-label="Export progress"` (`components/vault-export-dialog.tsx:172`). |
| 6 | 🔍 LOW | Empty `y-indexeddb` DB created for every never-opened Page | `hasLocalDatabase(pageId)` peeks via `indexedDB.databases()` before constructing `IndexeddbPersistence` (falls back to prior behavior when unsupported), so a bulk export no longer persists ~N empty databases (`lib/markdown/vault-export-source.ts`). |
| 7 | 🔍 LOW | Progress `total` seeded with folder pages | Initial total now uses `exportableCount` (non-folder notes), matching the loader's own total (`components/vault-export-dialog.tsx:52,79`). |

Re-verified after the fixes: `npm run typecheck` ✅ · `npm run lint` ✅ · `npm test` **81 files / 605 tests** ✅ · `npm run build` ✅.

---

## Addendum — external review (Pullfrog) findings on PR #133

Pullfrog re-reviewed `ba374ae` and requested two changes before merge. Both are fixed on this branch.

| # | Severity | Finding | Fix |
|---|---|---|---|
| A | ⚠️ HIGH | The visible Cancel invalidated `runId` but only *after* `loadVaultPageDocs` read every note — active and queued IndexedDB/WebSocket reads kept running, and cancelling during tag fetch could still start all reads. | Added a per-run `AbortController`. `handleOpenChange(false)` (and starting a new run) aborts it; `loadVaultPageDocs` now takes `signal`, stops scheduling, suppresses late warnings/progress, and `createClientPageDocSource` closes the in-flight `IndexeddbPersistence`/`WebsocketProvider` on abort (`vault-export-dialog.tsx:48-108`, `vault-export-loader.ts:20-46,75-101`, `vault-export-source.ts:31-66,150-215`). |
| B | ⚠️ HIGH | `hasLocalDatabase` returned `true` when `indexedDB.databases()` was unavailable, so every uncached Page still created an empty database; Firefox 111–125 is inside Next.js's default range and predates the API. | Added `probeExisted`: it opens the database once, reads `upgradeneeded`'s `oldVersion === 0` to detect that the open itself created it, and immediately `deleteDatabase`s the empty database it made — reporting "absent". Local reads are still used where a cache exists and no empty database is left behind (`vault-export-source.ts:75-155`). |

New coverage: `tests/unit/vault-export-source.test.ts` (enumeration present/absent, probe create-then-delete, cancellation of local and remote reads) and two abort cases in `tests/unit/vault-export-loader.test.ts`.

Re-verified after the external-review fixes: `npm run typecheck` ✅ · `npm run lint` ✅ · `npm test` **82 files / 613 tests** ✅ · `npm run build` ✅.

---

## Addendum 2 — Pullfrog re-review of the fix itself (`bf815e3`) → non-destructive fallback

Pullfrog's re-review of `bf815e3` (2026-10-08T07:05:55Z, [pullrequestreview-5452928149](https://github.com/coderhd/lekhan/pull/133#pullrequestreview-5452928149)), independently confirmed by the Tech Lead at the gate, flagged that the `probeExisted` fallback was itself destructive. Fixed on this branch.

| # | Severity | Finding | Fix |
|---|---|---|---|
| C | ⚠️ HIGH | `probeExisted` deleted the database it opened for create-detection: if another tab opened the just-created Page database between `request.result.close()` and `factory.deleteDatabase(pageId)`, the pending delete either (a) wiped a cache that session subsequently populated, or (b) fired `versionchange` into an active editor session and halted its persistence. It ran for **every Page** in a bulk export on browsers without `indexedDB.databases()` (Firefox 111–125). | Removed `probeExisted` entirely. When `indexedDB.databases()` is unavailable — or the enumeration call throws — `hasLocalDatabase` now returns `false` and never opens or deletes a database. The remote batch-sync path already covers correctness; the fallback only costs export speed on legacy browsers (`lib/markdown/vault-export-source.ts:79-112`). |

Contract locked in by `tests/unit/vault-export-source.test.ts`:
- Modern browsers keep enumeration-first behavior (`databases()` present → `true`/`false` from the enumeration).
- Enumeration absent or throwing → resolves `false`, and **never** calls `open` or `deleteDatabase` (asserted with spies on both).
- A present-but-unenumerable database is still reported absent and is **not** deleted.

Re-verified after the non-destructive fix: `npm run typecheck` ✅ · `npm run lint` ✅ · `npm test` **82 files / 614 tests** ✅ · `npm run build` ✅.
