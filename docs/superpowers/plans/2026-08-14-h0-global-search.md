# H0 Global Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A keyboard-first global search palette (Cmd+K) that finds any page you own or share by title, body text, #tag, or [[wikilink]] target, with ranked results and quick-switch.

**Architecture:** Postgres native search (pg_trgm) rides the existing graph index (`pages.searchable_text`, `page_tags`, `page_links` maintained by `server/graph-index.js` → `sync_page_graph`). A SECURITY INVOKER `search_pages` RPC returns ranked, access-scoped rows. A client service (`services/search.ts`) wraps the RPC and the recent-pages quick-switch. A `GlobalSearchPalette` component (Radix Dialog, provider-wraps-children) is mounted in the root layout for authenticated sessions and opened by Cmd/Ctrl+K or header buttons.

**Tech Stack:** Next.js 16 + React 19, Supabase (Postgres + RLS + REST rpc), pg_trgm, Radix Dialog (`@radix-ui/react-dialog`), Vitest (jsdom, globals: true, setup `tests/unit/setup.ts`), Tailwind/shadcn-style components, lucide-style `material-symbols-outlined` icons, sonner.

## Global Constraints

- **Never edit already-applied migration files.** New migration file: `supabase/migrations/20260817000000_global_search.sql` (timestamp must sort after the latest applied `20260816000005`).
- Migration is applied to the live project `hftipkzqbltdkrcjynad` via Supabase MCP `apply_migration` by the **controller** (implementers write the file only). Live RLS verification uses `SET LOCAL ROLE` + `set_config('request.jwt.claims', ..., true)`; RAISE NOTICE is invisible in MCP output.
- plpgsql: never name a variable after a column (42702) — use the `v_` prefix. Qualify outer refs.
- `search_pages` is **SECURITY INVOKER** — it must stay executable by `authenticated` (do NOT revoke EXECUTE like `sync_page_graph` does). It is a SELECT-only function (no INSERT...RETURNING concern).
- Client DB access goes through the `supabase` singleton from `lib/supabase.ts`.
- Verification gates for EVERY task: `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"` (npm not on PATH), then focused vitest files ONLY (full `npm run test` OOMs/hangs on this machine), `npm run lint`, and `npm run build` (P2 lesson: vitest + eslint never type-check — `next build` is mandatory for any TS/TSX change).
- Server files (`server/*.js`) are NOT touched in this plan — the graph index service already maintains the indexed data.
- The dashboard's existing in-place search/filter box (`components/dashboard.tsx` `applyFiltersAndSort`) is NOT changed.
- Standing user ruling (P2 Task 2, applies project-wide): "Currently we don't have any actual users. So it is okay if things break. Only my test accounts exist in the supabase. Apply wherever applicable" — pre-approves test-side/plan-text corrections where the brief is internally inconsistent.

---

### Task 1: Foundation — migration + `search_pages` RPC

**Files:**
- Create: `supabase/migrations/20260817000000_global_search.sql`

