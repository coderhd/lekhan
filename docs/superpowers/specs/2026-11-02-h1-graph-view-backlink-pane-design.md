# H1: Graph view + backlink pane — Design

**Date:** 2026-11-02
**Status:** Approved (design — scheduled into W45)
**Epic:** [SIL-28](/SIL/issues/SIL-28) · GitHub issue #38
**Strategy:** docs/superpowers/specs/2026-08-12-global-pkm-suite-strategy-design.md §4 H1

## Goal

Render the workspace knowledge graph as a first-class view — nodes are Pages, edges are
page links — and give the editor a backlink pane. Both are **views over the index the
graph index service already maintains**; no new write path, no CRDT changes.

## Background

The substrate already exists:

- `services/graph.ts` exports `fetchWorkspaceGraph(workspaceId)` → `{pages, links}` and
  `fetchPageBacklinks(pageId)`.
- `page_links` carries unresolved targets (`to_page_id` NULL, `to_title` set) — the graph
  must render them as dashed/placeholder nodes, matching Obsidian.
- `page_tags` maps pages to `#tag` facets. `pages.is_public` exists for public status.
- Language (CONTEXT.md): this feature delivers the **Backlink** view and the dict-defining
  **Graph view**; the edges are **page links**, never "mentions" or "backlinks" in copy.

## Scope decisions (locked)

- **Surface:** a graph tab from the dashboard (`/page` list header → "Graph view"), NOT an
  editor tab. One workspace graph at a time. v1 is workspace-scoped; no megaclusters across
  workspaces.
- **Navigation:** clicking a node opens that page in the editor (same-tab router push).
- **Unresolved links:** rendered as dashed ghost nodes labeled `to_title`, not dropped.
- **Filters (v1):** text filter over node titles + tag facets (multi-select checkboxes,
  fetched once per workspace via `fetchPageTags`-style query). No physics settings UI.
- **Backlink pane:** right-side drawer in `editor-workspace.tsx`, lazily fetched, showing
  inbound page links with a one-line context; click-through to the linking page. It renders
  the existing `fetchPageBacklinks` result — no new query.
- **Performance bar:** first paint < 1s and interaction-ready < 3s at 500 pages / 2,000
  links (W45 dogfood corpus). Degrade by sampling, not by hiding edges silently (show a
  "showing N of M links" badge).

## Architecture

```text
Dashboard ─ workspace header Graph tab ──▶ /graph (server component, authed)
                                             │ fetchWorkspaceGraph(workspaceId)
                                             ▼
                                     serialize nodes/links/tags → client
                                             ▼
                                <GraphCanvas className="force-simulation">
                                   d3-force layout · pan/zoom · hover · click-through
                                   ghost nodes for unresolved targets
                                   tag facets + title filter

Editor (editor-workspace.tsx) ─ BacklinkPane (lazy)
                                   fetchPageBacklinks(pageId) → list + context line
```

- Canvas: use `d3-force` + `react-force-graph`-free custom SVG/Canvas hybrid; no WebGL in
  v1 (keep bundle small; 500 nodes is fine in canvas 2D). Pin to `lib/graph-view/`
  (pure layout) + `components/graph-view.tsx` (surface).
- Filters apply **before** the physics tick (re-seed layout), not by CSS-hide.
- Backlink context: derive a 120-char snippet around the `[[target]]` match from page body
  stored in the backlink row if available; otherwise page title only (no body scan in v1 —
  the backlink query stays as is).

## Tickets

| Slice | Est | Title |
|---|---|---|
| GV-T1 | 5 | Graph route + data serialization + d3-force GraphCanvas (nodes, edges, ghost nodes, pan/zoom/click-through) |
| GV-T2 | 3 | Graph interactions & filters: hover, title filter, tag facets, edge count badge, empty/component states |
| GV-T3 | 3 | BacklinkPane drawer in editor-workspace: list, context line, click-through, loading/empty states |

## Acceptance (epic)

- Graph tab renders the workspace graph with pages, links, and unresolved-target ghost nodes.
- Node click routes into the editor; backlink pane lists inbound links with click-through.
- Filters work via title text + tag facets; result degrades gracefully at 500+ pages.
- Zero new write paths: graph view verifies `page_links`/`page_tags` via read-only queries,
  and `fetchPageBacklinks` stays the only backlink source.
- all is a11y-correct (keyboard-reachable tab, focus trapping in drawer, labeled buttons)
  and follows the #79 UX-parity bar.

## Test requirements per slice

- GV-T1: unit test node/edge serialization incl. `to_page_id` NULL; snapshot test of graph
  data-shape for a seeded workspace; a11y smoke on tab/keyboard.
- GV-T2: unit tests for filter reducer (title, tag facet, both combined) and edge-count
  badge math at >-1000 links; interaction test for hover/click routing.
- GV-T3: unit + component test for backlink list rendering (resolved/unresolved rows,
  empty state, loading skeleton); real Supabase fixture test against `fetchPageBacklinks`.

## Non-goals (v1)

- Physics/layout customization, minimap, local-graph-at-selection mode, orbit/WebGL,
  export PNG, cross-workspace graph, public-pages overlay, backlink *diff over time*.
- Block references (H2 #48) — `page_links.block_id` stays NULL.

## Open questions (parked, none blocking)

- Local mode ("show only this page's neighborhood") is a candidate for the H2 #48 follow-up.
- PWA/mobile presentation of graph deferred to #43.
