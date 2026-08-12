# P1: Pages-Graph Foundation (Schema Migration + Graph Index Service) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the Approach-B substrate: new `workspaces`/`pages`/`page_members`/`page_links`/`page_tags` tables with backfill from the legacy `documents` tables, a graph index service that extracts `[[links]]` and tags from document text, and a sync-server cutover with legacy fallback — all while the existing app keeps working.

**Architecture:** One SQL migration creates the new tables, backfills them from `documents`/`document_members`, and adds RLS policies (with a `can_access_page` helper mirroring the existing storage helper). A pure-function graph extractor (`server/graph-index.js`) parses wikilinks/tags from document text; `indexPage` resolves link targets against workspace page titles and upserts `page_links`/`page_tags`/`searchable_text`. The sync server and auth switch to `pages` first with a `documents` fallback (progressive cutover), so documents created by the still-shipping legacy client keep working.

**Tech Stack:** Node.js 18+, Next.js 16 + React 19, Supabase (Postgres + Storage + RLS), CommonJS sync server (y-websocket/yjs), Vitest (jsdom, globals: true, setup `tests/unit/setup.ts`).

## Global Constraints

- Legacy `documents`/`document_members`/`document_versions` tables are **never dropped or altered destructively** — they remain as the rollback path until the P2 client cutover.
- Migration file naming: `supabase/migrations/20260812000000_<name>.sql`.
- Storage bucket object path stays `{entityId}/main_state.bin` — page ids equal legacy document ids (backfilled `source_document_id`).
- Server files (`server/*.js`) are CommonJS (`require`/`module.exports`). New client code is TypeScript ES modules.
- Client DB access goes through the `supabase` singleton from `lib/supabase.ts` (exports `supabase`).
- Existing tests must stay green: run `npm run test` and `npm run lint` after every task.
- SQL migration verification uses `supabase db reset` (local CLI) or `supabase db push` (linked project); there is no SQL test harness in this repo.
- Version history stays on `document_versions` for now (ids match pages); renaming is deferred to P2.

---

### Task 1: Migration — pages graph schema, backfill, RLS

**Files:**
- Create: `supabase/migrations/20260812000000_pages_graph_schema.sql`

**Interfaces:**
- Produces: tables `public.workspaces`, `public.pages`, `public.page_members`, `public.page_links`, `public.page_tags`; RLS policies; helper `public.can_access_page(page_id uuid) returns boolean`; updated storage helper `public.can_access_document_storage` (also checks pages).

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260812000000_pages_graph_schema.sql` with exactly this content:

```sql
-- Pages-graph schema: workspaces, pages (universal node), members, links, tags.
-- Backfills from legacy documents tables. Legacy tables are preserved for rollback.

-- 1. Workspaces (one personal vault per owner in H0; team workspaces evolve in H2)
CREATE TABLE IF NOT EXISTS public.workspaces (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	name TEXT NOT NULL DEFAULT 'My Workspace',
	owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
	is_team BOOLEAN NOT NULL DEFAULT false,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
	UNIQUE (owner_id)
);