**Interfaces:**
- Produces: `public.search_pages(p_query text, p_limit integer DEFAULT 15)` returning `TABLE (id uuid, title text, icon text, workspace_id uuid, updated_at timestamptz, surface text, context text)`; `pg_trgm` extension; GIN trigram indexes on `pages.title`, `pages.searchable_text`, `page_tags.tag`, `page_links.to_title`. Tasks 2-4 consume this via `supabase.rpc('search_pages', { p_query, p_limit })`.
- Consumes: `public.pages` (owner_id, title, icon, workspace_id, updated_at, searchable_text), `public.page_members` (page_id, user_id), `public.page_tags` (page_id, tag), `public.page_links` (from_page_id, to_title). RLS policies as applied in `20260816000000_fix_pages_select_returning.sql`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260817000000_global_search.sql` with exactly this content:

```sql
-- H0 global search: pg_trgm GIN indexes over the four searchable surfaces plus
-- a SECURITY INVOKER search function that rides the existing graph index
-- (searchable_text / page_tags / page_links maintained by server/graph-index.js
-- via sync_page_graph).
--
-- search_pages is SECURITY INVOKER so RLS applies as the caller: results are
-- access-scoped by construction. The corpus filter narrows the RLS-visible set
-- (owner/public/member) to owner-or-member, excluding stranger public pages.
-- It is SELECT-only, so it stays executable by authenticated.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS pages_title_trgm_idx ON public.pages USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS pages_searchable_text_trgm_idx ON public.pages USING gin (searchable_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS page_tags_tag_trgm_idx ON public.page_tags USING gin (tag gin_trgm_ops);
CREATE INDEX IF NOT EXISTS page_links_to_title_trgm_idx ON public.page_links USING gin (to_title gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.search_pages(p_query text, p_limit integer DEFAULT 15)
RETURNS TABLE (
	id uuid,
	title text,
	icon text,
	workspace_id uuid,
	updated_at timestamp with time zone,
	surface text,
	context text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
	v_literal text;
	v_pattern text;
	v_limit integer;
BEGIN
	v_limit := least(coalesce(p_limit, 15), 50);
	IF p_query IS NULL OR length(btrim(p_query)) = 0 THEN
		RETURN;
	END IF;

	-- Literal substring matching: escape LIKE wildcards so user input is not
	-- treated as a pattern (no wildcard injection).
	v_literal := btrim(p_query);
	v_pattern := '%' || replace(replace(replace(v_literal, '\', '\\'), '%', '\%'), '_', '\_') || '%';

	RETURN QUERY
	SELECT best.id, best.title, best.icon, best.workspace_id, best.updated_at,
		best.surface, best.context
	FROM (
		WITH corpus AS (
			SELECT p.id, p.title, p.icon, p.workspace_id, p.updated_at, p.searchable_text
			FROM public.pages p
			WHERE p.owner_id = auth.uid()
				OR EXISTS (
					SELECT 1 FROM public.page_members m
					WHERE m.page_id = p.id AND m.user_id = auth.uid()
				)
		),
		matches AS (
			SELECT c.id, c.title, c.icon, c.workspace_id, c.updated_at,
				4::integer AS rank, 'title'::text AS surface, NULL::text AS context
			FROM corpus c
			WHERE c.title ILIKE v_pattern ESCAPE '\'
			UNION ALL
			SELECT c.id, c.title, c.icon, c.workspace_id, c.updated_at,
				3::integer, 'tag'::text, t.tag
			FROM corpus c
			JOIN public.page_tags t ON t.page_id = c.id
			WHERE t.tag ILIKE v_pattern ESCAPE '\'
			UNION ALL
			SELECT c.id, c.title, c.icon, c.workspace_id, c.updated_at,
				2::integer, 'link'::text, l.to_title
			FROM corpus c
			JOIN public.page_links l ON l.from_page_id = c.id
			WHERE l.to_title ILIKE v_pattern ESCAPE '\'
			UNION ALL
			SELECT c.id, c.title, c.icon, c.workspace_id, c.updated_at,
				1::integer, 'content'::text,
				substring(
					regexp_replace(c.searchable_text, '\s+', ' ', 'g')
					from greatest(
						position(lower(v_literal) in lower(regexp_replace(c.searchable_text, '\s+', ' ', 'g'))) - 40,
						1
					)
					for 80
				)
			FROM corpus c
			WHERE c.searchable_text ILIKE v_pattern ESCAPE '\'
		)
		SELECT DISTINCT ON (m.id)
			m.id, m.title, m.icon, m.workspace_id, m.updated_at,
			m.rank, m.surface, m.context
		FROM matches m
		ORDER BY m.id, m.rank DESC
	) best
	ORDER BY best.rank DESC, best.updated_at DESC
	LIMIT v_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_pages(text, integer) TO anon, authenticated, service_role;
```

- [ ] **Step 2: Syntax check + commit**

The file must be parseable SQL. Run the same sanity check as P2 Task 1 (balanced statement-enders — expect exactly 17: 7 top-level = 1 `CREATE EXTENSION`, 4 `CREATE INDEX`, 1 `CREATE FUNCTION` closing `$$;`, 1 `GRANT`; plus 10 PL/pgSQL body statement-enders: 3 `DECLARE` vars, `v_limit := …;`, `RETURN;`, `END IF;`, `v_literal := …;`, `v_pattern := …;`, `LIMIT v_limit;`, `END;`):

```bash
awk '/^[[:space:]]*$/{next} {if ($0 ~ /;\s*$/) c++} END {print c " statement-enders"}' supabase/migrations/20260817000000_global_search.sql
```

Then commit:

```bash
git add supabase/migrations/20260817000000_global_search.sql
git commit -m "feat(db): pg_trgm search indexes and search_pages RPC"
```

- [ ] **Step 3: Controller gate — apply the migration to the live project**

Run (controller, NOT the implementer): `supabase_apply_migration` with name `global_search` and the file content from Step 1. Expected: success (migration `20260817000000` recorded on project `hftipkzqbltdkrcjynad`).

- [ ] **Step 4: Controller gate — verify schema landed**

Run `supabase_list_tables` (verbose, schema `public`) and confirm `search_pages` exists as a function. Run:

```sql
SELECT p.proname, p.prosecdef, p.prosrc LIKE '%SECURITY INVOKER%' AS invoker_hint
FROM pg_proc p WHERE p.proname = 'search_pages';
```

Expected: `search_pages` present, `prosecdef = false` (not SECURITY DEFINER).

- [ ] **Step 5: Controller gate — live RLS matrix (MCP `execute_sql`)**

Each batch below is ONE implicit transaction; use `SET LOCAL ROLE` + `set_config('request.jwt.claims', ..., true)`; only the last resultset is returned; ROLLBACK discards scratch data.

(a) Seed scratch data as service role (postgres bypasses RLS):

```sql
INSERT INTO public.workspaces (id, name, owner_id) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Search Scratch Owner', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO public.workspaces (id, name, owner_id) VALUES
  ('00000000-0000-0000-0000-000000000002', 'Search Scratch Stranger', 'cccccccc-cccc-cccc-cccc-cccccccccccc');
INSERT INTO public.pages (id, workspace_id, title, owner_id, is_public, searchable_text, updated_at) VALUES
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'Obsidian Workflow', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false,
   'This page covers the obsidian vault migration steps in detail.', now()),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', 'Reading Log', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false,
   'A log of books read this year.', now()),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000001', 'Shared Brainstorm', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false,
   'Team notes for the brainstorm.', now()),
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000002', 'Stranger Public Note', 'cccccccc-cccc-cccc-cccc-cccccccccccc', true,
   'obsidian is mentioned in a public stranger note.', now());
INSERT INTO public.page_members (id, page_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000103', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'editor');
INSERT INTO public.page_tags (id, page_id, tag) VALUES
  ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000102', 'reading');
INSERT INTO public.page_links (id, workspace_id, from_page_id, to_title) VALUES
  ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000102', '[[Obsidian Workflow]]');
```

(b) As **owner** (`aaaaaaaa-...`), each of these must be a SEPARATE batch:

```sql
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","email":"owner@test.com","role":"authenticated"}', true);
SELECT id, title, surface, context FROM public.search_pages('obsidian', 50) ORDER BY surface;
```

Expected: row `0000...0101` (title surface, context NULL) and `0000...0102` (link surface, context `[[Obsidian Workflow]]`). The stranger public page `0000...0201` must NOT appear. Then confirm all four surfaces with `search_pages('reading', 50)` → `0000...0102` (tag surface) and `search_pages('vault migration', 50)` → `0000...0101` (content surface, non-NULL context). Confirm wildcard literal: `search_pages('100%', 50)` returns nothing while a query containing `%` does not match everything.

(c) As **member** (`bbbbbbbb-...`):

```sql
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","email":"member@test.com","role":"authenticated"}', true);
SELECT id, title FROM public.search_pages('brainstorm', 50);
```

Expected: shared page `0000...0103` present.

(d) As **stranger** (`cccccccc-...`):

```sql
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","email":"stranger@test.com","role":"authenticated"}', true);
SELECT id, title FROM public.search_pages('obsidian', 50);
```

Expected: the stranger's OWN public page `0000...0201` appears (they own it — corpus is owner-or-member), but NO owner/member pages.

(e) Cleanup scratch rows (ROLLBACK discards the seed batch; if the seed was committed, delete the three workspaces — pages/members/tags/links cascade):

```sql
DELETE FROM public.workspaces WHERE id IN ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
```

Verify zero leftover scratch rows.

- [ ] **Step 6: Commit any fix ups** (if the controller gate found issues requiring a corrective migration, name it `20260817000001_...` and commit; otherwise skip)

---

### Task 2: Client service layer — `searchPages` + `fetchRecentPages`

**Files:**
- Create: `services/search.ts`
- Create: `tests/unit/search.test.ts`
- Modify: `types/index.ts` (append `SearchResult`)

**Interfaces:**
- Consumes: `supabase.rpc` (`@/lib/supabase`); `ensureWorkspace(userId: string): Promise<Workspace>`, `fetchWorkspacePages(workspaceId: string): Promise<Page[]>`, `fetchSharedPages(userId: string): Promise<MemberPageItem[]>` from `@/services/graph` (existing, Task 3 of P2); `Page`, `SearchResult` types.
- Produces: `searchPages(query: string, limit?: number): Promise<SearchResult[]>`; `fetchRecentPages(userId: string, limit?: number): Promise<Page[]>`; `SearchResult { id; title; icon: string | null; workspace_id; updated_at; surface: 'title'|'tag'|'link'|'content'; context: string | null }`. Task 3 consumes both functions and the type.

- [ ] **Step 1: Add the `SearchResult` type**

In `types/index.ts`, append:

```ts
export interface SearchResult {
	id: string
	title: string
	icon: string | null
	workspace_id: string
	updated_at: string
	surface: 'title' | 'tag' | 'link' | 'content'
	context: string | null
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/search.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
	supabase: { rpc: rpcMock },
}))

const ensureWorkspace = vi.fn()
const fetchWorkspacePages = vi.fn()
const fetchSharedPages = vi.fn()
vi.mock('@/services/graph', () => ({
	ensureWorkspace: (...args: any[]) => ensureWorkspace(...args),
	fetchWorkspacePages: (...args: any[]) => fetchWorkspacePages(...args),
	fetchSharedPages: (...args: any[]) => fetchSharedPages(...args),
}))

import { supabase } from '@/lib/supabase'
import { fetchRecentPages, searchPages } from '@/services/search'
import type { SearchResult } from '@/types'

describe('searchPages', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('calls the search_pages RPC with the query and limit', async () => {
		const rows = [
			{ id: 'p-1', title: 'Obsidian Workflow', icon: null, workspace_id: 'ws-1', updated_at: '2026-08-14T00:00:00Z', surface: 'title', context: null },
		] as SearchResult[]
		rpcMock.mockResolvedValue({ data: rows, error: null })
		const result = await searchPages('obsidian', 15)
		expect(supabase.rpc).toHaveBeenCalledWith('search_pages', { p_query: 'obsidian', p_limit: 15 })
		expect(result).toEqual(rows)
	})

	it('throws on RPC error', async () => {
		rpcMock.mockResolvedValue({ data: null, error: new Error('boom') })
		await expect(searchPages('obsidian')).rejects.toThrow('boom')
	})

	it('returns an empty list when data is null', async () => {
		rpcMock.mockResolvedValue({ data: null, error: null })
		expect(await searchPages('nothing')).toEqual([])
	})
})

