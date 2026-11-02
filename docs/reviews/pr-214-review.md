# Clean-Room Review — SIL-214 vault-export hotfix

**Branch:** `fix/214-vault-export-cold-export` · **Base:** `origin/main` · **Reviewer:** independent Clean-Room subagent (fresh context) · **Date:** 2026-11-02

## Summary

| Axis | Verdict | Notes |
|---|---|---|
| 1. Spec & ADRs | FAIL → fixed | AC1/AC2 verified; AC3 was inert because `origin/main`'s persister never populated `searchable_text` for `XmlFragment` pages. Fixed by porting the existing `extractDocumentText` work from the unmerged `feat/205` line + regression tests. |
| 2. Frontend & a11y | PASS | Semantic buttons/ARIA untouched; warnings merged into one report; honest header copy; no new effects without cleanup. |
| 3. CRDT & Storage | FAIL → fixed | Hydration gate and `writeState` gating verified. Fixed `markWritable` running before the dead-socket guard, gated the debounced-save listener, and removed failed rooms from `docs` so retries re-download. |
| 4. Backend & Security | PASS (caveats) → fixed | Read-only frame rule extracted and unit-tested; env parsing clamped; heap metric meaning preserved (`heapUtilizationPct`) with a new `heapLimitUtilizationPct`; persist failures now reported to the shutdown flush. |

## Actionable findings and disposition

1. **HIGH — `searchable_text` evidence never populated (AC3 inert).**
   `server/persister.js` called `ydoc.getText('default')` on the live editor's
   `XmlFragment`, which throws after the snapshot upload. **Fixed** by porting
   `extractDocumentText` (try Y.Text, fall back to walking the fragment) and
   adding TC06/TC07 to `tests/unit/sync-persister.test.ts`. `searchable_text`
   is now real evidence for editor-authored pages.
2. **HIGH — cold-room test was not timing-sensitive.**
   The in-memory `loadState` resolved in a microtask, so the pre-fix ordering
   could still pass. **Fixed**: the harness now adds a deterministic 120 ms
   storage delay, so a missing upgrade-path gate yields an empty sync and fails
   the B1 assertion. The production read-only frame rule is now extracted to
   `server/connection-guard.js` and unit-tested.
3. **MEDIUM — `markWritable` before the dead-socket guard.**
   A dead upgrade could mark a room persistable. **Fixed**: `markWritable` now
   runs only inside the `handleUpgrade` callback, i.e. on an established
   non-read-only connection.
4. **MEDIUM — load shedding could miss container OOM / metric meaning changed.**
   **Fixed**: `heapUtilizationPct` keeps its historical `heapUsed/heapTotal`
   meaning; `heapLimitUtilizationPct` is the new pressure metric. Added a
   minimum absolute heap (`SYNC_HEAP_SHED_MIN_MB`, default 128) and optional
   container RSS budget (`SYNC_MEMORY_LIMIT_MB`). Both env values are
   `Number.isFinite`-validated and clamped.
5. **LOW — debounced saves bypassed the gate.**
   **Fixed**: the update listener is only attached after successful hydration
   and re-checks `__hydration` before scheduling.
6. **LOW — `writeState` swallowed errors, so shutdown's failure summary was dead.**
   **Fixed**: `writeState` returns `{ ok, skipped?, error? }`; `gracefulShutdown`
   counts real failures while still letting y-websocket destroy the room.
7. **LOW — failed hydration wedged a room for up to 60 s.**
   **Fixed**: `openHydratedDoc` deletes the failed room from `docs` and destroys
   it, so a retry performs a fresh download.
8. **LOW — NaN env parsing.**
   **Fixed** with `positiveNumber` / `nonNegativeNumber` helpers.
9. **LOW — roadmap / ADR wording.**
   **Fixed**: roadmap row added; ADR 0006 amendment now scopes the no-save
   guarantee to "a room that never admitted a writable connection".

## Verification evidence

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm test` — 106 files / 948 tests passed, no unhandled errors.
  The network-dependent snapshot-debounce suite now injects a fake persister
  through an explicit test seam instead of fetching a placeholder Supabase host.
- `npm run build` — clean.
- New regression tests:
  - `tests/unit/sync-collab-persistence.test.ts` — hydration-gating matrix.
  - `tests/unit/vault-export-cold-room.test.ts` — cold server, delayed storage,
    read-only export returns real bodies and leaves stored bytes unchanged;
    writable rooms still persist; un-hydratable rooms are refused.
  - `tests/unit/sync-connection-guard.test.ts` — read-only/viewer frame rule.
  - `tests/unit/sync-persister.test.ts` TC06/TC07 — XmlFragment indexing.
