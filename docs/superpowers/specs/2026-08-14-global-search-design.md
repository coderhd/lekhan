# H0: Global Search (index-native, keyboard-first) — Design

**Date:** 2026-08-14
**Status:** Approved (design)
**Epic:** GitHub issue #25
**Strategy:** docs/superpowers/specs/2026-08-12-global-pkm-suite-strategy-design.md (H0)

## Goal

A single global search palette (Cmd+K) over the knowledge graph: find any page you own or
share by its **title**, **body text**, **#tags**, or **[[link]] targets**, with keyboard-first
navigation. Serves as the quick-switch palette from the H0 roadmap.

## Scope decisions (locked in brainstorming)

- **Surface:** one global palette reachable on all authenticated pages (dashboard, editor,
  settings). No dedicated `/search` page in H0.
- **Corpus:** pages the user owns **or** is a member of. Stranger **public** pages are excluded —
  they stay discoverable via links, not the personal palette.
- **Matched surfaces:** title + body (`pages.searchable_text`) + `page_tags.tag` +
  `page_links.to_title` (unresolved wikilink targets). Title matches rank first.
- **Backend:** Postgres native search on the existing columns (**pg_trgm**), riding the index
  the graph index service already maintains. No server changes, no new write path.

## Architecture

```text
Cmd+K / header button ──▶ GlobalSearchPalette (root layout, authed only)
                            │  debounced query
                            ▼
                      services/search.ts (searchPages)
                            │  supabase.rpc('search_pages', …)
                            ▼
                search_pages(query, limit) — SECURITY INVOKER RPC
                  pages.title / searchable_text / page_tags / page_links
                  filtered to "owner OR member", ranked by surface, LIMIT
```

No changes to `server/`. The graph index service (`server/graph-index.js` → `sync_page_graph`)
continues to maintain `pages.searchable_text`, `page_tags`, `page_links`; search only reads them.

## Data layer

### Migration (`supabase/migrations/20260817000000_global_search.sql`)

Timestamp must sort after the latest applied migration (`20260816000005`) so it applies in order.

- `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
- GIN trigram indexes:
  - `pages_title_trgm_idx` on `public.pages (title gin_trgm_ops)`
  - `pages_searchable_text_trgm_idx` on `public.pages (searchable_text gin_trgm_ops)`
  - `page_tags_tag_trgm_idx` on `public.page_tags (tag gin_trgm_ops)`
  - `page_links_to_title_trgm_idx` on `public.page_links (to_title gin_trgm_ops)`

### `search_pages(p_query text, p_limit int)`

- **`SECURITY INVOKER`** (runs as the caller; RLS applies to every table it reads, so results
  are access-scoped by construction).
- Explicit positive corpus filter, applied on top of RLS: `pages.owner_id = auth.uid()` **OR**
  `EXISTS (SELECT 1 FROM page_members m WHERE m.page_id = pages.id AND m.user_id = auth.uid())`.
  This narrows the RLS-visible set (owner/public/member) to owner-or-member, excluding stranger
  public pages.
- Weighted `UNION` by matched surface, deduplicating pages across surfaces — a page may match
  on multiple surfaces; keep its highest rank. Implemented via `DISTINCT ON (pages.id)` keeping
  the max rank per page, then ordered by rank:
  - **title** `pages.title ILIKE '%'||p_query||'%'` — weight 4
  - **tag** `EXISTS (SELECT 1 FROM page_tags t WHERE t.page_id = pages.id AND t.tag ILIKE '%'||p_query||'%')` — weight 3
  - **link** `EXISTS (SELECT 1 FROM page_links l WHERE l.from_page_id = pages.id AND l.to_title ILIKE '%'||p_query||'%')` — weight 2 (the page **contains** a `[[link]]` whose target title matches)
  - **body** `pages.searchable_text ILIKE '%'||p_query||'%'` — weight 1
- Order: `rank DESC, pages.updated_at DESC`; `LIMIT p_limit`.
- Return columns: `id uuid, title text, icon text, workspace_id uuid, updated_at timestamptz,
  surface text, context text`. `context` is a short subtitle for the result row: the matched
  tag (`#tag`) or link target (`links to [[X]]`), or a trimmed body snippet for content matches;
  empty for title matches.