describe('fetchRecentPages', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		ensureWorkspace.mockResolvedValue({ id: 'ws-1', owner_id: 'user-1', name: 'My Workspace', is_team: false, created_at: '', updated_at: '' })
	})

	it('returns owned + shared pages sorted by recency and sliced to the limit', async () => {
		const owned = [
			{ id: 'p-1', title: 'Old', owner_id: 'user-1', workspace_id: 'ws-1', updated_at: '2026-08-01T00:00:00Z' },
			{ id: 'p-2', title: 'Shared Also Owned', owner_id: 'user-1', workspace_id: 'ws-1', updated_at: '2026-08-02T00:00:00Z' },
		]
		const shared = [
			{ role: 'editor', pages: { id: 'p-2', title: 'Shared Also Owned', owner_id: 'other', workspace_id: 'ws-9', updated_at: '2026-08-02T00:00:00Z' } },
			{ role: 'editor', pages: { id: 'p-3', title: 'Newest Shared', owner_id: 'other', workspace_id: 'ws-9', updated_at: '2026-08-10T00:00:00Z' } },
		]
		fetchWorkspacePages.mockResolvedValue(owned)
		fetchSharedPages.mockResolvedValue(shared)
		const result = await fetchRecentPages('user-1', 8)
		expect(ensureWorkspace).toHaveBeenCalledWith('user-1')
		expect(fetchWorkspacePages).toHaveBeenCalledWith('ws-1')
		expect(fetchSharedPages).toHaveBeenCalledWith('user-1')
		expect(result.map(p => p.id)).toEqual(['p-3', 'p-2', 'p-1'])
	})

	it('deduplicates a page owned and shared by the same user', async () => {
		fetchWorkspacePages.mockResolvedValue([{ id: 'p-1', title: 'Mine', updated_at: '2026-08-01T00:00:00Z' }])
		fetchSharedPages.mockResolvedValue([{ role: 'editor', pages: { id: 'p-1', title: 'Mine', updated_at: '2026-08-01T00:00:00Z' } }])
		const result = await fetchRecentPages('user-1', 8)
		expect(result).toHaveLength(1)
	})
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" && npm run test -- tests/unit/search.test.ts`
Expected: FAIL (module `@/services/search` not found).

