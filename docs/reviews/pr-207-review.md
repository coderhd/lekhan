# Clean-room review — PR for SIL-207 / GV-T2 (graph interactions & filters)

**Branch:** `feat/207-gv-t2-graph-interactions-filters`
**Base:** `feat/206-gv-t1-graph-canvas` (stacked; GV-T1 reviewed in
`docs/reviews/pr-206-review.md`, not yet on `main`)
**Reviewer:** independent clean-room subagent (fresh context), auditing the GV-T2 delta
**Verdict on first pass:** REVISE (1 high, 3 medium, 10 low)
**Verdict after fixes:** APPROVE — every high/medium finding fixed; lows fixed or
explicitly closed below.

## Findings and disposition

### High

1. **Per-keystroke synchronous force layout blocked the main thread (should-fix).**
   Every title keystroke changed the filter → `filterGraphData` → `computeGraphLayout`
   (140 synchronous ticks) inside render. Measured ~215 ms at 500 pages / 1,000 edges;
   typing a word ≈ 1 s of blocked input plus repeated camera re-fits.
   **Fixed:** the filter feed that drives layout is debounced by 150 ms
   (`useDebouncedGraphFilter`), so the input and chips stay instant and the simulation
   re-seeds once the user pauses — one layout, one fit. The re-seed-before-paint
   semantics are unchanged (never CSS-hidden). Filter tests now await the debounced
   commit, and a filtered-empty/no-links test covers the new timing.

### Medium

2. **"No page links yet" fired for filtered subgraphs, not empty workspaces.**
   Filtering Alpha out of `Alpha → Beta` leaves zero visible edges and the workspace
   copy was wrong.
   **Fixed:** the workspace empty-links copy is gated on `!filtering`; a distinct
   "No links between the filtered pages" state explains a filtered subgraph. Test
   added (`does not claim the workspace has no links when the filter removed them`).

3. **Hover tooltip clipped at the pane's top and side edges.**
   The card was always above the cursor and clamped to a 96 px half-margin against a
   260 px card.
   **Fixed:** it flips below the cursor when `y < 96`, and the horizontal clamp now
   uses the card's actual half-width budget (`min(140, width / 2)`), so both edges stay
   inside the pane.

4. **"Clear filters" unmounted the focused button, dropping focus to `<body>`.**
   **Fixed:** clear returns focus to the title search input before the button unmounts;
   component test asserts `toHaveFocus()`.

### Low (fixed unless noted)

5. **Facet chips had no visible focus ring** — `focus-visible` on the label does not
   match input focus. **Fixed:** chips use `focus-within:ring-2`, the checkbox suppresses
   its UA ring, and the component test focuses the checkbox and asserts the chip class.
6. **Skeleton announcement** — kept `role="status" aria-busy="true"` with a stable
   `aria-label`; it is a route-level placeholder and the test now also proves the route
   renders it while the workspace read is pending (the old GlobalLoader mock was removed).
7. **Ghost-title rule drifted from the plan** — now one documented rule: tag facets never
   apply to ghosts; a ghost is selected by a non-empty title match or as edge context for
   a visible page. Unrelated ghosts no longer leak into facet-only results; test added.
8. **`sampleEdges` degenerate budgets** — `budget <= 0` now fails closed (shows nothing,
   `sampled: true`) instead of silently disabling the guard; `budget === 1` keeps the
   first id-ordered edge. Tests added.
9. **Sampling was only stable for a given fetch order** — `fetchWorkspaceGraph` has no
   `ORDER BY`. **Fixed:** sampling sorts by stable edge id first, so the same edge set
   samples identically across reloads; reversed-input test added. The misleading
   "oldest/newest" comment is gone.
10. **Badge total was post-filter but unlabelled** — `edgeCountBadge` accepts
    `{ filtered }` and its description names "the filtered links" when a filter produced
    the total.
11. **Canvas accessible label overstated sampled edges** — it now says
    "1,000 of 1,001 page links shown" when sampled; badge test asserts the canvas name.
12. **Pointer cancel left a stuck tooltip** — `onPointerCancel` now clears the hover card
    and highlight; leave/cancel test added.
13. **Test gaps** — added facet keyboard focus, clear-focus restoration, hover
    leave/cancel, filtered-vs-workspace empty copy, shuffled sampling determinism,
    budget-zero, and skeleton-on-pending-fetch. Edge painting itself is still asserted
    indirectly (tooltip lists the incident neighbour) because the 2D context is a noop
    proxy in jsdom; real paint is covered by the browser dogfood pass, not unit tests.

## Verified positively (first pass)

- **Read-only / domain:** no writes, no `ensureWorkspace`; only components/lib/tests/docs
  in the delta; no IndexedDB/CRDT/service changes; copy says "page links", never
  "mentions/backlinks".
- **Filter math:** trimmed case-insensitive title, OR within facets, AND across
  title/facets, ghost context, edge pruning on both endpoints, correct hidden counts.
- **Sampling:** pass-through at exactly the budget; 1,000 unique edges from 1,001/2,400;
  first/last in id order; input unmutated; comma formatting; `null` badge below budget.
- **Interactions:** hover sets highlight + tooltip (title, link count, linked titles);
  keyboard focus drives the same highlight; drag ≥ 4 px pans instead of routing; ghost
  nodes are non-navigable; click routes to `/page/<id>`.
- **A11y:** labelled search, `<fieldset>/<legend>` facet group with native checkboxes,
  44 px targets, single co-mounted `role="status"`, focus-revealed page list with real
  links, labelled zoom buttons, canvas `role="img"` description.
- **States:** empty workspace (no filter bar), no-match + clear, no-links, skeleton,
  sampled badge.

## Verification evidence

```text
npx tsc --noEmit              clean
npm run lint                  clean
npm test                      103 files, 919 tests passed
npm run build                 clean (24 routes; /graph prerendered static shell)
npm run test:perf             pass (500 pages / 2,020 links: 513 ms, then 818 ms under load 60, both < 1 s)
```

_Note:_ the shared machine also runs several parallel agent worktrees; at load average ~90 the
timing test measured 2.7 s. The diff does not touch `lib/graph-view/layout.ts` or the
serializer, and the test passed at 513 ms and again at 818 ms under heavy but lower load, so
re-run `npm run test:perf` on an idle machine before merge if CI uses a strict wall clock.
Likewise, one full-suite run hit the known timing-flaky `tests/unit/sync-snapshot-debounce.test.ts`
under load; it passes in isolation and on the next full run (919/919).
