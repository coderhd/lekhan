# Implementation plan — GV-T2: Graph interactions & filters (SIL-207)

Branch: `feat/207-gv-t2-graph-interactions-filters` (base: `feat/206-gv-t1-graph-canvas`,
since GV-T1 is not yet on `main`). Spec:
`docs/superpowers/specs/2026-11-02-h1-graph-view-backlink-pane-design.md` §Tickets GV-T2.

## Interface contract (written before implementation)

`lib/graph-view/filters.ts` (new, pure)

- `GraphFilterState = { title: string; tags: string[] }`, `EMPTY_GRAPH_FILTER`.
- `graphFilterReducer(state, action)` — actions `set-title`, `toggle-tag`, `clear`.
- `isGraphFilterActive(state)`.
- `filterGraphData({ nodes, edges }, state)` → `{ nodes, edges, hiddenNodes, hiddenEdges }`.
  - Title: trimmed, case-insensitive substring over node titles.
  - Tag facets: multi-select; a page matches when it carries **any** selected tag
    (OR within facets); title and tag facets are combined with **AND**.
  - Ghost nodes carry no tags. A ghost survives when it is incident on a visible page,
    so a filtered page keeps the unresolved target it links to. Edges survive only when
    both endpoints survive.
  - Filters are applied to the data **before** `computeGraphLayout`, so the force
    simulation re-seeds on every filter change (never CSS-hiding).

`lib/graph-view/degrade.ts` (new, pure)

- `EDGE_BUDGET = 1000` — above this the renderer samples.
- `sampleEdges(edges, budget?)` → `{ edges, shown, total, sampled }`. Deterministic,
  evenly-spaced stride over the input (keeps first and last, no randomness, no silent
  truncation of the input array).
- `edgeCountBadge(shown, total)` → `{ label, description } | null`; `null` when nothing
  was sampled. Label is `Showing 1,000 of 2,400 links` (thousands separators).
- `formatCount(n)` — deterministic comma grouping (no locale dependence).

`components/graph-filters.tsx` (new)

- Controlled by `state` + `dispatch`; props `facets`, `visiblePages`, `totalPages`.
- Labelled search input (`Filter pages by title`), native checkbox facet chips inside a
  `<fieldset><legend>Filter by tag</legend>`, 44 px targets, polite result count,
  `Clear filters` only when a filter is active.

`components/graph-view.tsx` (modified)

- Owns filter state (`useReducer`) + sampling (`useMemo`), then layout.
- Hover highlights the hovered node's title and its incident edges (others dim), and
  shows a pointer tooltip with the node title + linked titles. The keyboard page list
  also drives the highlight on focus.
- States: workspace empty (existing), no links yet, no pages match filters, skeleton
  (`GraphViewSkeleton`), sampled badge.
- Click routing into `/page/<id>` is unchanged.

## T1 — Filter reducer (RED first)

1. `tests/unit/graph-view-filters.test.ts` — title only, facet only, combined,
   ghost-context retention, edge pruning, reducer actions, inactive passthrough.
2. `lib/graph-view/filters.ts`.

## T2 — Degradation guard (RED first)

1. `tests/unit/graph-view-degrade.test.ts` — passthrough at/below budget, 1,001 and
   2,400-link sampling (count, determinism, first/last, unique), badge text + commas,
   `null` badge when nothing sampled.
2. `lib/graph-view/degrade.ts`.

## T3 — Filter surface + a11y (RED first)

1. `tests/unit/graph-filters.test.tsx` — labelled search input, facet checkbox names +
   checked state + count, keyboard focusability, clear-button enablement, result count
   live region.
2. `components/graph-filters.tsx`.

## T4 — Graph interactions & states (RED first)

1. `tests/unit/graph-view.test.tsx` — extend: hover tooltip + `data-highlighted-node`,
   filter→list/canvas update, filtered-empty state + clear, no-links state, sampled
   badge at 1,001 links, skeleton a11y.
2. `components/graph-view.tsx`, `components/graph-page.tsx` (skeleton wiring).

## T5 — VERIFY → REVIEW → SHIP

1. `npm run typecheck && npm run lint && npm test` (perf suite unchanged; no layout
   change). Run `npm run test:perf` to prove GV-T1's budget still holds.
2. Clean-room adversarial review of `git diff origin/main...HEAD` (4 axes) →
   `docs/reviews/pr-207-review.md`; fix valid findings.
3. Commit per slice; PR against `feat/206-gv-t1-graph-canvas` (stacked); external
   review + CI green before merge.