- [ ] **Step 4: Implement the service**

Create `services/search.ts`:

```ts
import { supabase } from '@/lib/supabase'
import { Page, SearchResult } from '@/types'
import { ensureWorkspace, fetchSharedPages, fetchWorkspacePages } from '@/services/graph'

export async function searchPages (query: string, limit = 15): Promise<SearchResult[]> {
	const { data, error } = await supabase.rpc('search_pages', { p_query: query, p_limit: limit })

	if (error) {
		throw error
	}
	return (data as SearchResult[]) || []
}

export async function fetchRecentPages (userId: string, limit = 8): Promise<Page[]> {
	const workspace = await ensureWorkspace(userId)
	const [owned, shared] = await Promise.all([
		fetchWorkspacePages(workspace.id),
		fetchSharedPages(userId),
	])

	const seen = new Set<string>()
	const merged: Page[] = []
	for (const page of [...owned, ...shared.map(item => item.pages)]) {
		if (seen.has(page.id)) continue
		seen.add(page.id)
		merged.push(page)
	}
	merged.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
	return merged.slice(0, limit)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -- tests/unit/search.test.ts`
Expected: 5/5 pass.

- [ ] **Step 6: Lint + build**

Run: `npm run lint && npm run build`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add services/search.ts tests/unit/search.test.ts types/index.ts
git commit -m "feat(search): searchPages RPC wrapper and fetchRecentPages quick-switch"
```

---

### Task 3: `GlobalSearchPalette` component

**Files:**
- Create: `components/global-search-palette.tsx`
- Create: `tests/unit/global-search-palette.test.tsx`

**Interfaces:**
- Consumes: `searchPages(query, limit?): Promise<SearchResult[]>` and `fetchRecentPages(userId, limit?): Promise<Page[]>` from `@/services/search` (Task 2); `supabase.auth.getSession()` / `onAuthStateChange` from `@/lib/supabase`; `useRouter` from `next/navigation`.
- Produces: default export `GlobalSearchPalette` — a context provider that renders `{children}`, registers the `Cmd/Ctrl+K` listener, gates on an authenticated session, and renders the search dialog. Named export `useGlobalSearch(): { open: () => void }` for header trigger buttons (Task 4). The palette navigates to `/page/{id}` on selection.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/global-search-palette.test.tsx`. Follow the repo's mock patterns (`vi.mock('next/navigation')`, `vi.mock('sonner')`, `fireEvent`, fake timers):

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import React from 'react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const searchPages = vi.fn()
const fetchRecentPages = vi.fn()
vi.mock('@/services/search', () => ({
	searchPages: (...args: any[]) => searchPages(...args),
	fetchRecentPages: (...args: any[]) => fetchRecentPages(...args),
}))

