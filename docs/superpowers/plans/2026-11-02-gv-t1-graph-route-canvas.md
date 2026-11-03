# Implementation plan — GV-T1: Graph route + d3-force GraphCanvas (SIL-206)

Branch: `feat/206-gv-t1-graph-canvas` (base: `origin/main`). Spec:
`docs/superpowers/specs/2026-11-02-h1-graph-view-backlink-pane-design.md` §Tickets GV-T1.

## Interface contract (written before parallel work)

`lib/graph-view/serialize.ts`

- `WorkspaceGraphData = { nodes: GraphNode[]; edges: GraphEdge[]; tags: GraphTagFacet[]; totalPages; totalLinks; unresolvedLinks }`
- `GraphNode = { id; kind: 'page' | 'unresolved'; title; tags: string[]; isPublic; updatedAt }`
- `GraphEdge = { id; source; target; unresolved }`
- `GraphTagFacet = { tag; count }`
- `serializeWorkspaceGraph({ pages, links, tagsByPage })` is pure, read-only, and never
  drops an unresolved link: `to_page_id: null` becomes a deduped ghost node keyed by
  normalised `to_title` (`ghost:<lowercased title>`).

`lib/graph-view/layout.ts`

- `computeGraphLayout(nodes, edges, options?)` runs `d3-force` with `stop()` + explicit
  `tick()` count (no animation loop, no wall-clock dependence) and returns positioned
  nodes (with `degree`), the same edges, and world bounds.
- Deterministic iteration count: 300 ticks ≤ 200 nodes, 220 ≤ 400, 140 above. The
  500-page / 2,000-link first-paint target is measured by `npm run test:perf` in an
  isolated run (the parallel unit suite distorts wall-clock timings).

`lib/graph-view/camera.ts`

- `fitCamera(bounds, size)`, `worldToScreen`, `screenToWorld`, `zoomCameraAt`,
  `hitTestGraph` — pure pan/zoom/hit-test maths so the canvas component stays thin
  and testable without a real 2D context.

## T1 — Data layer (RED first)

1. `tests/unit/graph-view-serialize.test.ts` — page nodes, resolved edges, unresolved
   ghost nodes (deduped, dashed), tags facets + per-node tags, public flag, empty input,
   links whose source page is absent.
2. `lib/graph-view/serialize.ts` + `lib/graph-view/types.ts`.

## T2 — Layout + camera (RED first)

1. `tests/unit/graph-view-layout.test.ts` — every node positioned, finite coords,
   degree/bounds, determinism at the default tick count, single-node edge case.
2. `lib/graph-view/layout.ts` + `lib/graph-view/camera.ts`.
3. `tests/unit/graph-view-camera.test.ts` — fit/round-trip, zoom-at-cursor, nearest-node
   hit test with a screen-radius floor, misses.
4. `tests/perf/graph-view.perf.test.ts` (`npm run test:perf`) — seeded 500-page /
   2,020-link fixture: serialization + the full 140-tick layout < 1 s, with no
   silent truncation.

## T3 — Surface (RED first)

1. `tests/unit/graph-view.test.tsx` — canvas accessible name/summary, labelled
   Zoom in / Zoom out / Reset view controls, keyboard/AT page list, node activation
   routes to `/page/<id>`, ghost activation does not route, drag ≠ click, empty copy.
2. `components/graph-view.tsx` — canvas 2D: edges (solid resolved, dashed unresolved),
   nodes (ghost dashed), labels, pointer pan, wheel zoom-at-cursor, click-through via
   `useRouter().push`, DPR-aware resize, theme-aware palette, focus-revealed page list
   as the keyboard/AT path.
3. `tests/unit/workspace-views-nav.test.tsx` — Pages/Graph links, `aria-current`, both
   keyboard reachable.
4. `components/workspace-views-nav.tsx` + insert into `components/dashboard.tsx`.

## T4 — Authed route

1. `app/graph/page.tsx` — server component shell (metadata); client boundary
   `components/graph-page.tsx` because this app keeps the Supabase session in
   localStorage (no cookie SSR), so auth/fetch must run client-side like every other
   route. It redirects signed-out visitors to `/login`, reads the workspace with
   `fetchWorkspaces` (no `ensureWorkspace`, so no new write path), then
   `fetchWorkspaceGraph` + `fetchWorkspacePageTags` → `serializeWorkspaceGraph` → props.
2. `components/graph-page.tsx` — loading / error+retry / empty-workspace / empty-graph
   states, workspace view tabs active on Graph.

## T5 — VERIFY → REVIEW → SHIP

1. `npm run typecheck && npm run lint && npm test && npm run test:perf` (full suite for
   regressions; perf in isolation for the budget proof).
2. Clean-room adversarial review of `git diff origin/main...HEAD` (4 axes) →
   `docs/reviews/pr-206-review.md`; fix valid findings.
3. Commit per slice; PR; wait for Pullfrog + CodeRabbit + CI green (merge gate).
