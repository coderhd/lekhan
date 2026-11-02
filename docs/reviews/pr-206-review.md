# Clean-room review — PR for SIL-206 / GV-T1 (graph route + d3-force canvas)

**Branch:** `feat/206-gv-t1-graph-canvas` (base `origin/main` @ `e15b9a8`)
**Reviewer:** independent clean-room subagent (fresh context), auditing `git diff origin/main...HEAD`
**Verdict on first pass:** REVISE (2 should-fix, 2 should-fix-minor, 5 noticings)
**Verdict after fixes:** APPROVE — all should-fix findings resolved; noticings deferred or explicitly closed.

## Findings and disposition

1. **Wall-clock layout was non-deterministic (should-fix).**
   `lib/graph-view/layout.ts` stopped ticking when a time budget was spent, so the same
   input produced 96–120 iterations across runs and production often rendered a
   truncated simulation. It also contradicted the "pure/deterministic" doc.
   **Fixed:** the default path is now a deterministic iteration count only
   (`defaultIterations`: 300/220/140 by size); no `performance.now()` in the layout.
   The determinism test now runs at the default tick count and asserts both
   `iterations === 300` and identical coordinates across runs.

2. **Perf assertion was not honest (should-fix).**
   The budget-based layout made `elapsed < 1000` almost unfailable, and the test timed
   only serialization + layout while claiming "first paint".
   **Fixed:** the perf test moved to `tests/perf/graph-view.perf.test.ts`, runs in its
   own config (`npm run test:perf`) so the parallel unit suite cannot distort the clock,
   pins the full 140-tick layout, asserts `iterations === defaultIterations(520)` (no
   silent truncation) and `elapsed < 1000`. Scope is documented honestly: serialization +
   pure layout, excluding React mount/canvas paint. Result in CI-equivalent isolation:
   pass (test duration 656 ms including vitest overhead).

3. **Node navigation was pointer-only (should-fix, a11y).**
   Canvas is `role="img"` and unfocusable, so keyboard/AT users could not open any page.
   **Fixed:** `components/graph-view.tsx` now renders a focus-revealed "Pages in this
   graph" list (`sr-only focus-within:not-sr-only`) of real `/page/<id>` links, plus a
   non-link "Unresolved: …" summary. New test asserts the links, hrefs, that ghost nodes
   are not links, and the unresolved text. Canvas summary copy updated.

4. **Resize wiped pan/zoom (should-fix-minor).**
   **Fixed:** the camera is fitted only when the layout/data changes or on first
   measurement; plain viewport resizes keep the user's camera. `Reset view` still
   re-fits.

5. **Long edges culled when both endpoints are off-screen (noticing).**
   **Fixed:** replaced the endpoint-visibility check with `segmentOutside`, which culls
   only when both endpoints are outside the same viewport edge, so crossing edges stay
   visible.

6. **No pointer-cancel handling (noticing).**
   **Fixed:** `onPointerCancel` / `onLostPointerCapture` reset `dragRef` and the cursor so
   an interrupted touch cannot leave the surface in panning state.

7. **No cap/sampling for very large workspaces (noticing).**
   **Deferred to GV-T2 by design.** The spec assigns "degrade by sampling, not by hiding
   edges silently (show a 'showing N of M links' badge)" to GV-T2. GV-T1's bar is the
   500-page/2,000-link corpus, which is met. Tracked in the PR body as the T2 entry
   point; not a merge blocker for this slice.

8. **Header link count could imply more links than rendered (noticing).**
   **Fixed:** `GraphPage` now shows `N of M links shown` when the serializer drops rows
   (self/blank/foreign links), otherwise the plain count.

9. **`/graph` is a server shell + client auth boundary, not a server-side fetch
   (noticing).**
   **Accepted with rationale:** the repo has no `@supabase/ssr`/cookie client anywhere;
   every authed route (including `/page/[id]`) resolves the localStorage session in the
   browser and relies on RLS for reads. A true server fetch would require a new auth
   mechanism and cookie surface — out of scope and a security regression risk. The route
   guard redirects before rendering any workspace content; the static shell only shows
   chrome. Documented in `app/graph/page.tsx`.

## External review (PR #184)

- **Pullfrog — pass, one minor inline suggestion:** canvas zoom/reset controls were
  `h-9 w-9` (36 px) and the new view tabs ≈28 px tall, below the repo's 44 px
  #79 UX-parity touch-target bar. **Fixed:** controls are now `h-11 w-11` (44 px) and
  the Pages/Graph tabs use `min-h-11` with `px-3.5 py-2`. No other findings.
- **CodeRabbit — unavailable:** check concluded `neutral` with
  "Review limit reached"; after the advertised reset a `@coderabbitai review` re-run at
  13:45 UTC still returned "Action not completed — Review rate limited". No CodeRabbit
  findings were produced because the diff was never analyzed. An explicit merge-gate
  waiver naming the reviewer and reason is recorded on PR #184.

## Verified positively
- Zero write paths: no `insert`/`update`/`delete`/`upsert`/`rpc`; `ensureWorkspace` is
  deliberately not called. `lib/tier-limits.ts`, IndexedDB and CRDT code untouched.
- Serialization: ghost dedupe/labels, tag facets, stable ordering, empty input, dropped
  self/blank/foreign rows covered by tests.
- Route: signed-out → `/login`, no-workspace, error+retry (query errors propagate and are
  surfaced, no invented data), loading state.
- A11y: labelled `Zoom in`/`Zoom out`/`Reset view` native buttons, `aria-current` view
  tabs as keyboard-reachable links, focus rings, canvas summary, keyboard page list.
- Listener/observer cleanup, in-flight request invalidation on unmount, theme-aware
  canvas palette.

## Verification evidence

```text
npx tsc --noEmit              clean
npm run lint                  clean
npm test                      100 files, 877 tests passed
npm run test:perf             1 test passed (seeded 500 pages / 2,020 links, < 1 s)
npm run build                 clean (24 routes; /graph prerendered static shell)
```