const getSession = vi.fn()
vi.mock('@/lib/supabase', () => ({
	supabase: {
		auth: {
			getSession: (...args: any[]) => getSession(...args),
			onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
		},
	},
}))

import GlobalSearchPalette, { useGlobalSearch } from '@/components/global-search-palette'

const Trigger = () => {
	const { open } = useGlobalSearch()
	return <button onClick={open}>Open Search</button>
}

const renderPalette = () => render(
	<GlobalSearchPalette>
		<Trigger />
	</GlobalSearchPalette>
)

const openViaKey = async () => {
	await act(async () => {}) // flush the getSession promise so userId is set
	await act(async () => {
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
	})
}

describe('GlobalSearchPalette', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
		getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null })
		fetchRecentPages.mockResolvedValue([
			{ id: 'p-1', title: 'Recent Page', owner_id: 'user-1', updated_at: '2026-08-14T00:00:00Z' },
		])
		searchPages.mockResolvedValue([
			{ id: 'p-9', title: 'Obsidian Workflow', icon: null, workspace_id: 'ws-1', updated_at: '2026-08-14T00:00:00Z', surface: 'title', context: null },
		])
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('does not render when signed out', async () => {
		getSession.mockResolvedValue({ data: { session: null }, error: null })
		renderPalette()
		await act(async () => {})
		expect(screen.queryByPlaceholderText(/search pages/i)).toBeNull()
	})

	it('renders recent pages on an empty query (quick-switch)', async () => {
		renderPalette()
		await openViaKey()
		await act(async () => { await vi.advanceTimersByTimeAsync(210) })
		expect(fetchRecentPages).toHaveBeenCalledWith('user-1', 8)
		expect(screen.getByText('Recent Page')).toBeTruthy()
	})

	it('searches with the typed query and renders ranked results', async () => {
		renderPalette()
		await openViaKey()
		const input = screen.getByPlaceholderText(/search pages/i)
		fireEvent.change(input, { target: { value: 'obsidian' } })
		await act(async () => { await vi.advanceTimersByTimeAsync(210) })
		expect(searchPages).toHaveBeenCalledWith('obsidian', 15)
		expect(screen.getByText('Obsidian Workflow')).toBeTruthy()
	})

	it('navigates to the selected page on Enter', async () => {
		renderPalette()
		await openViaKey()
		const input = screen.getByPlaceholderText(/search pages/i)
		fireEvent.change(input, { target: { value: 'obsidian' } })
		await act(async () => { await vi.advanceTimersByTimeAsync(210) })
		fireEvent.keyDown(input, { key: 'ArrowDown' })
		fireEvent.keyDown(input, { key: 'Enter' })
		expect(push).toHaveBeenCalledWith('/page/p-9')
	})

	it('closes on Escape', async () => {
		renderPalette()
		await openViaKey()
		const input = screen.getByPlaceholderText(/search pages/i)
		fireEvent.keyDown(input, { key: 'Escape' })
		expect(screen.queryByPlaceholderText(/search pages/i)).toBeNull()
	})

	it('opens from the header trigger button', async () => {
		renderPalette()
		await act(async () => {}) // flush the getSession promise so userId is set
		fireEvent.click(screen.getByText('Open Search'))
		expect(screen.getByPlaceholderText(/search pages/i)).toBeTruthy()
	})

	it('shows a toast and empty state when search fails', async () => {
		searchPages.mockRejectedValue(new Error('boom'))
		renderPalette()
		await openViaKey()
		fireEvent.change(screen.getByPlaceholderText(/search pages/i), { target: { value: 'x' } })
		await act(async () => { await vi.advanceTimersByTimeAsync(210) })
		expect(screen.getByText(/no pages match/i)).toBeTruthy()
	})
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" && npm run test -- tests/unit/global-search-palette.test.tsx`
Expected: FAIL (module `@/components/global-search-palette` not found).