- Guards: `p_query` empty/whitespace → empty result set; `p_limit` default 15, capped 50;
  escape `%`/`_` in the query so user input is treated literally (no wildcard injection).

### Service layer

- New file `services/search.ts`:
  - `searchPages(query: string, limit?: number): Promise<SearchResult[]>` — calls
    `supabase.rpc('search_pages', { p_query: query, p_limit: limit })`; throws on Supabase error;
    normalizes rows; `|| []` on empty data.
  - `fetchRecentPages(userId: string, limit?: number): Promise<Page[]>` — for the palette's empty
    state (quick-switch): pages the user owns or is a member of, ordered by `updated_at DESC`,
    limit ~8. Implemented as the union of `fetchWorkspacePages(workspace.id)` (after
    `ensureWorkspace(userId)`) and `fetchSharedPages(userId)` mapped to their `pages`, sorted by
    `updated_at DESC` and sliced to the limit — reusing existing `services/graph.ts` functions
    rather than duplicating query logic.
- `types/index.ts`: add `SearchResult { id; title; icon: string | null; workspace_id;
  updated_at; surface: 'title'|'tag'|'link'|'content'; context: string | null }`.

## UX

### GlobalSearchPalette (`components/global-search-palette.tsx`)

- **Mount:** root layout `app/layout.tsx`, rendered only when an authenticated session exists
  (so it never appears on marketing/auth pages). Also renders the header search trigger button
  on the dashboard and editor headers.
- **Trigger:** `Cmd/Ctrl+K` global keydown (preventDefault; browser address-bar shortcut
  suppressed on authed pages). Also opened by the header search button.
- **Dialog:** Radix Dialog, centered overlay, auto-focused input, `Esc` closes.
- **Behavior:**
  - Debounced input (~200ms). Min query length 1.
  - **Empty query** → `fetchRecentPages` (quick-switch list, ~8 recent pages).
  - **Non-empty** → `searchPages(query, 15)`.
  - Result item: icon + title + `context` subtitle (tag/link/snippet).
  - `↑`/`↓` move selection, `Enter` navigates `router.push('/page/{id}')`, `Esc` closes.
- **States:** loading indicator while fetching; empty state ("No pages match…"); RPC error →
  toast (`sonner`) + empty state.

### Dashboard

- The dashboard's existing in-place search/filter box (components/dashboard.tsx
  `applyFiltersAndSort`) is **unchanged** — it filters the visible cards locally and is not a
  regression target.

## Error handling

- RPC error in `searchPages` → throw → palette catches → toast + empty state.
- Empty/whitespace query → RPC returns empty set; client keeps the recent-pages empty state.
- Result limit cap (15 palette / 50 RPC) prevents unbounded result sets.

## Testing

- **Unit — service:** `tests/unit/search.test.ts` — `searchPages` calls `rpc` with correct args,
  throws on error, normalizes rows, returns `[]` on null data; `fetchRecentPages` query shape.
- **Unit — palette:** `tests/unit/global-search-palette.test.tsx` — empty query renders recent
  pages; typed query triggers debounced search; `↑`/`↓` selection; `Enter` navigates to
  `/page/{id}`; `Esc` closes; RPC error shows toast + empty state.
- **Live RLS matrix** (MCP, `SET LOCAL ROLE` + `request.jwt.claims`): owner/member see own +
  shared pages; stranger public pages excluded; matches verified across all four surfaces
  (title/tag/link/body); wildcard chars in query treated literally.
- **Gates:** focused vitest files only (full `npm run test` OOMs), `npm run lint`,
  `npm run build`.

## Scope guardrails (NOT in H0)

- No `/search` page, no result-highlight positions, no English `to_tsvector` stemming config,
  no typo-tolerance beyond pg_trgm substring matching, no stranger public pages, no
  version-history search, no IndexedDB local search, no search result pagination beyond the cap.

## Open questions (deferred)

- Whether to add a `/search` page with filters and content previews → revisit after H0 launch.
- Ranking tuning (e.g. recency boost) once real vault data exists.