-- 2. Pages (universal node; replaces documents)
CREATE TABLE IF NOT EXISTS public.pages (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
	parent_id UUID REFERENCES public.pages(id) ON DELETE CASCADE,
	title TEXT NOT NULL DEFAULT 'Untitled',
	owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
	icon TEXT,
	cover TEXT,
	properties JSONB NOT NULL DEFAULT '{}'::jsonb,
	is_public BOOLEAN NOT NULL DEFAULT false,
	searchable_text TEXT DEFAULT '',
	source_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS pages_workspace_parent_idx ON public.pages (workspace_id, parent_id);
CREATE INDEX IF NOT EXISTS pages_owner_idx ON public.pages (owner_id);
CREATE INDEX IF NOT EXISTS pages_source_document_idx ON public.pages (source_document_id);

-- 3. Page members (mirror of document_members)
CREATE TABLE IF NOT EXISTS public.page_members (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	page_id UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
	user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
	role member_role NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
	UNIQUE (page_id, user_id)
);
CREATE INDEX IF NOT EXISTS page_members_page_idx ON public.page_members (page_id);
CREATE INDEX IF NOT EXISTS page_members_user_idx ON public.page_members (user_id);

-- 4. Links index (Obsidian backlinks + Notion block refs)
CREATE TABLE IF NOT EXISTS public.page_links (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
	from_page_id UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
	to_page_id UUID REFERENCES public.pages(id) ON DELETE CASCADE,
	to_title TEXT NOT NULL,
	block_id TEXT,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
	UNIQUE (from_page_id, to_title)
);
CREATE INDEX IF NOT EXISTS page_links_from_idx ON public.page_links (from_page_id);
CREATE INDEX IF NOT EXISTS page_links_to_idx ON public.page_links (to_page_id);
CREATE INDEX IF NOT EXISTS page_links_workspace_idx ON public.page_links (workspace_id);

-- 5. Tags index
CREATE TABLE IF NOT EXISTS public.page_tags (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	page_id UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
	tag TEXT NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
	UNIQUE (page_id, tag)
);
CREATE INDEX IF NOT EXISTS page_tags_page_idx ON public.page_tags (page_id);
CREATE INDEX IF NOT EXISTS page_tags_tag_idx ON public.page_tags (tag);

-- 6. Access helper (mirrors can_access_document_storage pattern)
CREATE OR REPLACE FUNCTION public.can_access_page(target_page_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
	user_id uuid;
BEGIN
	user_id := auth.uid();
	IF user_id IS NULL THEN
		RETURN false;
	END IF;
	RETURN EXISTS (
		SELECT 1 FROM public.pages p
		WHERE p.id = target_page_id
		AND (
			p.owner_id = user_id
			OR p.is_public = true
			OR EXISTS (
				SELECT 1 FROM public.page_members m
				WHERE m.page_id = p.id AND m.user_id = user_id
			)
			OR (
				p.source_document_id IS NOT NULL
				AND EXISTS (
					SELECT 1 FROM public.document_members dm
					WHERE dm.document_id = p.source_document_id AND dm.user_id = user_id
				)
			)
		)
	);
END;
$$;

-- 7. RLS enable
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_tags ENABLE ROW LEVEL SECURITY;

-- 8. Workspaces policies
DROP POLICY IF EXISTS select_workspaces ON public.workspaces;
CREATE POLICY select_workspaces ON public.workspaces
	FOR SELECT TO authenticated USING (owner_id = auth.uid());

DROP POLICY IF EXISTS insert_workspaces ON public.workspaces;
CREATE POLICY insert_workspaces ON public.workspaces
	FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS update_workspaces ON public.workspaces;
CREATE POLICY update_workspaces ON public.workspaces
	FOR UPDATE TO authenticated USING (owner_id = auth.uid());

-- 9. Pages policies
DROP POLICY IF EXISTS select_pages ON public.pages;
CREATE POLICY select_pages ON public.pages
	FOR SELECT TO authenticated USING (public.can_access_page(id));

DROP POLICY IF EXISTS insert_pages ON public.pages;
CREATE POLICY insert_pages ON public.pages
	FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS update_pages ON public.pages;
CREATE POLICY update_pages ON public.pages
	FOR UPDATE TO authenticated USING (owner_id = auth.uid());

DROP POLICY IF EXISTS delete_pages ON public.pages;
CREATE POLICY delete_pages ON public.pages
	FOR DELETE TO authenticated USING (owner_id = auth.uid());

-- 10. Page members policies
DROP POLICY IF EXISTS select_page_members ON public.page_members;
CREATE POLICY select_page_members ON public.page_members
	FOR SELECT TO authenticated USING (public.can_access_page(page_id));

DROP POLICY IF EXISTS insert_page_members ON public.page_members;
CREATE POLICY insert_page_members ON public.page_members
	FOR INSERT TO authenticated WITH CHECK (
		EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
	);

DROP POLICY IF EXISTS delete_page_members ON public.page_members;
CREATE POLICY delete_page_members ON public.page_members
	FOR DELETE TO authenticated USING (
		EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
	);

-- 11. Links index policies (SELECT via accessibility of either endpoint; writes server-side via service key)
DROP POLICY IF EXISTS select_page_links ON public.page_links;
CREATE POLICY select_page_links ON public.page_links
	FOR SELECT TO authenticated USING (
		public.can_access_page(from_page_id) OR public.can_access_page(to_page_id)
	);

-- 12. Tags index policies
DROP POLICY IF EXISTS select_page_tags ON public.page_tags;
CREATE POLICY select_page_tags ON public.page_tags
	FOR SELECT TO authenticated USING (public.can_access_page(page_id));

-- 13. Backfill: one default workspace per profile
INSERT INTO public.workspaces (name, owner_id)
SELECT 'My Workspace', p.id
FROM public.profiles p
ON CONFLICT DO NOTHING;

-- 14. Backfill: pages from documents (page id == document id for migrated rows)
INSERT INTO public.pages (
	id, workspace_id, parent_id, title, owner_id,
	is_public, searchable_text, source_document_id, created_at, updated_at
)
SELECT
	d.id,
	w.id,
	NULL,
	d.title,
	d.owner_id,
	d.is_public,
	d.searchable_text,
	d.id,
	d.created_at,
	d.updated_at
FROM public.documents d
JOIN public.workspaces w ON w.owner_id = d.owner_id
ON CONFLICT (id) DO NOTHING;

-- 15. Backfill: page members from document members
INSERT INTO public.page_members (page_id, user_id, role, created_at)
SELECT p.id, m.user_id, m.role, m.created_at
FROM public.document_members m
JOIN public.pages p ON p.source_document_id = m.document_id
ON CONFLICT (page_id, user_id) DO NOTHING;

-- 16. Storage helper: allow page-based access for documents bucket objects
CREATE OR REPLACE FUNCTION public.can_access_document_storage(
	object_name text,
	action text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
	doc_id_text text;
	user_id uuid;
BEGIN
	user_id := auth.uid();
	IF user_id IS NULL THEN
		RETURN false;
	END IF;

	doc_id_text := (storage.foldername(object_name))[1];
	IF doc_id_text IS NULL OR doc_id_text = '' THEN
		doc_id_text := split_part(object_name, '/', 1);
	END IF;

	IF action = 'select' THEN
		RETURN EXISTS (
			SELECT 1 FROM public.documents d
			WHERE d.id::text = doc_id_text
			AND (
				d.owner_id = user_id
				OR d.is_public = true
				OR EXISTS (
					SELECT 1 FROM public.document_members m
					WHERE m.document_id = d.id AND m.user_id = user_id
				)
			)
		) OR EXISTS (
			SELECT 1 FROM public.pages p
			WHERE p.id::text = doc_id_text AND public.can_access_page(p.id)
		);
	ELSIF action IN ('insert', 'update') THEN
		RETURN EXISTS (
			SELECT 1 FROM public.documents d
			WHERE d.id::text = doc_id_text
			AND (
				d.owner_id = user_id
				OR EXISTS (
					SELECT 1 FROM public.document_members m
					WHERE m.document_id = d.id AND m.user_id = user_id AND m.role = 'editor'
				)
			)
		) OR EXISTS (
			SELECT 1 FROM public.pages p
			WHERE p.id::text = doc_id_text
			AND (
				p.owner_id = user_id
				OR EXISTS (
					SELECT 1 FROM public.page_members m
					WHERE m.page_id = p.id AND m.user_id = user_id AND m.role = 'editor'
				)
			)
		);
	ELSIF action = 'delete' THEN
		RETURN EXISTS (
			SELECT 1 FROM public.documents d
			WHERE d.id::text = doc_id_text AND d.owner_id = user_id
		) OR EXISTS (
			SELECT 1 FROM public.pages p
			WHERE p.id::text = doc_id_text AND p.owner_id = user_id
		);
	END IF;

	RETURN false;
END;
$$;
```

- [ ] **Step 2: Apply the migration and verify**

Run: `npx supabase db reset` (local) or `npx supabase db push` (linked project). Then verify in the SQL editor:

```sql
SELECT count(*) FROM public.pages;
SELECT count(*) FROM public.workspaces;
SELECT count(*) FROM public.page_members;
-- Expect: pages == documents count, workspaces == profiles count, page_members == document_members count
```

- [ ] **Step 3: Verify RLS round-trip**

As an authenticated user (from the app), confirm a page is selectable by its owner, and `can_access_page` returns true for owner, member (via `page_members`), and source-document member; false for a stranger. Public pages are selectable by anyone.

- [ ] **Step 4: Verify existing app still passes**

Run: `npm run test` and `npm run build`
Expected: all existing tests pass, build succeeds (no code changed yet).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260812000000_pages_graph_schema.sql
git commit -m "feat(db): add pages-graph schema with backfill and RLS"
```

---

### Task 2: Graph extractors — pure functions

**Files:**
- Create: `server/graph-index.js`
- Test: `tests/unit/graph-index.test.ts`

**Interfaces:**
- Produces: `extractLinks(text: string) => Array<{ title: string; alias: string | null }>` (deduped by normalized title); `extractTags(text: string) => string[]` (lowercased, deduped); `normalizeTitle(title: string) => string` (lowercase, collapse whitespace, trim).
- Consumes: nothing.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/graph-index.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractLinks, extractTags, normalizeTitle } from '../../server/graph-index'

describe('extractLinks', () => {
	it('extracts plain wikilinks', () => {
		expect(extractLinks('See [[Project Alpha]] for details')).toEqual([
			{ title: 'Project Alpha', alias: null },
		])
	})

	it('extracts aliased wikilinks', () => {
		expect(extractLinks('Read [[long note|the note]] now')).toEqual([
			{ title: 'long note', alias: 'the note' },
		])
	})

	it('extracts multiple links and dedupes by title', () => {
		expect(extractLinks('[[A]] and [[A]] and [[B]]')).toEqual([
			{ title: 'A', alias: null },
			{ title: 'B', alias: null },
		])
	})

	it('ignores malformed or empty links', () => {
		expect(extractLinks('no links here')).toEqual([])
		expect(extractLinks('[[  ]]')).toEqual([])
	})

	it('returns empty array for non-string input', () => {
		expect(extractLinks(null as unknown as string)).toEqual([])
	})
})

describe('extractTags', () => {
	it('extracts hashtags at word boundaries', () => {
		expect(extractTags('meeting #work and #work again #ideas')).toEqual(['work', 'ideas'])
	})

	it('supports hierarchical tags', () => {
		expect(extractTags('tag #project/alpha here')).toEqual(['project/alpha'])
	})

	it('does not match mid-word hashes', () => {
		expect(extractTags('email me at a#b')).toEqual([])
	})

	it('returns empty array for non-string input', () => {
		expect(extractTags(null as unknown as string)).toEqual([])
	})
})

describe('normalizeTitle', () => {
	it('lowercases, trims and collapses whitespace', () => {
		expect(normalizeTitle('  Project   ALPHA ')).toBe('project alpha')
	})

	it('handles empty input', () => {
		expect(normalizeTitle('')).toBe('')
	})
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- tests/unit/graph-index.test.ts`
Expected: FAIL — module not found / functions undefined.

- [ ] **Step 3: Write the implementation**

Create `server/graph-index.js`:

```js
const MARKDOWN_LINK_RE = /\[\[([^\[\]|]+?)(?:\|([^\[\]]+?))?\]\]/g
const TAG_RE = /(?:^|[\s(])#([a-zA-Z0-9_][a-zA-Z0-9_\-/]*)/g

function normalizeTitle (title) {
	return String(title || '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim()
}

function extractLinks (text) {
	if (typeof text !== 'string') return []
	const links = []
	const seen = new Set()
	let match
	MARKDOWN_LINK_RE.lastIndex = 0
	while ((match = MARKDOWN_LINK_RE.exec(text)) !== null) {
		const title = match[1].trim()
		if (!title) continue
		const normalized = normalizeTitle(title)
		if (seen.has(normalized)) continue
		seen.add(normalized)
		links.push({ title, alias: match[2] ? match[2].trim() : null })
	}
	return links
}

function extractTags (text) {
	if (typeof text !== 'string') return []
	const tags = []
	const seen = new Set()
	let match
	TAG_RE.lastIndex = 0
	while ((match = TAG_RE.exec(text)) !== null) {
		const tag = match[1].toLowerCase()
		if (seen.has(tag)) continue
		seen.add(tag)
		tags.push(tag)
	}
	return tags
}

module.exports = { extractLinks, extractTags, normalizeTitle }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- tests/unit/graph-index.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full suite**

Run: `npm run test`
Expected: all existing tests plus the new ones pass.

- [ ] **Step 6: Commit**

```bash
git add server/graph-index.js tests/unit/graph-index.test.ts
git commit -m "feat(graph): add wikilink and tag extractors"
```

---

### Task 3: indexPage — graph index write path

**Files:**
- Modify: `server/graph-index.js` (append `getWorkspaceForPage`, `indexPage`)
- Test: `tests/unit/graph-index.test.ts` (append two describe blocks)

**Interfaces:**
- Produces: `getWorkspaceForPage(supabaseAdmin, pageId: string) => Promise<string | null>`; `indexPage(supabaseAdmin, pageId: string, text: string) => Promise<{ links: number; tags: number }>`.
- Consumes: `extractLinks`, `extractTags`, `normalizeTitle` from Task 2; a Supabase admin client shaped like `createClient(...)` (chainable `.from().select().eq().maybeSingle()` / `.update().eq()` / `.delete().eq()` / `.insert()`).

- [ ] **Step 1: Write the failing tests**

Update the import at the top of `tests/unit/graph-index.test.ts` to:

```ts
import { describe, it, expect, vi } from 'vitest'
import { extractLinks, extractTags, normalizeTitle, getWorkspaceForPage, indexPage } from '../../server/graph-index'
```

Then append the following to the bottom of `tests/unit/graph-index.test.ts`:

```ts
describe('getWorkspaceForPage', () => {
	it('returns workspace_id for an existing page', async () => {
		const admin: any = {
			from: vi.fn(() => ({
				select: vi.fn(() => ({
					eq: vi.fn(() => ({
						maybeSingle: vi.fn(async () => ({ data: { workspace_id: 'ws-1' }, error: null })),
					})),
				})),
			})),
		}
		expect(await getWorkspaceForPage(admin, 'page-1')).toBe('ws-1')
	})

	it('returns null when the page does not exist', async () => {
		const admin: any = {
			from: vi.fn(() => ({
				select: vi.fn(() => ({
					eq: vi.fn(() => ({
						maybeSingle: vi.fn(async () => ({ data: null, error: null })),
					})),
				})),
			})),
		}
		expect(await getWorkspaceForPage(admin, 'missing')).toBeNull()
	})
})

describe('indexPage', () => {
	const pageText = '# Notes\nMeeting with [[Priya]] about #work\nAlso see [[Priya]] again'

	it('upserts links, tags and searchable_text for a known page', async () => {
		const insertedLinks: any[] = []
		const insertedTags: any[] = []
		let pageSelectCalls = 0
		const workspacePagesData = [{ id: 'priya-page', title: 'Priya' }]

		// A builder node that is BOTH directly awaitable (indexPage's workspace-pages
		// fetch awaits .eq() itself) AND chainable (.maybeSingle() for getWorkspaceForPage).
		const makePageEq = () => {
			const node = {
				maybeSingle: vi.fn(async () => {
					pageSelectCalls += 1
					if (pageSelectCalls === 1) return { data: { workspace_id: 'ws-1' }, error: null }
					return { data: workspacePagesData, error: null }
				}),
				then: (onfulfilled: any) =>
					Promise.resolve({ data: workspacePagesData, error: null }).then(onfulfilled),
			}
			return node
		}

		const admin: any = {
			from: vi.fn((table: string) => {
				if (table === 'pages') {
					return {
						select: vi.fn(() => ({ eq: makePageEq })),
						update: vi.fn(() => ({
							eq: vi.fn(async () => ({ data: null, error: null })),
						})),
					}
				}
				if (table === 'page_links') {
					return {
						delete: vi.fn(() => ({
							eq: vi.fn(async () => ({ data: null, error: null })),
						})),
						insert: vi.fn(async (rows: any[]) => {
							insertedLinks.push(...rows)
							return { data: null, error: null }
						}),
					}
				}
				if (table === 'page_tags') {
					return {
						delete: vi.fn(() => ({
							eq: vi.fn(async () => ({ data: null, error: null })),
						})),
						insert: vi.fn(async (rows: any[]) => {
							insertedTags.push(...rows)
							return { data: null, error: null }
						}),
					}
				}
				return {}
			}),
		}

		const result = await indexPage(admin, 'page-1', pageText)

		expect(result).toEqual({ links: 1, tags: 1 })
		expect(insertedLinks).toEqual([
			{ workspace_id: 'ws-1', from_page_id: 'page-1', to_page_id: 'priya-page', to_title: 'Priya' },
		])
		expect(insertedTags).toEqual([{ page_id: 'page-1', tag: 'work' }])
		expect(admin.from).toHaveBeenCalledWith('pages')
		expect(admin.from).toHaveBeenCalledWith('page_links')
		expect(admin.from).toHaveBeenCalledWith('page_tags')
	})

	it('resolves nothing and stores no links when the page has no workspace', async () => {
		const admin: any = {
			from: vi.fn(() => ({
				select: vi.fn(() => ({
					eq: vi.fn(() => ({
						maybeSingle: vi.fn(async () => ({ data: null, error: null })),
					})),
				})),
			})),
		}
		const result = await indexPage(admin, 'page-1', '[[Any]]')
		expect(result).toEqual({ links: 0, tags: 0 })
		expect(admin.from).not.toHaveBeenCalledWith('page_links')
	})
})
```

Note: `vi` must be imported — update the import line at the top of the test file to `import { describe, it, expect, vi } from 'vitest'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- tests/unit/graph-index.test.ts`
Expected: FAIL — `getWorkspaceForPage` / `indexPage` undefined.

- [ ] **Step 3: Write the implementation**

Append to `server/graph-index.js`:

```js
async function getWorkspaceForPage (supabaseAdmin, pageId) {
	const { data } = await supabaseAdmin
		.from('pages')
		.select('workspace_id')
		.eq('id', pageId)
		.maybeSingle()
	return data ? data.workspace_id : null
}

async function indexPage (supabaseAdmin, pageId, text) {
	const workspaceId = await getWorkspaceForPage(supabaseAdmin, pageId)
	if (!workspaceId) {
		return { links: 0, tags: 0 }
	}

	const { data: workspacePages } = await supabaseAdmin
		.from('pages')
		.select('id, title')
		.eq('workspace_id', workspaceId)

	const titleIndex = new Map()
	for (const page of workspacePages || []) {
		titleIndex.set(normalizeTitle(page.title), page.id)
	}

	const links = extractLinks(text)
	const linkRows = links.map(link => ({
		workspace_id: workspaceId,
		from_page_id: pageId,
		to_page_id: titleIndex.get(normalizeTitle(link.title)) || null,
		to_title: link.title,
	}))

	const tags = extractTags(text)

	await supabaseAdmin.from('page_links').delete().eq('from_page_id', pageId)
	if (linkRows.length > 0) {
		await supabaseAdmin.from('page_links').insert(linkRows)
	}

	await supabaseAdmin.from('page_tags').delete().eq('page_id', pageId)
	if (tags.length > 0) {
		await supabaseAdmin.from('page_tags').insert(tags.map(tag => ({ page_id: pageId, tag })))
	}

	await supabaseAdmin
		.from('pages')
		.update({ searchable_text: text })
		.eq('id', pageId)

	return { links: linkRows.length, tags: tags.length }
}

module.exports = { extractLinks, extractTags, normalizeTitle, getWorkspaceForPage, indexPage }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- tests/unit/graph-index.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Run lint and the full suite**

Run: `npm run lint && npm run test`
Expected: clean lint, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/graph-index.js tests/unit/graph-index.test.ts
git commit -m "feat(graph): index page links, tags and searchable text"
```

---

### Task 4: Client service layer — workspaces, pages, graph queries

**Files:**
- Modify: `types/index.ts` (append interfaces)
- Create: `services/graph.ts`
- Test: `tests/unit/db-graph.test.ts`

**Interfaces:**
- Produces (from `services/graph.ts`):
  - `fetchWorkspaces(userId: string): Promise<Workspace[]>`
  - `fetchWorkspacePages(workspaceId: string): Promise<Page[]>`
  - `createPage(workspaceId: string, ownerId: string, parentId?: string | null): Promise<Page>`
  - `updatePageTitle(pageId: string, title: string): Promise<void>`
  - `deletePage(pageId: string): Promise<void>`
  - `updatePagePublicStatus(pageId: string, isPublic: boolean): Promise<void>`
  - `fetchPageDetails(pageId: string): Promise<Page>`
  - `fetchPageBacklinks(pageId: string): Promise<Backlink[]>`
  - `fetchPageTags(pageId: string): Promise<PageTag[]>`
  - `fetchWorkspaceGraph(workspaceId: string): Promise<{ pages: Page[]; links: PageLink[] }>`
- Types: `Workspace`, `Page`, `PageLink`, `PageTag`, `Backlink` (defined in Task below).
- Consumes: `supabase` from `@/lib/supabase`.

- [ ] **Step 1: Add the types**

Append to `types/index.ts`:

```ts
export interface Workspace {
	id: string
	name: string
	owner_id: string
	is_team: boolean
	created_at: string
	updated_at: string
}

export interface Page {
	id: string
	workspace_id: string
	parent_id: string | null
	title: string
	owner_id: string
	icon: string | null
	cover: string | null
	properties: Record<string, unknown>
	is_public: boolean
	searchable_text: string | null
	created_at: string
	updated_at: string
}

export interface PageLink {
	id: string
	from_page_id: string
	to_page_id: string | null
	to_title: string
	block_id: string | null
	created_at: string
}

export interface PageTag {
	id: string
	page_id: string
	tag: string
	created_at: string
}

export interface Backlink {
	from_page_id: string
	from_title: string
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/db-graph.test.ts` (mirrors the `db.test.ts` mock pattern):

```ts
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { supabase } from '@/lib/supabase'
import {
	fetchWorkspaces,
	fetchWorkspacePages,
	createPage,
	updatePageTitle,
	deletePage,
	updatePagePublicStatus,
	fetchPageDetails,
	fetchPageBacklinks,
	fetchPageTags,
	fetchWorkspaceGraph,
} from '@/services/graph'

vi.mock('@/lib/supabase', () => {
	const builder: any = {
		select: vi.fn().mockReturnThis(),
		insert: vi.fn().mockReturnThis(),
		update: vi.fn().mockReturnThis(),
		delete: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		order: vi.fn().mockReturnThis(),
		single: vi.fn().mockResolvedValue({ data: null, error: null }),
		then: vi.fn((cb) => Promise.resolve({ data: [], count: 0, error: null }).then(cb)),
	}
	return {
		supabase: {
			from: vi.fn(() => builder),
		},
	}
})

describe('Graph Service', () => {
	const mockBuilder = (supabase.from as any)()

	beforeEach(() => {
		vi.clearAllMocks()
		mockBuilder.select.mockReturnThis()
		mockBuilder.insert.mockReturnThis()
		mockBuilder.update.mockReturnThis()
		mockBuilder.delete.mockReturnThis()
		mockBuilder.eq.mockReturnThis()
		mockBuilder.order.mockReturnThis()
		mockBuilder.single.mockResolvedValue({ data: null, error: null })
		mockBuilder.then.mockImplementation((cb: any) => Promise.resolve({ data: [], count: 0, error: null }).then(cb))
	})

	it('fetchWorkspaces queries workspaces by owner', async () => {
		const mockWorkspaces = [{ id: 'ws-1', name: 'My Workspace', owner_id: 'user-123' }]
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ data: mockWorkspaces, error: null }).then(onfulfilled)
		)
		const result = await fetchWorkspaces('user-123')
		expect(supabase.from).toHaveBeenCalledWith('workspaces')
		expect(mockBuilder.eq).toHaveBeenCalledWith('owner_id', 'user-123')
		expect(result).toEqual(mockWorkspaces)
	})

	it('fetchWorkspacePages queries pages by workspace', async () => {
		const mockPages = [{ id: 'p-1', workspace_id: 'ws-1', title: 'A' }]
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ data: mockPages, error: null }).then(onfulfilled)
		)
		const result = await fetchWorkspacePages('ws-1')
		expect(supabase.from).toHaveBeenCalledWith('pages')
		expect(mockBuilder.eq).toHaveBeenCalledWith('workspace_id', 'ws-1')
		expect(result).toEqual(mockPages)
	})

	it('createPage inserts a page with workspace and owner', async () => {
		const newPage = { id: 'p-2', workspace_id: 'ws-1', owner_id: 'user-123', title: 'Untitled' }
		mockBuilder.single.mockResolvedValue({ data: newPage, error: null })
		const result = await createPage('ws-1', 'user-123')
		expect(supabase.from).toHaveBeenCalledWith('pages')
		expect(mockBuilder.insert).toHaveBeenCalledWith({
			workspace_id: 'ws-1',
			owner_id: 'user-123',
			parent_id: null,
			title: 'Untitled',
		})
		expect(result).toEqual(newPage)
	})

	it('createPage passes parent_id when provided', async () => {
		mockBuilder.single.mockResolvedValue({ data: { id: 'p-3' }, error: null })
		await createPage('ws-1', 'user-123', 'parent-9')
		expect(mockBuilder.insert).toHaveBeenCalledWith({
			workspace_id: 'ws-1',
			owner_id: 'user-123',
			parent_id: 'parent-9',
			title: 'Untitled',
		})
	})

	it('updatePageTitle updates the page title', async () => {
		await updatePageTitle('p-1', 'New Title')
		expect(supabase.from).toHaveBeenCalledWith('pages')
		expect(mockBuilder.update).toHaveBeenCalledWith({ title: 'New Title' })
		expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'p-1')
	})

	it('deletePage deletes the page', async () => {
		await deletePage('p-1')
		expect(supabase.from).toHaveBeenCalledWith('pages')
		expect(mockBuilder.delete).toHaveBeenCalled()
		expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'p-1')
	})

	it('updatePagePublicStatus updates is_public', async () => {
		await updatePagePublicStatus('p-1', true)
		expect(mockBuilder.update).toHaveBeenCalledWith({ is_public: true })
		expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'p-1')
	})

	it('fetchPageDetails fetches a single page', async () => {
		const page = { id: 'p-1', workspace_id: 'ws-1', title: 'A' }
		mockBuilder.single.mockResolvedValue({ data: page, error: null })
		const result = await fetchPageDetails('p-1')
		expect(supabase.from).toHaveBeenCalledWith('pages')
		expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'p-1')
		expect(result).toEqual(page)
	})

	it('fetchPageBacklinks returns pages linking to the given page', async () => {
		const mockBacklinks = [{ from_page_id: 'p-9', from_title: 'Source' }]
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ data: mockBacklinks, error: null }).then(onfulfilled)
		)
		const result = await fetchPageBacklinks('p-1')
		expect(supabase.from).toHaveBeenCalledWith('page_links')
		expect(result).toEqual(mockBacklinks)
	})

	it('fetchPageTags returns tags for a page', async () => {
		const mockTags = [{ id: 't-1', page_id: 'p-1', tag: 'work' }]
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ data: mockTags, error: null }).then(onfulfilled)
		)
		const result = await fetchPageTags('p-1')
		expect(supabase.from).toHaveBeenCalledWith('page_tags')
		expect(mockBuilder.eq).toHaveBeenCalledWith('page_id', 'p-1')
		expect(result).toEqual(mockTags)
	})

	it('fetchWorkspaceGraph fetches pages and links together', async () => {
		const mockPages = [{ id: 'p-1' }]
		const mockLinks = [{ from_page_id: 'p-1', to_title: 'A' }]
		mockBuilder.then
			.mockImplementationOnce((onfulfilled: any) =>
				Promise.resolve({ data: mockPages, error: null }).then(onfulfilled)
			)
			.mockImplementationOnce((onfulfilled: any) =>
				Promise.resolve({ data: mockLinks, error: null }).then(onfulfilled)
			)
		const result = await fetchWorkspaceGraph('ws-1')
		expect(result).toEqual({ pages: mockPages, links: mockLinks })
		expect(supabase.from).toHaveBeenCalledWith('pages')
		expect(supabase.from).toHaveBeenCalledWith('page_links')
	})
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test -- tests/unit/db-graph.test.ts`
Expected: FAIL — module `@/services/graph` not found.

- [ ] **Step 4: Write the implementation**

Create `services/graph.ts`:

```ts
import { supabase } from '@/lib/supabase'
import { Backlink, Page, PageLink, PageTag, Workspace } from '@/types'

export async function fetchWorkspaces (userId: string): Promise<Workspace[]> {
	const { data, error } = await supabase
		.from('workspaces')
		.select('*')
		.eq('owner_id', userId)
		.order('created_at', { ascending: true })

	if (error) {
		throw error
	}
	return (data as Workspace[]) || []
}

export async function fetchWorkspacePages (workspaceId: string): Promise<Page[]> {
	const { data, error } = await supabase
		.from('pages')
		.select('*')
		.eq('workspace_id', workspaceId)
		.order('updated_at', { ascending: false })

	if (error) {
		throw error
	}
	return (data as Page[]) || []
}

export async function createPage (
	workspaceId: string,
	ownerId: string,
	parentId: string | null = null
): Promise<Page> {
	const { data, error } = await supabase
		.from('pages')
		.insert({
			workspace_id: workspaceId,
			owner_id: ownerId,
			parent_id: parentId,
			title: 'Untitled',
		})
		.select()
		.single()

	if (error) {
		throw error
	}
	return data as Page
}

export async function updatePageTitle (pageId: string, title: string): Promise<void> {
	const { error } = await supabase
		.from('pages')
		.update({ title })
		.eq('id', pageId)

	if (error) {
		throw error
	}
}

export async function deletePage (pageId: string): Promise<void> {
	const { error } = await supabase
		.from('pages')
		.delete()
		.eq('id', pageId)

	if (error) {
		throw error
	}
}

export async function updatePagePublicStatus (pageId: string, isPublic: boolean): Promise<void> {
	const { error } = await supabase
		.from('pages')
		.update({ is_public: isPublic })
		.eq('id', pageId)

	if (error) {
		throw error
	}
}

export async function fetchPageDetails (pageId: string): Promise<Page> {
	const { data, error } = await supabase
		.from('pages')
		.select('*')
		.eq('id', pageId)
		.single()

	if (error) {
		throw error
	}
	return data as Page
}

export async function fetchPageBacklinks (pageId: string): Promise<Backlink[]> {
	const { data, error } = await supabase
		.from('page_links')
		.select('from_page_id, pages!page_links_from_page_id_fkey (title)')
		.eq('to_page_id', pageId)

	if (error) {
		throw error
	}
	return ((data as Array<{ from_page_id: string; pages: { title: string } | null }>) || [])
		.filter(row => row.pages)
		.map(row => ({
			from_page_id: row.from_page_id,
			from_title: (row.pages as { title: string }).title,
		}))
}

export async function fetchPageTags (pageId: string): Promise<PageTag[]> {
	const { data, error } = await supabase
		.from('page_tags')
		.select('*')
		.eq('page_id', pageId)
		.order('created_at', { ascending: true })

	if (error) {
		throw error
	}
	return (data as PageTag[]) || []
}

export async function fetchWorkspaceGraph (workspaceId: string): Promise<{ pages: Page[]; links: PageLink[] }> {
	const [pagesResult, linksResult] = await Promise.all([
		supabase.from('pages').select('*').eq('workspace_id', workspaceId),
		supabase.from('page_links').select('*').eq('workspace_id', workspaceId),
	])

	if (pagesResult.error) {
		throw pagesResult.error
	}
	if (linksResult.error) {
		throw linksResult.error
	}
	return {
		pages: (pagesResult.data as Page[]) || [],
		links: (linksResult.data as PageLink[]) || [],
	}
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -- tests/unit/db-graph.test.ts`
Expected: PASS (11 tests).

Note: `fetchPageBacklinks` and `fetchWorkspaceGraph` rely on Supabase embedding; the mock's `then` chains resolve them in these tests. If the foreign-key embedding alias `pages!page_links_from_page_id_fkey` is rejected by PostgREST at runtime, adjust the select string to the embedding output shape (`pages (title)`) — the shape assertion in the test covers the mapping logic either way.

- [ ] **Step 6: Run lint and the full suite**

Run: `npm run lint && npm run test`
Expected: clean lint, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add types/index.ts services/graph.ts tests/unit/db-graph.test.ts
git commit -m "feat(graph): add client service layer for workspaces, pages and graph queries"
```

---

### Task 5: Sync server + auth cutover with legacy fallback

**Files:**
- Modify: `server/auth.js` (entity resolution + role verification against pages, fallback documents)
- Modify: `server/index.js` (`saveDocumentState` writes `pages` first, falls back to `documents`; calls `indexPage`)
- Test: `tests/unit/server.test.ts` (append describe blocks)

**Interfaces:**
- Consumes: `getWorkspaceForPage`/`indexPage` behavior is unchanged; `verifyUserRole(supabase, entityId, token)` and `getDocumentOwnerPlanLimit(supabaseAdmin, entityId)` keep their signatures but operate on pages first.
- Produces: `getEntityOwner(supabase, entityId) => Promise<{ type: 'page' | 'document'; owner_id: string; is_public: boolean } | null>` (internal helper, also exported for tests).

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/server.test.ts`:

```ts
describe('Server Pages Cutover & Graph Index Integration', () => {
	const auth = require('../../server/auth')
	const graphIndex = require('../../server/graph-index')

	it('verifyUserRole returns "owner" when the page owner matches the user', async () => {
		const mockSupabase = {
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null }),
			},
			from: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockResolvedValue({ data: { type: 'page', owner_id: 'user-123', is_public: false }, error: null }),
					}),
				}),
			}),
		} as any

		const role = await auth.verifyUserRole(mockSupabase, 'page-1', 'token-1')
		expect(role).toBe('owner')
	})

	it('verifyUserRole falls back to documents when no page exists', async () => {
		let calls = 0
		const mockSupabase = {
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null }),
			},
			from: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockImplementation(async () => {
							calls += 1
							if (calls === 1) return { data: null, error: null }
							return { data: { type: 'document', owner_id: 'user-123', is_public: false }, error: null }
						}),
					}),
				}),
			}),
		} as any

		const role = await auth.verifyUserRole(mockSupabase, 'doc-legacy', 'token-1')
		expect(role).toBe('owner')
	})

	it('verifyUserRole returns member role from page_members', async () => {
		const mockSupabase = {
			auth: {
				getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-456' } }, error: null }),
			},
			from: vi.fn().mockImplementation((table: string) => {
				if (table === 'pages') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								maybeSingle: vi.fn().mockResolvedValue({
									data: { type: 'page', owner_id: 'user-123', is_public: false },
									error: null,
								}),
							}),
						}),
					}
				}
				if (table === 'page_members') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								eq: vi.fn().mockReturnValue({
									single: vi.fn().mockResolvedValue({ data: { role: 'editor' }, error: null }),
								}),
							}),
						}),
					}
				}
				return {}
			}),
		} as any

		const role = await auth.verifyUserRole(mockSupabase, 'page-1', 'token-1')
		expect(role).toBe('editor')
	})

	it('getDocumentOwnerPlanLimit reads the owner plan via pages', async () => {
		const mockAdmin = {
			from: vi.fn().mockImplementation((table: string) => {
				if (table === 'pages') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								maybeSingle: vi.fn().mockResolvedValue({
									data: { owner_id: 'user-123' },
									error: null,
								}),
							}),
						}),
					}
				}
				if (table === 'profiles') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								single: vi.fn().mockResolvedValue({ data: { plan: 'pro' }, error: null }),
							}),
						}),
					}
				}
				return {}
			}),
		} as any

		const limit = await auth.getDocumentOwnerPlanLimit(mockAdmin, 'page-1')
		expect(limit).toBe(25)
	})

	it('indexPage writes links, tags and searchable_text via the admin client', async () => {
		const insertedLinks: any[] = []
		const insertedTags: any[] = []
		let pageSelectCalls = 0
		const workspacePagesData = [{ id: 'priya-page', title: 'Priya' }]

		// Builder node that is both directly awaitable (indexPage awaits .eq() for the
		// workspace-pages fetch) and chainable (.maybeSingle() for getWorkspaceForPage).
		const makePageEq = () => ({
			maybeSingle: vi.fn(async () => {
				pageSelectCalls += 1
				if (pageSelectCalls === 1) return { data: { workspace_id: 'ws-1' }, error: null }
				return { data: workspacePagesData, error: null }
			}),
			then: (onfulfilled: any) =>
				Promise.resolve({ data: workspacePagesData, error: null }).then(onfulfilled),
		})

		const admin = {
			from: vi.fn().mockImplementation((table: string) => {
				if (table === 'pages') {
					return {
						select: vi.fn().mockReturnValue({ eq: makePageEq }),
						update: vi.fn().mockReturnValue({
							eq: vi.fn().mockResolvedValue({ data: null, error: null }),
						}),
					}
				}
				if (table === 'page_links') {
					return {
						delete: vi.fn().mockReturnValue({
							eq: vi.fn().mockResolvedValue({ data: null, error: null }),
						}),
						insert: vi.fn().mockImplementation(async (rows: any[]) => {
							insertedLinks.push(...rows)
							return { data: null, error: null }
						}),
					}
				}
				if (table === 'page_tags') {
					return {
						delete: vi.fn().mockReturnValue({
							eq: vi.fn().mockResolvedValue({ data: null, error: null }),
						}),
						insert: vi.fn().mockImplementation(async (rows: any[]) => {
							insertedTags.push(...rows)
							return { data: null, error: null }
						}),
					}
				}
				return {}
			}),
		} as any

		const result = await graphIndex.indexPage(admin, 'page-1', 'Meeting [[Priya]] #work')
		expect(result).toEqual({ links: 1, tags: 1 })
		expect(insertedLinks).toEqual([
			{ workspace_id: 'ws-1', from_page_id: 'page-1', to_page_id: 'priya-page', to_title: 'Priya' },
		])
		expect(insertedTags).toEqual([{ page_id: 'page-1', tag: 'work' }])
		expect(admin.from).toHaveBeenCalledWith('pages')
	})

	it('verifyUserRole returns viewer for anonymous access to a public page', async () => {
		const mockSupabase = {
			from: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockResolvedValue({
							data: { owner_id: 'user-123', is_public: true },
							error: null,
						}),
					}),
				}),
			}),
		} as any

		const role = await auth.verifyUserRole(mockSupabase, 'page-1', 'anonymous')
		expect(role).toBe('viewer')
	})
})
```

Note: the existing `server.test.ts` file already has a `const auth = require('../../server/auth')` at the top — the new describe block adds its own local requires, which is fine.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- tests/unit/server.test.ts`
Expected: the existing tests pass; the new `owner`/`member`/`plan-limit`/`indexPage` tests FAIL (behavior not yet implemented).

- [ ] **Step 3: Rewrite `server/auth.js`**

Replace the entire contents of `server/auth.js`:

```js
const { createClient } = require('@supabase/supabase-js')

function getSupabaseClient(token) {
	const apiKey =
		process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
		process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
		''

	return createClient(
		process.env.NEXT_PUBLIC_SUPABASE_URL,
		apiKey,
		{
			auth: {
				persistSession: false,
				autoRefreshToken: false,
			},
			global: {
				headers: {
					apikey: apiKey,
					Authorization: `Bearer ${token}`,
				},
			},
		}
	)
}

// Resolve an entity (page first, legacy document fallback) to owner + public flag.
async function getEntityOwner(supabase, entityId) {
	const { data: page } = await supabase
		.from('pages')
		.select('owner_id, is_public')
		.eq('id', entityId)
		.maybeSingle()

	if (page) {
		return { type: 'page', owner_id: page.owner_id, is_public: page.is_public }
	}

	const { data: doc } = await supabase
		.from('documents')
		.select('owner_id, is_public')
		.eq('id', entityId)
		.maybeSingle()

	if (doc) {
		return { type: 'document', owner_id: doc.owner_id, is_public: doc.is_public }
	}

	return null
}

async function verifyUserRole(supabase, entityId, token) {
	if (token === 'anonymous') {
		const entity = await getEntityOwner(supabase, entityId)
		if (entity && entity.is_public) {
			return 'viewer'
		}
		return null
	}

	const { data: { user }, error } = await supabase.auth.getUser(token)
	if (error || !user) {
		console.error(`[Auth] getUser failed for ${entityId}:`, error?.message || 'No user found')
		return null
	}

	const entity = await getEntityOwner(supabase, entityId)
	if (!entity) {
		return null
	}

	if (entity.owner_id === user.id) {
		return 'owner'
	}

	if (entity.type === 'page') {
		const { data: member } = await supabase
			.from('page_members')
			.select('role')
			.eq('page_id', entityId)
			.eq('user_id', user.id)
			.single()
		return member ? member.role : null
	}

	const { data: member } = await supabase
		.from('document_members')
		.select('role')
		.eq('document_id', entityId)
		.eq('user_id', user.id)
		.single()

	return member ? member.role : null
}

async function getDocumentOwnerPlanLimit(supabaseAdmin, entityId) {
	try {
		const { data: page } = await supabaseAdmin
			.from('pages')
			.select('owner_id')
			.eq('id', entityId)
			.maybeSingle()

		let ownerId = null
		if (page && page.owner_id) {
			ownerId = page.owner_id
		} else {
			const { data: doc } = await supabaseAdmin
				.from('documents')
				.select('owner_id')
				.eq('id', entityId)
				.maybeSingle()
			ownerId = doc ? doc.owner_id : null
		}

		if (!ownerId) return 2

		const { data: profile } = await supabaseAdmin
			.from('profiles')
			.select('plan')
			.eq('id', ownerId)
			.single()

		const plan = (profile && profile.plan ? profile.plan : 'free').toLowerCase()
		switch (plan) {
			case 'go': return 10
			case 'pro': return 25
			case 'team': return 50
			case 'enterprise': return 9999
			case 'free':
			default: return 2
		}
	} catch {
		return 2
	}
}

module.exports = { getSupabaseClient, getEntityOwner, verifyUserRole, getDocumentOwnerPlanLimit }
```

- [ ] **Step 4: Update `server/index.js` save path**

Replace the body of `saveDocumentState` in `server/index.js` (from the `// 3. Extract text content...` comment to the `clearUpdates` call) with:

```js
		// 3. Extract text content; update pages first, fall back to legacy documents
		const textContent = ydoc.getText('default').toString()
		const { data: pageRow } = await supabaseAdmin
			.from('pages')
			.select('id')
			.eq('id', documentId)
			.maybeSingle()

		if (pageRow) {
			await supabaseAdmin
				.from('pages')
				.update({
					searchable_text: textContent,
					updated_at: new Date().toISOString(),
				})
				.eq('id', documentId)

			await indexPage(supabaseAdmin, documentId, textContent)
		} else {
			const { error: dbError } = await supabaseAdmin
				.from('documents')
				.update({
					searchable_text: textContent,
					updated_at: new Date().toISOString(),
				})
				.eq('id', documentId)

			if (dbError) {
				throw dbError
			}
		}
```

And update the require block at the top of `server/index.js`:

```js
const { appendUpdate, getPendingUpdates, clearUpdates } = require('./wal')
const { indexPage } = require('./graph-index')
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test -- tests/unit/server.test.ts`
Expected: PASS — all existing plus 7 new tests.

- [ ] **Step 6: Run lint and the full suite**

Run: `npm run lint && npm run test`
Expected: clean lint, all tests pass.

- [ ] **Step 7: Manual smoke check of the cutover**

Start the sync server (`npm run server`) and the app (`npm run dev`); open an existing document in the editor, type text containing `[[Some Page]]` and `#work`, wait for the debounced save (3s), then verify in the SQL editor:

```sql
SELECT searchable_text FROM public.pages WHERE id = '<document-id>';
SELECT * FROM public.page_links WHERE from_page_id = '<document-id>';
SELECT * FROM public.page_tags WHERE page_id = '<document-id>';
```

Expected: searchable_text updated, a `page_links` row for `Some Page` (to_page_id null if the target doesn't exist yet), a `page_tags` row for `work`.

- [ ] **Step 8: Commit**

```bash
git add server/auth.js server/index.js tests/unit/server.test.ts
git commit -m "feat(sync): cut over auth and saves to pages with legacy fallback and graph indexing"
```

---

## Self-Review Notes

- **Spec coverage:** Section 3 tables (`workspaces`, `pages`, `page_links`, `page_tags` + members) — Task 1; progressive migration + rollback path — Global Constraints + Task 1 backfill with `source_document_id`; graph index service consuming the Yjs update stream — Task 3 + Task 5 (called from `saveDocumentState` on the debounced save, the same hook that feeds `searchable_text`); client service layer for later UI work — Task 4; server cutover — Task 5. Out of scope (per spec, P2): dashboard UI, tree rendering, backlink pane, markdown import, provider registry, billing, i18n, docs site.
- **Placeholders:** none — every step has concrete code.
- **Type consistency:** `extractLinks` → `{title, alias}` in Tasks 2/3/5; `indexPage(admin, pageId, text)` signature identical in Tasks 3 and 5; `verifyUserRole`/`getDocumentOwnerPlanLimit` signatures unchanged from current `server/auth.js`; `getEntityOwner` return shape `{type, owner_id, is_public}` used consistently in Task 5.