- [ ] **Step 3: Implement the component**

Create `components/global-search-palette.tsx`:

```tsx
'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { supabase } from '@/lib/supabase'
import { fetchRecentPages, searchPages } from '@/services/search'
import { toast } from 'sonner'

const DEBOUNCE_MS = 200
const SEARCH_LIMIT = 15
const RECENT_LIMIT = 8

type SearchRow = {
	id: string
	title: string
	icon: string | null
	updated_at: string
	context: string | null
}

const GlobalSearchContext = createContext<{ open: () => void } | null>(null)

export function useGlobalSearch () {
	const ctx = useContext(GlobalSearchContext)
	if (!ctx) {
		throw new Error('useGlobalSearch must be used within GlobalSearchPalette')
	}
	return ctx
}

export default function GlobalSearchPalette ({ children }: { children: ReactNode }) {
	const router = useRouter()
	const [open, setOpen] = useState(false)
	const [userId, setUserId] = useState<string | null>(null)
	const [query, setQuery] = useState('')
	const [rows, setRows] = useState<SearchRow[]>([])
	const [loading, setLoading] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(0)
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const requestIdRef = useRef(0)

	const openPalette = useCallback(() => {
		if (!userId) return
		setQuery('')
		setRows([])
		setSelectedIndex(0)
		setOpen(true)
	}, [userId])

	// Cmd/Ctrl+K opens the palette anywhere on authenticated pages.
	useEffect(() => {
		const handler = (e: globalThis.KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
				e.preventDefault()
				openPalette()
			}
		}
		document.addEventListener('keydown', handler)
		return () => document.removeEventListener('keydown', handler)
	}, [openPalette])

	// Track the authenticated user; render nothing (and never open) when signed out.
	useEffect(() => {
		let mounted = true
		supabase.auth.getSession().then(({ data: { session } }) => {
			if (mounted) setUserId(session?.user?.id ?? null)
		})
		const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
			if (mounted) {
				setUserId(session?.user?.id ?? null)
				if (!session) setOpen(false)
			}
		})
		return () => {
			mounted = false
			subscription.unsubscribe()
		}
	}, [])

	// Debounced fetch: recent pages when the query is empty, ranked results when querying.
	useEffect(() => {
		if (!userId) return
		const requestId = ++requestIdRef.current
		setLoading(true)
		if (debounceRef.current) clearTimeout(debounceRef.current)
		debounceRef.current = setTimeout(async () => {
			try {
				const trimmed = query.trim()
				const data = trimmed
					? await searchPages(trimmed, SEARCH_LIMIT)
					: (await fetchRecentPages(userId, RECENT_LIMIT)).map(page => ({
						id: page.id,
						title: page.title,
						icon: page.icon,
						updated_at: page.updated_at,
						context: null,
					}))
				if (requestId !== requestIdRef.current) return
				setRows(data)
				setSelectedIndex(0)
			} catch (err) {
				if (requestId !== requestIdRef.current) return
				console.error('Global search failed:', err)
				toast.error('Search failed. Please try again.')
				setRows([])
			} finally {
				if (requestId === requestIdRef.current) setLoading(false)
			}
		}, DEBOUNCE_MS)
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current)
		}
	}, [query, userId])

	const handleSelect = useCallback((row: SearchRow) => {
		setOpen(false)
		router.push(`/page/${row.id}`)
	}, [router])

	const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'ArrowDown') {
			e.preventDefault()
			setSelectedIndex(prev => Math.min(prev + 1, rows.length - 1))
		} else if (e.key === 'ArrowUp') {
			e.preventDefault()
			setSelectedIndex(prev => Math.max(prev - 1, 0))
		} else if (e.key === 'Enter') {
			e.preventDefault()
			const row = rows[selectedIndex]
			if (row) handleSelect(row)
		}
	}

	return (
		<GlobalSearchContext.Provider value={{ open: openPalette }}>
			{children}
			{userId && (
				<Dialog.Root open={open} onOpenChange={setOpen}>
					<Dialog.Portal>
						<Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[99999] animate-in fade-in" />
						<Dialog.Content className="fixed top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-xl bg-surface-container rounded-2xl border border-black/10 dark:border-white/10 shadow-2xl z-[100000] animate-in zoom-in-95">
							<div className="flex items-center gap-xs px-4 py-3 border-b border-black/5 dark:border-white/5">
								<span className="material-symbols-outlined text-on-surface-variant shrink-0">search</span>
								<input
									type="text"
									autoFocus
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									onKeyDown={onInputKeyDown}
									className="w-full bg-transparent outline-none text-on-surface placeholder:text-on-surface-variant/50"
									placeholder="Search pages, tags, links…"
								/>
							</div>
							<div className="max-h-[50vh] overflow-y-auto py-2">
								{loading ? (
									<div className="px-4 py-3 text-sm text-on-surface-variant">Searching…</div>
								) : rows.length === 0 ? (
									<div className="px-4 py-3 text-sm text-on-surface-variant">
										{query.trim() ? 'No pages match your search.' : 'No recent pages.'}
									</div>
								) : (
									rows.map((row, idx) => (
										<button
											key={row.id}
											type="button"
											onClick={() => handleSelect(row)}
											onMouseEnter={() => setSelectedIndex(idx)}
											className={`w-full flex items-center gap-sm px-4 py-2 text-left premium-transition ${
												idx === selectedIndex ? 'bg-primary/10 text-on-primary' : 'text-on-surface'
											}`}
										>
											<span className="material-symbols-outlined text-base shrink-0">{row.icon || 'description'}</span>
											<span className="flex-1 min-w-0">
												<span className="block truncate text-sm font-medium">{row.title}</span>
												{row.context && <span className="block truncate text-xs text-on-surface-variant">{row.context}</span>}
											</span>
											<span className="text-xs text-on-surface-variant shrink-0">{new Date(row.updated_at).toLocaleDateString()}</span>
										</button>
									))
								)}
							</div>
							<div className="px-4 py-2 border-t border-black/5 dark:border-white/5 text-xs text-on-surface-variant">
								↑↓ navigate · Enter open · Esc close
							</div>
						</Dialog.Content>
					</Dialog.Portal>
				</Dialog.Root>
			)}
		</GlobalSearchContext.Provider>
	)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- tests/unit/global-search-palette.test.tsx`
Expected: 7/7 pass.

- [ ] **Step 5: Lint + build**

Run: `npm run lint && npm run build`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add components/global-search-palette.tsx tests/unit/global-search-palette.test.tsx
git commit -m "feat(search): global search palette with keyboard navigation"
```

---

### Task 4: Integration — root mount, Cmd+K, header buttons

**Files:**
- Modify: `app/layout.tsx` (wrap children with `GlobalSearchPalette`)
- Modify: `components/dashboard.tsx` (header search button in the `slot="right"` cluster)
- Modify: `components/editor-workspace.tsx` (header search button in Row 1 right cluster)

**Interfaces:**
- Consumes: `GlobalSearchPalette` default export and `useGlobalSearch()` from `@/components/global-search-palette` (Task 3).
- Produces: palette available on all authenticated pages; `Cmd/Ctrl+K` and header buttons open it; dashboard in-place filter unchanged.

- [ ] **Step 1: Mount the palette in the root layout**

In `app/layout.tsx`, wrap the page content with `GlobalSearchPalette` so the provider is above every page (dashboard, editor, settings) but the palette still renders nothing when signed out. Import it and wrap the existing `GlobalHeaderProvider` block (keeping `SessionReauthProvider` above it):

```tsx
import GlobalSearchPalette from '@/components/global-search-palette'
```

and change the JSX so the `<GlobalHeaderProvider>` subtree is wrapped:

```tsx
<SessionReauthProvider>
	<GlobalSearchPalette>
		<GlobalHeaderProvider>
			<GlobalHeader />
			<div className="flex min-h-screen flex-col">
				<main className="flex flex-1 flex-col">{children}</main>
				<GlobalFooter />
			</div>
			<SessionInfoBanner />
			<Toaster />
		</GlobalHeaderProvider>
	</GlobalSearchPalette>
</SessionReauthProvider>
```

- [ ] **Step 2: Add the dashboard header search button**

In `components/dashboard.tsx`, import `useGlobalSearch` and add a search button as the first item of the `slot="right"` cluster (before `<ThemeToggle />`):

```tsx
import { useGlobalSearch } from '@/components/global-search-palette'
```

Inside the component body, near the other hooks:

```tsx
const { open: openGlobalSearch } = useGlobalSearch()
```

In the `slot="right"` flex container (currently `<div className="flex items-center gap-md">`), add before `<ThemeToggle />`:

```tsx
<button
	onClick={openGlobalSearch}
	className="p-2 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 premium-transition text-on-surface-variant hover:text-on-surface relative hover:scale-110 active:scale-90"
	title="Search (Cmd+K)"
>
	<span className="material-symbols-outlined leading-none">search</span>
</button>
```

- [ ] **Step 3: Add the editor header search button**

In `components/editor-workspace.tsx`, import `useGlobalSearch` and add a search button to the Row 1 right cluster (before the History button, currently `onClick={() => { setIsHistoryOpen(...) }}`):

```tsx
import { useGlobalSearch } from '@/components/global-search-palette'
```

Inside the component body, near `handleOpenLekhanBot`:

```tsx
const { open: openGlobalSearch } = useGlobalSearch()
```

Add before the History button (the `<button ... title="Version History">` block):

```tsx
<button
	onClick={openGlobalSearch}
	className="hidden md:flex items-center justify-center h-8 gap-xs px-2 lg:px-3 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 transition-all text-on-surface text-sm font-medium bg-surface-container-low"
	title="Search (Cmd+K)"
>
	<span className="material-symbols-outlined text-primary-container text-lg">search</span>
</button>
```

- [ ] **Step 4: Regression check — dashboard filter untouched**

Run the existing dashboard test to confirm the in-place search box still works unchanged:

```bash
npm run test -- tests/unit/dashboard-refetch-on-auth.test.tsx tests/unit/search.test.ts tests/unit/global-search-palette.test.tsx
```

Expected: all pass.

- [ ] **Step 5: Lint + build**

Run: `npm run lint && npm run build`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add app/layout.tsx components/dashboard.tsx components/editor-workspace.tsx
git commit -m "feat(search): mount global search palette and header triggers"
```

---

## Verification checklist (whole branch)

Run all focused test files (`tests/unit/search.test.ts`, `tests/unit/global-search-palette.test.tsx`, `tests/unit/dashboard-refetch-on-auth.test.tsx`, plus the P2 suites that touch dashboard/editor: `tests/unit/server.test.ts`, `tests/unit/db-graph.test.ts`, `tests/unit/editor-formatting.test.tsx`, `tests/unit/settings-tabs.test.tsx`, `tests/unit/db.test.ts`), then `npm run lint`, then `npm run build`. Confirm the live `search_pages` matrix from Task 1 Step 5 still holds after all client work (no DB change since). Working tree clean at the end.