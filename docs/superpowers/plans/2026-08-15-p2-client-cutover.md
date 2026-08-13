# P2: Client Cutover onto the Pages Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the entire client (dashboard, editor, share modal, invitations, settings, version history) from the legacy `documents`/`document_members`/`document_invitations`/`document_versions` data flow onto `pages`/`page_members`/`page_invitations`, after making auth and RLS agree on page-only authority.

**Architecture:** One migration (`20260815000000_page_only_authority.sql`) rewrites `can_access_page` (owner OR public OR `page_members`), restores the pages branch of `can_access_document_storage` (dropped in P1's `20260814000002`), adds `page_id` to `document_versions` with pages-aware policies, creates `page_invitations` with RLS, extends `page_members` (owner-only update policy + invitee self-insert), and converts pending legacy invites. The sync server's `verifyUserRole` drops the live `document_members` fallback (page-only authority; authenticated strangers get `viewer` on public pages). A client service layer extends `services/graph.ts`; then each UI surface swaps its data source while preserving UX. Legacy tables stay in the DB as the rollback path; the `deletePage`/`updatePagePublicStatus` documents mirrors are retained.

**Tech Stack:** Next.js 16 + React 19, Supabase (Postgres + Storage + RLS), CommonJS sync server (y-websocket/yjs), Vitest (jsdom, globals: true, setup `tests/unit/setup.ts`), Tailwind/shadcn-style components, lucide-react, sonner.

## Global Constraints

- Legacy `documents`/`document_members`/`document_invitations` tables are **never dropped or altered destructively** — they remain as the rollback path.
- Migration file naming: `supabase/migrations/20260815000000_<name>.sql`. **Never edit already-applied migration files.**
- Server files (`server/*.js`) are CommonJS. Client code is TypeScript ES modules.
- Client DB access goes through the `supabase` singleton from `lib/supabase.ts`.
- AI credits/plan helpers (`getUserAICredits`, `getPlanCollaboratorLimit`, `getPlanMaxDocuments`, `deductUserAICredits`) stay in `services/db.ts` and keep working — they are NOT retired in P2.
- Storage bucket object path stays `{entityId}/main_state.bin`; page ids are the storage keys.
- Verification gates for EVERY task: `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"` (npm not on PATH), then focused vitest files ONLY (full `npm run test` OOMs/hangs on this machine), `npm run lint`, and `npm run build` (P1 lesson: vitest + eslint never type-check — `next build` is mandatory for any TS/TSX change).
- SQL verification: migrations are applied to the live project `hftipkzqbltdkrcjynad` via Supabase MCP `apply_migration` by the controller (implementers write the file only); live RLS verification uses observable SELECTs (`SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims', ..., true)`) — RAISE NOTICE is invisible in MCP output.
- plpgsql: default `variable_conflict` is `error` — never name a plpgsql variable after a column in a table the function queries (42702).
- All work happens on branch `p2-client-cutover` (already created off `main@d8679ea`; spec committed at `d4c706a`).

---

### Task 1: Foundation migration — page-only authority, page invites, pages-aware versions

**Files:**
- Create: `supabase/migrations/20260815000000_page_only_authority.sql`

**Interfaces:**
- Produces: `public.can_access_page(uuid)` (owner OR public OR `page_members`); `public.can_access_document_storage(text, text)` (pages branch restored); `public.document_versions.page_id uuid` + pages-aware select/insert/delete policies; `public.page_invitations` table + RLS (select: owner OR invitee; insert: owner; update: owner OR inviter OR invitee; delete: owner); `page_members` update policy (owner) + insert policy extended for invitee self-insert; pending `document_invitations` → `page_invitations` conversion.
- Consumes: P1 schema (`pages.source_document_id`, `page_members`, `member_role`/`invitation_status` enums, `can_access_document_storage`).

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260815000000_page_only_authority.sql` with exactly this content:

```sql
-- P2 page-only authority: pages are governed by owner/page_members/public only.
-- Legacy document_members no longer grant anything on pages (client cutover).
-- Also: page_invitations table, pages-aware document_versions, storage pages branch.

-- 1. can_access_page: owner OR is_public OR page_members (source_document_id/document_members branch REMOVED)
CREATE OR REPLACE FUNCTION public.can_access_page(target_page_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
	v_uid uuid;
BEGIN
	v_uid := auth.uid();
	IF v_uid IS NULL THEN
		RETURN false;
	END IF;
	RETURN EXISTS (
		SELECT 1 FROM public.pages p
		WHERE p.id = target_page_id
		AND (
			p.owner_id = v_uid
			OR p.is_public = true
			OR EXISTS (
				SELECT 1 FROM public.page_members m
				WHERE m.page_id = p.id AND m.user_id = v_uid
			)
		)
	);
END;
$$;

-- 2. can_access_document_storage: restore the pages branch (dropped in
-- 20260814000002), keeping the documents branch for legacy objects.
-- Resolve the entity id from the first path segment, then dispatch on whether
-- a pages row exists for it. Select: owner/public/page_members (pages) or
-- owner/public/document_members (documents). Insert/update: owner or editor
-- member. Delete: owner only.
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
	entity_id_text text;
	v_uid uuid;
	v_is_page boolean;
BEGIN
	v_uid := auth.uid();
	IF v_uid IS NULL THEN
		RETURN false;
	END IF;

	entity_id_text := (storage.foldername(object_name))[1];
	IF entity_id_text IS NULL OR entity_id_text = '' THEN
		entity_id_text := split_part(object_name, '/', 1);
	END IF;

	v_is_page := EXISTS (
		SELECT 1 FROM public.pages p WHERE p.id::text = entity_id_text
	);

	IF v_is_page THEN
		IF action = 'select' THEN
			RETURN EXISTS (
				SELECT 1 FROM public.pages p
				WHERE p.id::text = entity_id_text
				AND (
					p.owner_id = v_uid
					OR p.is_public = true
					OR EXISTS (
						SELECT 1 FROM public.page_members m
						WHERE m.page_id = p.id AND m.user_id = v_uid
					)
				)
			);
		ELSIF action IN ('insert', 'update') THEN
			RETURN EXISTS (
				SELECT 1 FROM public.pages p
				WHERE p.id::text = entity_id_text
				AND (
					p.owner_id = v_uid
					OR EXISTS (
						SELECT 1 FROM public.page_members m
						WHERE m.page_id = p.id AND m.user_id = v_uid AND m.role = 'editor'
					)
				)
			);
		ELSIF action = 'delete' THEN
			RETURN EXISTS (
				SELECT 1 FROM public.pages p
				WHERE p.id::text = entity_id_text AND p.owner_id = v_uid
			);
		END IF;
	ELSE
		IF action = 'select' THEN
			RETURN EXISTS (
				SELECT 1 FROM public.documents d
				WHERE d.id::text = entity_id_text
				AND (
					d.owner_id = v_uid
					OR d.is_public = true
					OR EXISTS (
						SELECT 1 FROM public.document_members m
						WHERE m.document_id = d.id AND m.user_id = v_uid
					)
				)
			);
		ELSIF action IN ('insert', 'update') THEN
			RETURN EXISTS (
				SELECT 1 FROM public.documents d
				WHERE d.id::text = entity_id_text
				AND (
					d.owner_id = v_uid
					OR EXISTS (
						SELECT 1 FROM public.document_members m
						WHERE m.document_id = d.id AND m.user_id = v_uid AND m.role = 'editor'
					)
				)
			);
		ELSIF action = 'delete' THEN
			RETURN EXISTS (
				SELECT 1 FROM public.documents d
				WHERE d.id::text = entity_id_text AND d.owner_id = v_uid
			);
		END IF;
	END IF;

	RETURN false;
END;
$$;

-- 3. document_versions: nullable page_id FK (twin-less pages can hold versions);
-- document_id stays NOT NULL for legacy rows written before the cutover.
ALTER TABLE public.document_versions
	ADD COLUMN IF NOT EXISTS page_id UUID REFERENCES public.pages(id) ON DELETE CASCADE;

DROP POLICY IF EXISTS select_versions ON public.document_versions;
CREATE POLICY select_versions ON public.document_versions
FOR SELECT USING (
	EXISTS (
		SELECT 1 FROM public.pages p
		WHERE p.id = page_id
		AND (
			p.owner_id = auth.uid()
			OR EXISTS (
				SELECT 1 FROM public.page_members m
				WHERE m.page_id = p.id AND m.user_id = auth.uid()
			)
		)
	)
	OR EXISTS (
		SELECT 1 FROM public.documents d
		WHERE d.id = document_id
		AND (
			d.owner_id = auth.uid()
			OR EXISTS (
				SELECT 1 FROM public.document_members m
				WHERE m.document_id = d.id AND m.user_id = auth.uid()
			)
		)
	)
);

DROP POLICY IF EXISTS insert_versions ON public.document_versions;
CREATE POLICY insert_versions ON public.document_versions
FOR INSERT WITH CHECK (
	EXISTS (
		SELECT 1 FROM public.pages p
		WHERE p.id = page_id
		AND (
			p.owner_id = auth.uid()
			OR EXISTS (
				SELECT 1 FROM public.page_members m
				WHERE m.page_id = p.id AND m.user_id = auth.uid() AND m.role = 'editor'
			)
		)
	)
	OR EXISTS (
		SELECT 1 FROM public.documents d
		WHERE d.id = document_id
		AND (
			d.owner_id = auth.uid()
			OR EXISTS (
				SELECT 1 FROM public.document_members m
				WHERE m.document_id = d.id AND m.user_id = auth.uid() AND m.role = 'editor'
			)
		)
	)
);

DROP POLICY IF EXISTS delete_versions ON public.document_versions;
CREATE POLICY delete_versions ON public.document_versions
FOR DELETE USING (
	EXISTS (
		SELECT 1 FROM public.pages p
		WHERE p.id = page_id AND p.owner_id = auth.uid()
	)
	OR EXISTS (
		SELECT 1 FROM public.documents d
		WHERE d.id = document_id AND d.owner_id = auth.uid()
	)
);

-- 4. page_invitations: page-level invite/accept flow (mirror of document_invitations)
CREATE TABLE IF NOT EXISTS public.page_invitations (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	page_id UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
	inviter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
	invitee_email TEXT NOT NULL,
	role member_role NOT NULL,
	token UUID NOT NULL DEFAULT gen_random_uuid(),
	status invitation_status DEFAULT 'pending' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.page_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS select_page_invitations ON public.page_invitations;
CREATE POLICY select_page_invitations ON public.page_invitations
FOR SELECT TO authenticated USING (
	EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
	OR invitee_email = (SELECT email FROM public.profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS insert_page_invitations ON public.page_invitations;
CREATE POLICY insert_page_invitations ON public.page_invitations
FOR INSERT TO authenticated WITH CHECK (
	EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
);

DROP POLICY IF EXISTS update_page_invitations ON public.page_invitations;
CREATE POLICY update_page_invitations ON public.page_invitations
FOR UPDATE TO authenticated USING (
	EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
	OR inviter_id = auth.uid()
	OR invitee_email = (SELECT email FROM public.profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS delete_page_invitations ON public.page_invitations;
CREATE POLICY delete_page_invitations ON public.page_invitations
FOR DELETE TO authenticated USING (
	EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
);

-- 5. page_members: owner-only role-change policy; insert extended for invitee
-- self-insert on acceptance of a pending page invitation (mirrors legacy).
DROP POLICY IF EXISTS insert_page_members ON public.page_members;
CREATE POLICY insert_page_members ON public.page_members
FOR INSERT TO authenticated WITH CHECK (
	EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
	OR (
		user_id = auth.uid()
		AND EXISTS (
			SELECT 1 FROM public.page_invitations pi
			WHERE pi.page_id = page_id
			AND pi.invitee_email = (SELECT email FROM public.profiles WHERE id = auth.uid())
			AND pi.status = 'pending'
		)
	)
);

DROP POLICY IF EXISTS update_page_members ON public.page_members;
CREATE POLICY update_page_members ON public.page_members
FOR UPDATE TO authenticated USING (
	EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
);

-- 6. Convert pending legacy invites so in-flight invite links keep working.
INSERT INTO public.page_invitations (page_id, inviter_id, invitee_email, role, token, status, created_at)
SELECT p.id, di.inviter_id, di.invitee_email, di.role, di.token, di.status, di.created_at
FROM public.document_invitations di
JOIN public.pages p ON p.source_document_id = di.document_id
WHERE di.status = 'pending'
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Syntax check the file**

Run: `node --check` does not apply to SQL. Instead verify balanced statements: `awk '/^[[:space:]]*$/{next} {if ($0 ~ /;\s*$/) c++} END {print c " statement-enders"}' supabase/migrations/20260815000000_page_only_authority.sql`
Expected: 6 blocks — 2 `CREATE OR REPLACE FUNCTION`, 1 `ALTER TABLE`, 6 `CREATE POLICY`, 1 `CREATE TABLE`, 1 `INSERT`. Review the output count is sane (≥ 10).

- [ ] **Step 3: Controller gate — apply the migration to the live project via Supabase MCP**

Run (controller, NOT the implementer): `supabase_apply_migration` with name `page_only_authority` and the file content from Step 1.
Expected: success (migration `20260815000000` recorded on project `hftipkzqbltdkrcjynad`).

- [ ] **Step 4: Controller gate — verify schema landed**

Run: `supabase_list_tables` (verbose, schema `public`) and confirm: `page_invitations` exists; `document_versions` has `page_id`; `page_members` has an update policy.
Also run `supabase_execute_sql`:
```sql
SELECT proname, prosrc LIKE '%document_members%' AS references_doc_members
FROM pg_proc WHERE proname = 'can_access_page';
```
Expected: `can_access_page` → `references_doc_members = false`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260815000000_page_only_authority.sql
git commit -m "feat(db): page-only authority, page invitations, pages-aware version history"
```

---

### Task 2: Server auth — page-only authority in verifyUserRole

**Files:**
- Modify: `server/auth.js:76-107` (page branch of `verifyUserRole`)
- Test: `tests/unit/server.test.ts` (replace 2 tests in the pages suite)

**Interfaces:**
- Consumes: `getEntityOwner(supabase, entityId)` (unchanged — pages first, documents fallback).
- Produces: `verifyUserRole(supabase, entityId, token)` where a page entity resolves to: `'owner'` (owner short-circuit, unchanged) → `page_members.role` → `'viewer'` when `is_public` (authenticated non-members) → `null`. The live `document_members` fallback is GONE.

- [ ] **Step 1: Rewrite the failing tests**

In `tests/unit/server.test.ts`, delete the two tests `verifyUserRole honors live document_members grants on mapped pages after migration` and `verifyUserRole denies a mapped page after the document_members grant is revoked` (lines ~216-316) and replace them with exactly:

```ts
	it('verifyUserRole ignores document_members grants on mapped pages (page-only authority)', async () => {
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
									single: vi.fn().mockResolvedValue({ data: null, error: null }),
								}),
							}),
						}),
					}
				}
				return {}
			}),
		} as any

		const role = await auth.verifyUserRole(mockSupabase, 'page-1', 'token-1')
		expect(role).toBeNull()
	})

	it('verifyUserRole grants "viewer" to an authenticated non-member on a public page', async () => {
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
									data: { type: 'page', owner_id: 'user-123', is_public: true },
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
									single: vi.fn().mockResolvedValue({ data: null, error: null }),
								}),
							}),
						}),
					}
				}
				return {}
			}),
		} as any

		const role = await auth.verifyUserRole(mockSupabase, 'page-1', 'token-1')
		expect(role).toBe('viewer')
	})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" && npm run test -- tests/unit/server.test.ts`
Expected: the two NEW tests fail (`verifyUserRole` still returns `'editor'`/`null` from the legacy fallback paths); no other test regressions.

- [ ] **Step 3: Implement the page-only authority**

In `server/auth.js`, replace the whole page branch (currently lines 76-107: `if (entity.type === 'page') { ... return null }`) with:

```js
	if (entity.type === 'page') {
		const { data: member } = await supabase
			.from('page_members')
			.select('role')
			.eq('page_id', entityId)
			.eq('user_id', user.id)
			.single()
		if (member) {
			return member.role
		}

		// Page-only authority (P2): page_members is the sole membership source
		// for pages — the legacy document_members fallback was removed so the
		// sync server's role verdict always matches page RLS (can_access_page).
		// Authenticated non-members get read-only access to public pages,
		// matching RLS (previously they were denied while anon could read).
		if (entity.is_public) {
			return 'viewer'
		}

		return null
	}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/unit/server.test.ts`
Expected: 15/15 pass (the two replacements green; `anonymous viewer on public page`, owner, page_members, documents-fallback tests unchanged).

- [ ] **Step 5: Syntax check + lint + build**

Run: `node --check server/auth.js && npm run lint && npm run build`
Expected: all green. (`npm run build` = `next build`; catches TS errors across the app.)

- [ ] **Step 6: Commit**

```bash
git add server/auth.js tests/unit/server.test.ts
git commit -m "fix(auth): page-only authority in verifyUserRole, public pages grant viewer to authenticated strangers"
```

---

### Task 3: Client types + graph service layer

**Files:**
- Modify: `types/index.ts` (add types; fix `PageLink.workspace_id`; `DocumentVersion.page_id`)
- Modify: `services/graph.ts` (add 14 functions)
- Test: `tests/unit/db-graph.test.ts` (extend builder + new describe)

**Interfaces:**
- Consumes: `fetchPageDetails(pageId): Promise<Page>` (exists); `getUserAICredits`/`getPlanCollaboratorLimit` from `@/services/db` (exist, unchanged).
- Produces (all `Promise`-based, throw on Supabase error, same style as existing graph.ts):
  - `ensureWorkspace(userId: string): Promise<Workspace>`
  - `fetchSharedPages(userId: string): Promise<MemberPageItem[]>`
  - `fetchPageMemberRole(pageId: string, userId: string): Promise<MemberRole | null>`
  - `fetchPageMembers(pageId: string): Promise<PageMember[]>`
  - `removePageMember(pageId: string, userId: string): Promise<void>`
  - `updatePageMemberRole(pageId: string, userId: string, role: 'editor' | 'viewer'): Promise<void>`
  - `createPageInvitation(pageId: string, inviterId: string, inviteeEmail: string, role: 'editor' | 'viewer', token: string): Promise<void>`
  - `fetchPendingPageInvitations(email: string): Promise<PageInvitation[]>`
  - `acceptPageInvitation(invite: PageInvitation, userId: string): Promise<void>`
  - `declinePageInvitation(inviteId: string): Promise<void>`
  - `fetchPageInvitationDetails(token: string): Promise<PageInvitation>`
  - `fetchMentionablePageCollaborators(pageId: string): Promise<Array<{ id: string; email: string; full_name: string; avatar_url?: string }>>`
  - `fetchOwnedPagesWithMembers(userId: string): Promise<(Page & { page_members: PageMember[] })[]>`
  - `fetchVersionsForEntity(entityId: string): Promise<DocumentVersion[]>`

- [ ] **Step 1: Write the failing tests**

In `tests/unit/db-graph.test.ts`, extend the mock builder (lines 16-32) to:

```ts
vi.mock('@/lib/supabase', () => {
	const builder: any = {
		select: vi.fn().mockReturnThis(),
		insert: vi.fn().mockReturnThis(),
		update: vi.fn().mockReturnThis(),
		delete: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		in: vi.fn().mockReturnThis(),
		order: vi.fn().mockReturnThis(),
		or: vi.fn().mockReturnThis(),
		single: vi.fn().mockResolvedValue({ data: null, error: null }),
		maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
		then: vi.fn((cb) => Promise.resolve({ data: [], count: 0, error: null }).then(cb)),
	}
	return {
		supabase: {
			from: vi.fn(() => builder),
		},
	}
})
```

Update `beforeEach` (lines 37-47) to also reset `in`, `or`, `maybeSingle`:
```ts
	beforeEach(() => {
		vi.clearAllMocks()
		mockBuilder.select.mockReturnThis()
		mockBuilder.insert.mockReturnThis()
		mockBuilder.update.mockReturnThis()
		mockBuilder.delete.mockReturnThis()
		mockBuilder.eq.mockReturnThis()
		mockBuilder.in.mockReturnThis()
		mockBuilder.order.mockReturnThis()
		mockBuilder.or.mockReturnThis()
		mockBuilder.single.mockResolvedValue({ data: null, error: null })
		mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null })
		mockBuilder.then.mockImplementation((cb: any) => Promise.resolve({ data: [], count: 0, error: null }).then(cb))
	})
```

Update the import block (lines 3-14) to add the new functions:
```ts
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
	ensureWorkspace,
	fetchSharedPages,
	fetchPageMemberRole,
	fetchPageMembers,
	removePageMember,
	updatePageMemberRole,
	createPageInvitation,
	fetchPendingPageInvitations,
	acceptPageInvitation,
	declinePageInvitation,
	fetchPageInvitationDetails,
	fetchMentionablePageCollaborators,
	fetchOwnedPagesWithMembers,
	fetchVersionsForEntity,
} from '@/services/graph'
```

Append this describe block at the end of the file (after line 164):

```ts
describe('Graph Service P2 additions', () => {
	it('ensureWorkspace returns an existing workspace', async () => {
		const ws = { id: 'ws-1', name: 'My Workspace', owner_id: 'user-123', is_team: false, created_at: '', updated_at: '' }
		mockBuilder.maybeSingle.mockResolvedValue({ data: ws, error: null })
		const result = await ensureWorkspace('user-123')
		expect(supabase.from).toHaveBeenCalledWith('workspaces')
		expect(mockBuilder.eq).toHaveBeenCalledWith('owner_id', 'user-123')
		expect(result).toEqual(ws)
	})

	it('ensureWorkspace inserts a workspace when none exists', async () => {
		mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null })
		mockBuilder.single.mockResolvedValue({ data: { id: 'ws-2', owner_id: 'user-123' }, error: null })
		const result = await ensureWorkspace('user-123')
		expect(mockBuilder.insert).toHaveBeenCalledWith({ owner_id: 'user-123' })
		expect(result).toEqual({ id: 'ws-2', owner_id: 'user-123' })
	})

	it('ensureWorkspace refetches when a concurrent insert hits a unique violation', async () => {
		mockBuilder.maybeSingle
			.mockResolvedValueOnce({ data: null, error: null })
			.mockResolvedValueOnce({ data: { id: 'ws-3', owner_id: 'user-123' }, error: null })
		mockBuilder.single.mockResolvedValue({
			data: null,
			error: { code: '23505', message: 'duplicate key value violates unique constraint' },
		})
		const result = await ensureWorkspace('user-123')
		expect(result).toEqual({ id: 'ws-3', owner_id: 'user-123' })
	})

	it('fetchSharedPages queries page_members with page embed', async () => {
		const shared = [{ role: 'editor', pages: { id: 'p-1', title: 'A' } }]
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ data: shared, error: null }).then(onfulfilled)
		)
		const result = await fetchSharedPages('user-123')
		expect(supabase.from).toHaveBeenCalledWith('page_members')
		expect(mockBuilder.eq).toHaveBeenCalledWith('user_id', 'user-123')
		expect(result).toEqual(shared)
	})

	it('fetchPageMemberRole returns the role for a member', async () => {
		mockBuilder.single.mockResolvedValue({ data: { role: 'viewer' }, error: null })
		const role = await fetchPageMemberRole('p-1', 'user-123')
		expect(supabase.from).toHaveBeenCalledWith('page_members')
		expect(role).toBe('viewer')
	})

	it('fetchPageMemberRole returns null on error', async () => {
		mockBuilder.single.mockResolvedValue({ data: null, error: { message: 'no rows' } })
		const role = await fetchPageMemberRole('p-1', 'user-123')
		expect(role).toBeNull()
	})

	it('fetchPageMembers returns members with profile embed', async () => {
		const members = [{ id: 'm-1', page_id: 'p-1', user_id: 'u-1', role: 'editor' }]
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ data: members, error: null }).then(onfulfilled)
		)
		const result = await fetchPageMembers('p-1')
		expect(supabase.from).toHaveBeenCalledWith('page_members')
		expect(mockBuilder.eq).toHaveBeenCalledWith('page_id', 'p-1')
		expect(result).toEqual(members)
	})

	it('removePageMember deletes the membership', async () => {
		await removePageMember('p-1', 'u-9')
		expect(supabase.from).toHaveBeenCalledWith('page_members')
		expect(mockBuilder.delete).toHaveBeenCalled()
		expect(mockBuilder.eq).toHaveBeenCalledWith('page_id', 'p-1')
		expect(mockBuilder.eq).toHaveBeenCalledWith('user_id', 'u-9')
	})

	it('updatePageMemberRole updates the role', async () => {
		await updatePageMemberRole('p-1', 'u-9', 'viewer')
		expect(mockBuilder.update).toHaveBeenCalledWith({ role: 'viewer' })
		expect(mockBuilder.eq).toHaveBeenCalledWith('page_id', 'p-1')
		expect(mockBuilder.eq).toHaveBeenCalledWith('user_id', 'u-9')
	})

	it('createPageInvitation counts members and pending invites against the plan limit', async () => {
		mockBuilder.single.mockResolvedValue({ data: { id: 'p-1', owner_id: 'owner-1' }, error: null })
		let counts = 0
		mockBuilder.then.mockImplementation((onfulfilled: any) =>
			Promise.resolve({ data: [], count: counts++, error: null }).then(onfulfilled)
		)
		await createPageInvitation('p-1', 'owner-1', 'x@test.com', 'viewer', 'tok-1')
		expect(supabase.from).toHaveBeenCalledWith('page_invitations')
		expect(mockBuilder.insert).toHaveBeenCalledWith({
			page_id: 'p-1',
			inviter_id: 'owner-1',
			invitee_email: 'x@test.com',
			role: 'viewer',
			token: 'tok-1',
			status: 'pending',
		})
	})

	it('fetchPendingPageInvitations filters by email and pending status', async () => {
		const invites = [{ id: 'i-1', page_id: 'p-1', role: 'editor' }]
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ data: invites, error: null }).then(onfulfilled)
		)
		const result = await fetchPendingPageInvitations('x@test.com')
		expect(supabase.from).toHaveBeenCalledWith('page_invitations')
		expect(mockBuilder.eq).toHaveBeenCalledWith('invitee_email', 'x@test.com')
		expect(mockBuilder.eq).toHaveBeenCalledWith('status', 'pending')
		expect(result).toEqual(invites)
	})

	it('acceptPageInvitation inserts a member then marks the invite accepted', async () => {
		const invite = { id: 'i-1', page_id: 'p-1', role: 'editor' } as PageInvitation
		mockBuilder.single.mockResolvedValue({ data: { id: 'p-1', owner_id: 'owner-1' }, error: null })
		mockBuilder.then.mockResolvedValue({ data: [], count: 0, error: null })
		await acceptPageInvitation(invite, 'user-123')
		expect(mockBuilder.insert).toHaveBeenCalledWith({ page_id: 'p-1', user_id: 'user-123', role: 'editor' })
		expect(mockBuilder.update).toHaveBeenCalledWith({ status: 'accepted' })
		expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'i-1')
	})

	it('declinePageInvitation marks the invite declined', async () => {
		await declinePageInvitation('i-1')
		expect(mockBuilder.update).toHaveBeenCalledWith({ status: 'declined' })
		expect(mockBuilder.eq).toHaveBeenCalledWith('id', 'i-1')
	})

	it('fetchPageInvitationDetails fetches by token', async () => {
		const invite = { id: 'i-1', page_id: 'p-1', token: 'tok-1' }
		mockBuilder.single.mockResolvedValue({ data: invite, error: null })
		const result = await fetchPageInvitationDetails('tok-1')
		expect(supabase.from).toHaveBeenCalledWith('page_invitations')
		expect(mockBuilder.eq).toHaveBeenCalledWith('token', 'tok-1')
		expect(result).toEqual(invite)
	})

	it('fetchMentionablePageCollaborators returns owner and editor members', async () => {
		let calls = 0
		mockBuilder.then.mockImplementation((onfulfilled: any) => {
			calls += 1
			const payload = calls === 1
				? { data: { owner_id: 'owner-1', profiles: { id: 'owner-1', email: 'o@test.com', full_name: 'Owner' } }, error: null }
				: { data: [{ role: 'editor', profiles: { id: 'ed-1', email: 'e@test.com', full_name: 'Editor' } }], error: null }
			return Promise.resolve(payload).then(onfulfilled)
		})
		const result = await fetchMentionablePageCollaborators('p-1')
		expect(supabase.from).toHaveBeenCalledWith('pages')
		expect(supabase.from).toHaveBeenCalledWith('page_members')
		expect(result).toEqual([
			{ id: 'owner-1', email: 'o@test.com', full_name: 'Owner' },
			{ id: 'ed-1', email: 'e@test.com', full_name: 'Editor' },
		])
	})

	it('fetchOwnedPagesWithMembers embeds page members', async () => {
		const pages = [{ id: 'p-1', page_members: [{ id: 'm-1', user_id: 'u-1', role: 'editor' }] }]
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ data: pages, error: null }).then(onfulfilled)
		)
		const result = await fetchOwnedPagesWithMembers('user-123')
		expect(supabase.from).toHaveBeenCalledWith('pages')
		expect(mockBuilder.eq).toHaveBeenCalledWith('owner_id', 'user-123')
		expect(result).toEqual(pages)
	})

	it('fetchVersionsForEntity queries page_id OR document_id', async () => {
		const versions = [{ id: 'v-1', version_name: 'Draft' }]
		mockBuilder.then.mockImplementationOnce((onfulfilled: any) =>
			Promise.resolve({ data: versions, error: null }).then(onfulfilled)
		)
		const result = await fetchVersionsForEntity('p-1')
		expect(supabase.from).toHaveBeenCalledWith('document_versions')
		expect(mockBuilder.or).toHaveBeenCalledWith('page_id.eq.p-1,document_id.eq.p-1')
		expect(result).toEqual(versions)
	})
})
```

Add the import of `PageInvitation` at the top of the file: `import { PageInvitation } from '@/types'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" && npm run test -- tests/unit/db-graph.test.ts`
Expected: the P2 additions block fails (functions don't exist); existing 10 tests still pass.

- [ ] **Step 3: Implement the types**

In `types/index.ts`:

(a) Add `workspace_id: string` to `PageLink` (after `id`):
```ts
export interface PageLink {
	id: string
	workspace_id: string
	from_page_id: string
	to_page_id: string | null
	to_title: string
	block_id: string | null
	created_at: string
}
```

(b) Add `page_id?: string | null` to `DocumentVersion`:
```ts
export interface DocumentVersion {
	id: string
	document_id: string
	page_id?: string | null
	version_name: string
	created_at: string
	created_by: string
	profiles?: { email: string; full_name: string | null }
}
```

(c) Append after `Backlink`:
```ts
export type MemberRole = 'owner' | 'editor' | 'viewer'

export interface PageMember {
	id: string
	page_id: string
	user_id: string
	role: MemberRole
	created_at: string
	profiles?: { id: string; email: string; full_name: string | null; avatar_url?: string | null }
}

export interface PageInvitation {
	id: string
	page_id: string
	inviter_id: string
	invitee_email: string
	role: 'editor' | 'viewer'
	token: string
	status: 'pending' | 'accepted' | 'declined'
	created_at: string
	pages?: { title: string }
	profiles?: { email: string; full_name: string | null }
}

export interface MemberPageItem {
	role: MemberRole
	pages: Page
}
```

- [ ] **Step 4: Implement the service functions**

In `services/graph.ts`, update the import (line 2) to:
```ts
import { Backlink, DocumentVersion, MemberPageItem, Page, PageInvitation, PageLink, PageMember, PageTag, Workspace } from '@/types'
import { getPlanCollaboratorLimit, getUserAICredits } from '@/services/db'
```

Append these functions at the end of the file:

```ts
export async function ensureWorkspace (userId: string): Promise<Workspace> {
	const { data: existing, error: fetchError } = await supabase
		.from('workspaces')
		.select('*')
		.eq('owner_id', userId)
		.maybeSingle()

	if (fetchError) {
		throw fetchError
	}
	if (existing) {
		return existing as Workspace
	}

	const { data, error } = await supabase
		.from('workspaces')
		.insert({ owner_id: userId })
		.select()
		.single()

	if (error && error.code !== '23505') {
		throw error
	}
	if (data) {
		return data as Workspace
	}

	// 23505: another tab created the workspace first — fetch it.
	const { data: retry, error: retryError } = await supabase
		.from('workspaces')
		.select('*')
		.eq('owner_id', userId)
		.single()

	if (retryError) {
		throw retryError
	}
	return retry as Workspace
}

export async function fetchSharedPages (userId: string): Promise<MemberPageItem[]> {
	const { data, error } = await supabase
		.from('page_members')
		.select('role, pages (*)')
		.eq('user_id', userId)

	if (error) {
		throw error
	}
	return (data as unknown as MemberPageItem[]) || []
}

export async function fetchPageMemberRole (pageId: string, userId: string): Promise<MemberRole | null> {
	const { data, error } = await supabase
		.from('page_members')
		.select('role')
		.eq('page_id', pageId)
		.eq('user_id', userId)
		.single()

	if (error) {
		return null
	}
	return data ? (data.role as MemberRole) : null
}

export async function fetchPageMembers (pageId: string): Promise<PageMember[]> {
	const { data, error } = await supabase
		.from('page_members')
		.select('*, profiles:user_id (id, email, full_name, avatar_url)')
		.eq('page_id', pageId)
		.order('created_at', { ascending: true })

	if (error) {
		throw error
	}
	return (data as unknown as PageMember[]) || []
}

export async function removePageMember (pageId: string, userId: string): Promise<void> {
	const { error } = await supabase
		.from('page_members')
		.delete()
		.eq('page_id', pageId)
		.eq('user_id', userId)

	if (error) {
		throw error
	}
}

export async function updatePageMemberRole (pageId: string, userId: string, role: 'editor' | 'viewer'): Promise<void> {
	const { error } = await supabase
		.from('page_members')
		.update({ role })
		.eq('page_id', pageId)
		.eq('user_id', userId)

	if (error) {
		throw error
	}
}

export async function createPageInvitation (
	pageId: string,
	inviterId: string,
	inviteeEmail: string,
	role: 'editor' | 'viewer',
	token: string
): Promise<void> {
	try {
		const pageDetails = await fetchPageDetails(pageId)
		const ownerCredits = await getUserAICredits(pageDetails.owner_id)
		const allowedLimit = getPlanCollaboratorLimit(ownerCredits.plan)

		const { count: memberCount } = await supabase
			.from('page_members')
			.select('*', { count: 'exact', head: true })
			.eq('page_id', pageId)

		const { count: inviteCount } = await supabase
			.from('page_invitations')
			.select('*', { count: 'exact', head: true })
			.eq('page_id', pageId)
			.eq('status', 'pending')

		const totalCount = (memberCount || 0) + (inviteCount || 0)

		if (totalCount >= allowedLimit) {
			throw new Error(`Collaborator limit reached for page owner's ${ownerCredits.plan.toUpperCase()} plan (max ${allowedLimit}). Upgrade plan to add more collaborators.`)
		}
	} catch (e: any) {
		if (e.message && e.message.includes('Collaborator limit reached')) {
			throw e
		}
	}

	const { error } = await supabase
		.from('page_invitations')
		.insert({
			page_id: pageId,
			inviter_id: inviterId,
			invitee_email: inviteeEmail,
			role,
			token,
			status: 'pending',
		})

	if (error) {
		throw error
	}
}

export async function fetchPendingPageInvitations (email: string): Promise<PageInvitation[]> {
	const { data, error } = await supabase
		.from('page_invitations')
		.select(`
			id,
			page_id,
			role,
			inviter_id,
			invitee_email,
			pages (title),
			profiles:inviter_id (email, full_name)
		`)
		.eq('invitee_email', email)
		.eq('status', 'pending')

	if (error) {
		throw error
	}
	return (data as unknown as PageInvitation[]) || []
}

export async function acceptPageInvitation (invite: PageInvitation, userId: string): Promise<void> {
	try {
		const pageDetails = await fetchPageDetails(invite.page_id)
		const ownerCredits = await getUserAICredits(pageDetails.owner_id)
		const allowedLimit = getPlanCollaboratorLimit(ownerCredits.plan)

		const { count: memberCount } = await supabase
			.from('page_members')
			.select('*', { count: 'exact', head: true })
			.eq('page_id', invite.page_id)

		if ((memberCount || 0) >= allowedLimit) {
			throw new Error(`Collaborator limit reached for this page's owner (${ownerCredits.plan.toUpperCase()} plan, max ${allowedLimit}).`)
		}
	} catch (e: any) {
		if (e.message && e.message.includes('Collaborator limit reached')) {
			throw e
		}
	}

	const { error: memberError } = await supabase
		.from('page_members')
		.insert({
			page_id: invite.page_id,
			user_id: userId,
			role: invite.role,
		})

	if (memberError && !memberError.message.includes('duplicate key')) {
		throw memberError
	}

	const { error: inviteError } = await supabase
		.from('page_invitations')
		.update({ status: 'accepted' })
		.eq('id', invite.id)

	if (inviteError) {
		throw inviteError
	}
}

export async function declinePageInvitation (inviteId: string): Promise<void> {
	const { error } = await supabase
		.from('page_invitations')
		.update({ status: 'declined' })
		.eq('id', inviteId)

	if (error) {
		throw error
	}
}

export async function fetchPageInvitationDetails (token: string): Promise<PageInvitation> {
	const { data, error } = await supabase
		.from('page_invitations')
		.select(`
			id,
			page_id,
			role,
			status,
			pages (title),
			profiles:inviter_id (email, full_name)
		`)
		.eq('token', token)
		.single()

	if (error) {
		throw error
	}
	return data as unknown as PageInvitation
}

export async function fetchMentionablePageCollaborators (pageId: string): Promise<Array<{ id: string; email: string; full_name: string; avatar_url?: string }>> {
	const { data: pageData, error: pageError } = await supabase
		.from('pages')
		.select('owner_id, profiles:owner_id (id, email, full_name, avatar_url)')
		.eq('id', pageId)
		.single()

	if (pageError) throw pageError

	const { data: memberData, error: memberError } = await supabase
		.from('page_members')
		.select('role, profiles:user_id (id, email, full_name, avatar_url)')
		.eq('page_id', pageId)
		.in('role', ['editor'])

	if (memberError) throw memberError

	const collaboratorsMap = new Map<string, { id: string; email: string; full_name: string; avatar_url?: string }>()

	const ownerProfile = pageData?.profiles as unknown as { id: string; email: string; full_name?: string; avatar_url?: string }
	if (ownerProfile && ownerProfile.id) {
		collaboratorsMap.set(ownerProfile.id, {
			id: ownerProfile.id,
			email: ownerProfile.email,
			full_name: ownerProfile.full_name || ownerProfile.email,
			avatar_url: ownerProfile.avatar_url,
		})
	}

	for (const m of (memberData || [])) {
		const profile = m.profiles as unknown as { id: string; email: string; full_name?: string; avatar_url?: string }
		if (profile && profile.id && !collaboratorsMap.has(profile.id)) {
			collaboratorsMap.set(profile.id, {
				id: profile.id,
				email: profile.email,
				full_name: profile.full_name || profile.email,
				avatar_url: profile.avatar_url,
			})
		}
	}

	return Array.from(collaboratorsMap.values())
}

export async function fetchOwnedPagesWithMembers (userId: string): Promise<(Page & { page_members: PageMember[] })[]> {
	const { data, error } = await supabase
		.from('pages')
		.select(`
			*,
			page_members (
				id,
				user_id,
				role,
				profiles:user_id (email, full_name)
			)
		`)
		.eq('owner_id', userId)
		.order('updated_at', { ascending: false })

	if (error) {
		throw error
	}
	return (data || []) as (Page & { page_members: PageMember[] })[]
}

export async function fetchVersionsForEntity (entityId: string): Promise<DocumentVersion[]> {
	const { data, error } = await supabase
		.from('document_versions')
		.select(`
			id,
			document_id,
			page_id,
			version_name,
			created_at,
			created_by,
			profiles:created_by (email, full_name)
		`)
		.or(`page_id.eq.${entityId},document_id.eq.${entityId}`)
		.order('created_at', { ascending: false })

	if (error) {
		throw error
	}
	return (data as unknown as DocumentVersion[]) || []
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- tests/unit/db-graph.test.ts`
Expected: all pass (10 existing + 17 new).

- [ ] **Step 6: Lint + build**

Run: `npm run lint && npm run build`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add types/index.ts services/graph.ts tests/unit/db-graph.test.ts
git commit -m "feat(graph): page member/invite service layer and workspace bootstrap"
```

---

### Task 4: Dashboard cutover

**Files:**
- Modify: `components/dashboard.tsx` (imports :7, state :30-31, fetch :102-125, create :144-152, delete/rename handlers, sort/filter accessor :200-229, navigation :441/:552, shared card fields :549-574, copy strings)
- Test: `tests/unit/dashboard-refetch-on-auth.test.tsx` (mock swap + regex updates)

**Interfaces:**
- Consumes: `ensureWorkspace`, `fetchWorkspacePages`, `fetchSharedPages`, `fetchPendingPageInvitations`, `createPage`, `updatePageTitle`, `deletePage` (Task 3).
- Produces: dashboard renders owned pages (`Page[]`) and shared pages (`MemberPageItem[]`), navigates to `/page/{id}`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/dashboard-refetch-on-auth.test.tsx`:

(a) Replace the `vi.mock('@/services/db', ...)` block (lines 30-39) with:
```ts
const ensureWorkspace = vi.fn()
const fetchWorkspacePages = vi.fn()
const fetchSharedPages = vi.fn()
const fetchPageInvites = vi.fn()
const createPage = vi.fn()

vi.mock('@/services/graph', () => ({
	ensureWorkspace: (...args: any[]) => ensureWorkspace(...args),
	fetchWorkspacePages: (...args: any[]) => fetchWorkspacePages(...args),
	fetchSharedPages: (...args: any[]) => fetchSharedPages(...args),
	fetchPendingPageInvitations: (...args: any[]) => fetchPageInvites(...args),
	createPage: (...args: any[]) => createPage(...args),
	deletePage: vi.fn(),
	updatePageTitle: vi.fn(),
}))
```

(b) Remove the old `const createDocument = vi.fn()` line (it is now declared in the new block above).

(c) In `beforeEach` (lines 64-72), replace the resets with:
```ts
	beforeEach(() => {
		authCallback = null
		ensureWorkspace.mockReset()
		fetchWorkspacePages.mockReset()
		fetchSharedPages.mockReset()
		fetchPageInvites.mockReset()
		ensureWorkspace.mockResolvedValue({ id: 'ws-1', owner_id: 'user-1' })
		fetchWorkspacePages.mockResolvedValue([])
		fetchSharedPages.mockResolvedValue([])
		fetchPageInvites.mockResolvedValue([])
	})
```

(d) Rename every remaining `fetchOwned` → `fetchWorkspacePages`, `fetchShared` → `fetchSharedPages`, `fetchInvites` → `fetchPageInvites` throughout the file (the test bodies reference the mocks by their old names). Update the mock-data shapes: `{ id: 'doc-1', title: 'My Doc', owner_id: 'user-1', updated_at: ... }` stays valid for `Page` (same field names), but the "retry" test's error regex must change:
- `expect(await screen.findByText(/couldn't load your documents/i))` → `(/couldn't load your pages/i)` (3 occurrences)
- `expect(screen.queryByText(/welcome to lekhan/i))` → `(/welcome to lekhan/i)` (unchanged)

- [ ] **Step 2: Run tests to verify they fail**

Run: `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" && npm run test -- tests/unit/dashboard-refetch-on-auth.test.tsx`
Expected: FAIL (dashboard still imports `@/services/db`; mocked `@/services/graph` is never used, and `fetchWorkspacePages` mock is never called).

- [ ] **Step 3: Implement the dashboard cutover**

In `components/dashboard.tsx`:

(a) Line 5 import — replace with:
```ts
import { MemberPageItem, Page } from '@/types'
```

(b) Line 7 import — replace with:
```ts
import { ensureWorkspace, fetchWorkspacePages, fetchSharedPages, createPage, deletePage, updatePageTitle, fetchPendingPageInvitations } from '@/services/graph'
```

(c) Lines 30-31 state — replace with:
```ts
	const [myPages, setMyPages] = useState<Page[]>([])
	const [sharedPages, setSharedPages] = useState<MemberPageItem[]>([])
```

(d) The `fetchDocuments` callback (lines 102-125) — replace the body with:
```ts
	const fetchPages = useCallback(async () => {
		const requestId = ++fetchRequestIdRef.current
		setLoading(true)
		setFetchError(false)
		try {
			const workspace = await ensureWorkspace(user.id)
			const [owned, shared, invites] = await Promise.all([
				fetchWorkspacePages(workspace.id),
				fetchSharedPages(user.id),
				fetchPendingPageInvitations(user.email)
			])
			if (requestId !== fetchRequestIdRef.current) return
			setMyPages(owned)
			setSharedPages(shared)
			setPendingInvitesCount(invites.length)
		} catch (err) {
			if (requestId !== fetchRequestIdRef.current) return
			console.error('Error fetching pages:', err)
			setFetchError(true)
		} finally {
			if (requestId === fetchRequestIdRef.current) {
				setLoading(false)
			}
		}
	}, [user.id, user.email])
```

(e) Replace `fetchDocuments` references: line 128 `fetchDocuments()` → `fetchPages()`; line 138 (auth event) `fetchDocuments()` → `fetchPages()`; line 148 dependency `[fetchDocuments]` → `[fetchPages]`; line 265 `<Invitations ... onRefresh={fetchDocuments}` → `onRefresh={fetchPages}`; line 304 `onClick={fetchDocuments}` → `onClick={fetchPages}`; line 348 `onRefresh={fetchDocuments}` → `onRefresh={fetchPages}`.

(f) `handleCreateDocument` (lines 144-152) — replace with:
```ts
	const handleCreatePage = async () => {
		try {
			const workspace = await ensureWorkspace(user.id)
			const page = await createPage(workspace.id, user.id)
			router.push(`/page/${page.id}`)
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Failed to create page: ${message}`)
		}
	}
```
Replace all three call sites (`onClick={handleCreateDocument}` at :317, :406, :593) with `onClick={handleCreatePage}`.

(g) `executeDelete` (lines 162-174) — `await deleteDocument(documentToDelete)` → `await deletePage(documentToDelete)`; `setMyDocs(prev => ...)` → `setMyPages(prev => prev.filter(page => page.id !== documentToDelete))`; toast `'Document deleted successfully'` → `'Page deleted successfully'`.

(h) `handleRenameSubmit` (lines 176-185) — `await updateDocumentTitle(id, newTitle)` → `await updatePageTitle(id, newTitle)`; `setMyDocs(prev => prev.map(doc => ...))` → `setMyPages(prev => prev.map(page => page.id === id ? { ...page, title: newTitle } : page))`; toast copy `'Failed to rename document'` → `'Failed to rename page'`.

(i) `applyFiltersAndSort` (lines 200-229) — the nested-accessor expressions `doc.documents && doc.documents[dateField]` / `doc.documents && doc.documents[titleField]` become pages-aware. Replace all four occurrences of `(doc.documents && doc.documents[dateField])` → `(doc.documents?.[dateField] ?? doc.pages?.[dateField])`, `(doc.documents && doc.documents[titleField])` → `(doc.documents?.[titleField] ?? doc.pages?.[titleField])` (title appears in two of the four spots). The `documents` accessor is retained for type tolerance; `MemberPageItem` nests under `pages`.

(j) `filteredMyDocs`/`filteredSharedDocs` (lines 231-232) — replace with:
```ts
	const filteredMyPages = useMemo(() => applyFiltersAndSort(myPages, 'updated_at', 'title') as Page[], [applyFiltersAndSort, myPages])
	const filteredSharedPages = useMemo(() => applyFiltersAndSort(sharedPages, 'updated_at', 'title') as MemberPageItem[], [applyFiltersAndSort, sharedPages])
```
Then replace all remaining `filteredMyDocs` → `filteredMyPages`, `filteredSharedDocs` → `filteredSharedPages`, `myDocs` → `myPages`, `sharedDocs` → `sharedPages` in the JSX (lines 234-240 scroll effects, 309-310 empty-state conditions, 347-359 header condition, 413-423 section header/empty states, 438-501 cards, 524-585 shared section).

(k) Card navigation (line 441): `router.push(`/doc/${doc.id}`)` → `router.push(`/page/${page.id}`)`; shared card (line 552): `router.push(`/doc/${item.documents.id}`)` → `router.push(`/page/${item.pages.id}`)`.

(l) Shared card body (lines 563-571): `{item.documents.title}` → `{item.pages.title}`; `{new Date(item.documents.updated_at).toLocaleDateString()}` → `{new Date(item.pages.updated_at).toLocaleDateString()}`; `{item.role}` stays.

(m) User-visible copy (replace exact strings):
- `"Couldn't load your documents"` → `"Couldn't load your pages"`
- `"Something went wrong while fetching your documents. Please try again."` → `"Something went wrong while fetching your pages. Please try again."`
- `"Documents"` (section header, line 355) → `"Pages"`
- `"No owned documents yet"` → `"No pages yet"`; `"You haven't created any documents. Use the New button to start collaborating!"` → `"You haven't created any pages. Use the New button to start collaborating!"`; `"No documents match your search query."` → `"No pages match your search query."`
- `"No documents match your current search or filter criteria."` → `"No pages match your current search or filter criteria."`
- `"You haven't created any documents yet. Create your first document to start collaborating with your team!"` → `"You haven't created any pages yet. Create your first page to start collaborating with your team!"`
- `"No shared documents yet"` → `"No shared pages yet"`; `"Documents appear here when you're invited to collaborate."` → `"Pages appear here when you're invited to collaborate."`; `"No shared documents match your search query."` → `"No shared pages match your search query."`
- ConfirmDialog (lines 597-604): title `"Delete Document"` → `"Delete Page"`, description `"...delete this document?..."` → `"...delete this page?..."`.
- `key={item.documents.id}` (line 551) → `key={item.pages.id}`; `item.documents` in the shared card's `onClick` closure stays consistent per (k)/(l).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/unit/dashboard-refetch-on-auth.test.tsx`
Expected: all 6 tests pass.

- [ ] **Step 5: Lint + build**

Run: `npm run lint && npm run build`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add components/dashboard.tsx tests/unit/dashboard-refetch-on-auth.test.tsx
git commit -m "feat(dashboard): cut over to pages and page members"
```

---

### Task 5: Editor route + workspace cutover

**Files:**
- Create: `app/page/[id]/page.tsx`
- Modify: `app/doc/[id]/page.tsx` (replace with redirect)
- Modify: `components/editor-workspace.tsx` (import :45, prop rename, role check :284-305, mentionables :238-250, collab hook :340, title save :685-688, VersionHistory/ShareModal props :1041/:1069)
- Test: `tests/unit/editor-formatting.test.tsx`

**Interfaces:**
- Consumes: `fetchPageDetails`, `fetchPageMemberRole`, `updatePageTitle`, `fetchMentionablePageCollaborators`, `getUserAICredits` (Task 3 / db.ts).
- Produces: `/page/[id]` route (full session/anon logic); `/doc/[id]` server redirect; `EditorWorkspace` prop renamed `documentId` → `pageId`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/editor-formatting.test.tsx`:

(a) Replace the `vi.mock('@/services/db', ...)` block (lines 34-42) with:
```ts
vi.mock('@/services/graph', () => ({
	fetchPageDetails: vi.fn().mockResolvedValue({ owner_id: 'test-user', is_public: false }),
	fetchPageMemberRole: vi.fn().mockResolvedValue('owner'),
	updatePageTitle: vi.fn().mockResolvedValue(true),
	fetchMentionablePageCollaborators: vi.fn().mockResolvedValue([]),
	getUserAICredits: vi.fn().mockResolvedValue({ plan: 'free', totalAllocated: 50, usedCredits: 0, remainingCredits: 50 }),
}))
```

(b) In the render call, `documentId="doc-1"` → `pageId="page-1"`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" && npm run test -- tests/unit/editor-formatting.test.tsx`
Expected: FAIL (component still imports `@/services/db`; prop `documentId` still required — `pageId` renders nothing).

- [ ] **Step 3: Implement the new route**

Create `app/page/[id]/page.tsx` with exactly:

```tsx
'use client'

import { use, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { fetchPageDetails } from '@/services/graph'
import GlobalLoader from '@/components/global-loader'
import EditorWorkspace from '@/components/editor-workspace'
import { toast } from 'sonner'

export default function PageRoute({
	params: paramsPromise,
}: {
	params: Promise<{ id: string }>
}) {
	const params = use(paramsPromise)
	const router = useRouter()
	const [user, setUser] = useState<any | null>(null)
	const [token, setToken] = useState<string | null>(null)
	const [pageTitle, setPageTitle] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		const loadPageAndSession = async () => {
			try {
				// 1. Get current session and token
				const { data: { session } } = await supabase.auth.getSession()
				const { error: userError } = await supabase.auth.getUser()

				// If there is an auth error that is NOT just a missing session, it means the token expired or is invalid
				if (userError && userError.name !== 'AuthSessionMissingError') {
					console.error('Session error (token expired):', userError)
					toast.error('Session expired. Please log in again.')
					router.push('/login')
					return
				}

				if (session) {
					setUser(session.user)
					setToken(session.access_token)
				} else {
					// Check if page is public
					try {
						const page = await fetchPageDetails(params.id)
						if (page && page.is_public) {
							// Mock anonymous user
							const randomId = Math.random().toString(36).substring(7)
							setUser({
								id: `anon-${randomId}`,
								email: 'anonymous@public',
								full_name: 'Anonymous Viewer'
							})
							setToken('anonymous')
						} else {
							router.push('/login')
							return
						}
					} catch {
						router.push('/login')
						return
					}
				}

				// 2. Fetch page details
				const page = await fetchPageDetails(params.id)
				setPageTitle(page.title)
			} catch (err: unknown) {
				console.error('Error loading page:', err)
				toast.error('Page not found or access denied')
				router.push('/')
			} finally {
				setLoading(false)
			}
		}

		loadPageAndSession()
	}, [params.id, router])

	if (loading) {
		return <GlobalLoader text="Loading page..." />
	}

	if (!user || !token || !pageTitle) {
		return null
	}

	return (
		<EditorWorkspace
			pageId={params.id}
			initialTitle={pageTitle}
			token={token}
			currentUser={{
				id: user.id,
				email: user.email,
				full_name: user.user_metadata?.full_name || user.full_name
			}}
		/>
	)
}
```

- [ ] **Step 4: Replace `/doc/[id]` with a redirect**

Replace the entire content of `app/doc/[id]/page.tsx` with:

```tsx
import { redirect } from 'next/navigation'

export default async function DocumentPage({
	params: paramsPromise,
}: {
	params: Promise<{ id: string }>
}) {
	const params = await paramsPromise
	redirect(`/page/${params.id}`)
}
```

- [ ] **Step 5: Implement the EditorWorkspace cutover**

In `components/editor-workspace.tsx`:

(a) Line 45 import — replace with:
```ts
import { fetchPageDetails, fetchPageMemberRole, updatePageTitle, fetchMentionablePageCollaborators } from '@/services/graph'
import { getUserAICredits } from '@/services/db'
```

(b) Props interface (lines 67-76): rename `documentId: string` → `pageId: string`.

(c) Destructure (line 158): `documentId,` → `pageId,`.

(d) `loadMentionables` (lines 238-250): `fetchMentionableCollaborators(documentId)` → `fetchMentionablePageCollaborators(pageId)`; deps `[documentId]` → `[pageId]`.

(e) `checkRole` (lines 284-305): replace with:
```ts
	useEffect(() => {
		const checkRole = async () => {
			try {
				const page = await fetchPageDetails(pageId)
				if (page && page.owner_id === currentUser.id) {
					setIsViewer(false)
					return
				}

				const role = await fetchPageMemberRole(pageId, currentUser.id)
				if (role === 'editor' || role === 'owner') {
					setIsViewer(false)
				} else {
					setIsViewer(true)
				}
			} catch (err) {
				console.error('Error fetching role:', err)
				setIsViewer(true)
			}
		}
		checkRole()
	}, [pageId, currentUser.id])
```

(f) Collab hook (line 340): `useEditorCollab(documentId, token, collabUser)` → `useEditorCollab(pageId, token, collabUser)`.

(g) `handleSaveTitle` (lines 685-688): `await updateDocumentTitle(documentId, newTitle)` → `await updatePageTitle(pageId, newTitle)`.

(h) VersionHistory prop (line 1041): `documentId={documentId}` → `documentId={pageId}`; ShareModal prop (line 1069): `documentId={documentId}` → `documentId={pageId}`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -- tests/unit/editor-formatting.test.tsx`
Expected: PASS.

- [ ] **Step 7: Lint + build**

Run: `npm run lint && npm run build`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add app/page/[id]/page.tsx app/doc/[id]/page.tsx components/editor-workspace.tsx tests/unit/editor-formatting.test.tsx
git commit -m "feat(editor): page route with /doc redirect and pages-based workspace"
```

---

### Task 6: Share modal — page members UI

**Files:**
- Modify: `components/share-modal.tsx`

**Interfaces:**
- Consumes: `fetchPageDetails`, `updatePagePublicStatus`, `createPageInvitation`, `fetchPageMembers`, `removePageMember`, `updatePageMemberRole` (Task 3); `fetchPastCollaborators` (db.ts, unchanged).
- Produces: `ShareModal` with props `{ isOpen, onClose, documentId, documentTitle, userId, isOwner }` — public toggle, invite form, member list with role dropdown + remove (owner-only), past-collaborator chips, `/page/{id}` public URL.

- [ ] **Step 1: Update imports and props**

(a) Line 6 import — replace with:
```ts
import { fetchPageDetails, updatePagePublicStatus, createPageInvitation, fetchPageMembers, removePageMember, updatePageMemberRole } from '@/services/graph'
import { fetchPastCollaborators } from '@/services/db'
import { PageMember } from '@/types'
```

(b) Props interface (lines 9-15) — add `isOwner`:
```ts
interface ShareModalProps {
	isOpen: boolean
	onClose: () => void
	documentId: string
	documentTitle: string
	userId: string
	isOwner: boolean
}
```

(c) Destructure (lines 17-23) — add `isOwner`.

(d) Add state next to `pastCollaborators` (line 29):
```ts
	const [members, setMembers] = useState<PageMember[]>([])
	const [membersLoading, setMembersLoading] = useState(false)
```

(e) `fetchDocPublicState` (lines 38-45): `fetchDocumentDetails(documentId)` → `fetchPageDetails(documentId)`.

(f) `handleInvite` (lines 56-76): `createInvitation(documentId, userId, email, role, token)` → `createPageInvitation(documentId, userId, email, role, token)`; toast `'Invite link generated for ${email}!'` stays.

(g) `handleTogglePublic` (line 83): `updateDocumentPublicStatus(documentId, nextState)` → `updatePagePublicStatus(documentId, nextState)`.

(h) Public-link URL (line 151 and 157): `${...}/doc/${documentId}` → `${...}/page/${documentId}`.

- [ ] **Step 2: Add the member list load + handlers**

After `fetchCollaborators` (line 54), add:

```ts
	const loadMembers = async () => {
		setMembersLoading(true)
		try {
			const data = await fetchPageMembers(documentId)
			setMembers(data)
		} catch (err) {
			console.error('Error fetching page members:', err)
		} finally {
			setMembersLoading(false)
		}
	}

	useEffect(() => {
		if (isOpen) {
			loadMembers()
		}
	}, [isOpen, documentId])

	const handleRemoveMember = async (member: PageMember) => {
		try {
			await removePageMember(documentId, member.user_id)
			setMembers(prev => prev.filter(m => m.user_id !== member.user_id))
			toast.success('Member removed')
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Failed to remove member: ${message}`)
		}
	}

	const handleRoleChange = async (member: PageMember, role: 'editor' | 'viewer') => {
		try {
			await updatePageMemberRole(documentId, member.user_id, role)
			setMembers(prev => prev.map(m => m.user_id === member.user_id ? { ...m, role } : m))
			toast.success('Role updated')
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err)
			toast.error(`Failed to update role: ${message}`)
		}
	}
```

- [ ] **Step 3: Render the member list**

Insert this block between the public-link toggle section (ends line 167) and the invite form (line 170):

```tsx
				{/* 1.5 Members */}
				<div className='mb-6'>
					<p className='text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60 mb-2'>
						Members ({members.length})
					</p>
					{membersLoading ? (
						<p className='text-xs text-on-surface-variant/60 py-2'>Loading members...</p>
					) : members.length === 0 ? (
						<p className='text-xs text-on-surface-variant/60 py-2'>No collaborators added yet.</p>
					) : (
						<ul className='space-y-2 max-h-48 overflow-y-auto pr-1'>
							{members.map((member) => (
								<li
									key={member.user_id}
									className='flex items-center justify-between bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl px-3 py-2'
								>
									<div className='flex items-center gap-2 min-w-0'>
										<div className='w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs uppercase shrink-0'>
											{(member.profiles?.full_name || member.profiles?.email || '?').charAt(0)}
										</div>
										<div className='min-w-0'>
											<div className='text-xs font-semibold text-on-surface truncate'>
												{member.profiles?.full_name || member.profiles?.email}
											</div>
											<div className='text-[10px] text-on-surface-variant/70 truncate'>
												{member.profiles?.email}
											</div>
										</div>
									</div>
									<div className='flex items-center gap-2 shrink-0'>
										{isOwner && member.role !== 'owner' ? (
											<CustomSelect
												value={member.role as 'editor' | 'viewer'}
												onValueChange={(val) => handleRoleChange(member, val as 'editor' | 'viewer')}
												options={[
													{ label: 'Editor', value: 'editor' },
													{ label: 'Viewer', value: 'viewer' },
												]}
												triggerClassName='h-7 w-[100px] bg-transparent border border-black/10 dark:border-white/10 rounded-lg text-[10px] font-medium text-on-surface px-2 focus:ring-0'
												contentClassName='w-[100px]'
											/>
										) : (
											<span className='text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/70 capitalize'>
												{member.role === 'owner' ? 'Owner' : member.role}
											</span>
										)}
										{isOwner && member.role !== 'owner' && (
											<button
												onClick={() => handleRemoveMember(member)}
												className='text-error hover:text-error/80 text-xs font-bold px-2 py-1 border border-error/30 rounded-md hover:bg-error/10 transition-colors'
											>
												Remove
											</button>
										)}
									</div>
								</li>
							))}
						</ul>
					)}
				</div>
```

- [ ] **Step 4: Update the modal heading**

Line 112: `Share Document` → `Share Page`.

- [ ] **Step 5: Verify (no direct unit test exists for ShareModal — gate via lint/build + TypeScript)**

Run: `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" && npm run lint && npm run build`
Expected: green. Also run `npm run test -- tests/unit/editor-formatting.test.tsx tests/unit/dashboard-refetch-on-auth.test.tsx` to confirm no regressions from the new `isOwner` prop (EditorWorkspace must pass it — see Step 6).

- [ ] **Step 6: Pass `isOwner` from EditorWorkspace**

In `components/editor-workspace.tsx`, the ShareModal usage (lines 1066-1072) becomes:

```tsx
			<ShareModal
				isOpen={isShareOpen}
				onClose={() => setIsShareOpen(false)}
				documentId={pageId}
				documentTitle={title}
				userId={currentUser.id}
				isOwner={isViewer === false && currentUser.id === (ownerId ?? '')}
			/>
```

Add state so the owner id is known: at the top of the `checkRole` effect, capture it:

```ts
	const [ownerId, setOwnerId] = useState<string | null>(null)
```

and in `checkRole` set `setOwnerId(page.owner_id)` when the page resolves. If `page` is missing or fetch fails, `ownerId` stays null and `isOwner` is false (safe default — RLS still enforces owner-only mutations).

- [ ] **Step 7: Lint + build again**

Run: `npm run lint && npm run build`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add components/share-modal.tsx components/editor-workspace.tsx
git commit -m "feat(share): page member management in share modal"
```

---

### Task 7: Invitations + invite page cutover

**Files:**
- Modify: `components/invitations.tsx`
- Modify: `app/invite/[token]/page.tsx`

**Interfaces:**
- Consumes: `fetchPendingPageInvitations`, `acceptPageInvitation`, `declinePageInvitation`, `fetchPageInvitationDetails` (Task 3); `PageInvitation` type (Task 3).
- Produces: invitation components render `PageInvitation` and navigate to `/page/{id}`.

- [ ] **Step 1: Cut over `components/invitations.tsx`**

(a) Line 4 import: `DocumentInvitation` → `PageInvitation`:
```ts
import { PageInvitation } from '@/types'
```

(b) Line 5 import:
```ts
import { fetchPendingPageInvitations, acceptPageInvitation, declinePageInvitation } from '@/services/graph'
```

(c) State + fetch (lines 22-40): `useState<PageInvitation[]>([])`; `fetchPendingPageInvitations(userEmail)`.

(d) `handleAccept` (lines 42-52): `acceptPageInvitation(invite, userId)`.

(e) `handleDecline` (line 56): `declinePageInvitation(inviteId)`.

(f) Render: `invite.documents?.title` → `invite.pages?.title` (lines 85 and 113); `invite.profiles?.full_name` stays (same embed shape).

- [ ] **Step 2: Cut over `app/invite/[token]/page.tsx`**

(a) Line 6 import: `DocumentInvitation` → `PageInvitation`.

(b) Line 7 import:
```ts
import { fetchPageInvitationDetails, acceptPageInvitation, declinePageInvitation } from '@/services/graph'
```

(c) State (line 19): `useState<PageInvitation | null>(null)`.

(d) Redirect after accepted (line 42): `router.push(`/page/${invitation.page_id}`)`.

(e) `handleAccept` (line 66): `router.push(`/page/${invite.page_id}`)`.

(f) Heading (line 102): `Document Invitation` → `Page Invitation`; subtitle (line 105): `...join a collaborative document workspace` → `...join a collaborative page workspace`; label (line 110): `Document Title` → `Page Title`; `invite.documents?.title` → `invite.pages?.title` (line 113).

- [ ] **Step 3: Verify**

Run: `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" && npm run lint && npm run build && npm run test -- tests/unit/dashboard-refetch-on-auth.test.tsx tests/unit/editor-formatting.test.tsx`
Expected: green (no dedicated unit tests exist for these two files).

- [ ] **Step 4: Commit**

```bash
git add components/invitations.tsx app/invite/[token]/page.tsx
git commit -m "feat(invites): page invitations across notifications, banner and invite page"
```

---

### Task 8: Settings cutover

**Files:**
- Modify: `app/settings/page.tsx`
- Modify: `components/settings-client.tsx`
- Test: `tests/unit/settings-tabs.test.tsx`

**Interfaces:**
- Consumes: `fetchOwnedPagesWithMembers`, `removePageMember`, `updatePageMemberRole`, `getUserAICredits` (Task 3 / db.ts).
- Produces: `SettingsClient` props renamed `documents`/`setDocuments` → `pages`/`setPages`; Collaborators tab lists owned pages + `page_members` with remove + role change.

- [ ] **Step 1: Update the failing test**

In `tests/unit/settings-tabs.test.tsx`, the render call passes `documents={documents} setDocuments={vi.fn()}` → change to `pages={documents} setPages={vi.fn()}`.

Run: `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" && npm run test -- tests/unit/settings-tabs.test.tsx`
Expected: FAIL (SettingsClient still expects `documents` props → renders nothing, tab buttons missing).

- [ ] **Step 2: Cut over `app/settings/page.tsx`**

(a) Line 8 import: `import { fetchOwnedDocumentsWithMembers } from '@/services/db'` → `import { fetchOwnedPagesWithMembers } from '@/services/graph'`.

(b) State + fetch (lines 13, 29): rename `documents`/`setDocuments` → `pages`/`setPages`; `const docs = await fetchOwnedPagesWithMembers(sessionUser.id)` → `const pages = await fetchOwnedPagesWithMembers(sessionUser.id)`; `setPages(pages)`.

(c) Render (line 44): `<SettingsClient user={user} pages={pages} setPages={setPages} />`.

- [ ] **Step 3: Cut over `components/settings-client.tsx`**

(a) Lines 8-13 import — replace with:
```ts
import {
	getUserAICredits,
	type UserAICredits,
} from '@/services/db'
import { removePageMember, updatePageMemberRole, fetchOwnedPagesWithMembers } from '@/services/graph'
```

(b) Props (lines 17-26): rename `documents: initialDocuments = []` → `pages: initialPages = []`, `setDocuments: setParentPages` → `setPages: setParentPages`.

(c) State (line 37): `const [pagesState, setPagesState] = useState<any[]>(initialPages)`; sync effect (lines 39-41): `setPagesState(initialPages)`.

(d) `handleRemoveMember` (lines 108-122):
```ts
	const handleRemoveMember = async (pageId: string, memberUserId: string) => {
		try {
			await removePageMember(pageId, memberUserId)
			if (user?.id) {
				const updatedPages = await fetchOwnedPagesWithMembers(user.id)
				if (setParentPages) {
					setParentPages(updatedPages)
				}
				setPagesState(updatedPages)
			}
			toast.success('Collaborator removed successfully')
		} catch {
			toast.error('Failed to remove collaborator')
		}
	}
```

(e) Add a role-change handler after `handleRemoveMember`:
```ts
	const handleRoleChange = async (pageId: string, memberUserId: string, role: 'editor' | 'viewer') => {
		try {
			await updatePageMemberRole(pageId, memberUserId, role)
			setPagesState(prev => prev.map((page: any) =>
				page.id === pageId
					? { ...page, page_members: (page.page_members || []).map((m: any) => m.user_id === memberUserId ? { ...m, role } : m) }
					: page
			))
			toast.success('Role updated successfully')
		} catch {
			toast.error('Failed to update role')
		}
	}
```

(f) Pagination (lines 124-130): `documentsState` → `pagesState`.

(g) Collaborators tab JSX (lines 252-340): `documentsState.length` → `pagesState.length`; `paginatedDocuments` → `paginatedPages`; card `key={doc.id}` stays; title `doc.title || 'Untitled Document'` → `doc.title || 'Untitled Page'`; `const members = doc.page_members || []`; empty copy `"You don't own any documents yet."` → `"You don't own any pages yet."`; member list item uses the same `member.profiles` shape (embedded via `fetchOwnedPagesWithMembers`); add a role `CustomSelect` next to the Remove button (only when `member.role !== 'owner'` — owners never appear as members in the embed since page_members insert excludes the owner, but guard anyway):

```tsx
													<li
														key={member.user_id}
														className="flex justify-between items-center bg-black/5 dark:bg-surface-variant/10 p-3 rounded-lg border border-black/5 dark:border-white/5 group"
													>
														<div className="flex items-center gap-3">
															<div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs uppercase shrink-0">
																{(member.profiles?.full_name || member.profiles?.email || '?').charAt(0)}
															</div>
															<div className="min-w-0">
																<div className="text-on-surface text-xs font-semibold truncate">
																	{member.profiles?.full_name || member.profiles?.email}
																</div>
																<div className="text-[11px] text-on-surface-variant/80 mt-0.5 truncate">
																	{member.profiles?.email} • <span className="capitalize font-medium text-primary">{member.role}</span>
																</div>
															</div>
														</div>
														<div className="flex items-center gap-2 shrink-0">
															<CustomSelect
																value={member.role as 'editor' | 'viewer'}
																onValueChange={(val) => handleRoleChange(doc.id, member.user_id, val as 'editor' | 'viewer')}
																options={[
																	{ label: 'Editor', value: 'editor' },
																	{ label: 'Viewer', value: 'viewer' },
																]}
																triggerClassName="h-7 w-[100px] bg-transparent border border-black/10 dark:border-white/10 rounded-lg text-[10px] font-medium text-on-surface px-2 focus:ring-0"
																contentClassName="w-[100px]"
															/>
															<button
																onClick={() => handleRemoveMember(doc.id, member.user_id)}
																className="text-error hover:text-error/80 text-xs font-bold px-3 py-1.5 border border-error/30 rounded-md hover:bg-error/10 transition-colors shrink-0"
															>
																Remove
															</button>
														</div>
													</li>
```

`CustomSelect` is already imported at the top of settings-client? It is NOT (settings-client imports `BYOKSettings`, `PricingMatrix`). Add: `import { CustomSelect } from './ui/custom-select'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/unit/settings-tabs.test.tsx`
Expected: PASS.

- [ ] **Step 5: Lint + build**

Run: `npm run lint && npm run build`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add app/settings/page.tsx components/settings-client.tsx tests/unit/settings-tabs.test.tsx
git commit -m "feat(settings): collaborators tab backed by pages and page members"
```

---

### Task 9: Version history + API route cutover

**Files:**
- Modify: `components/version-history.tsx` (import :9, save insert :87-95, list load :42-51)
- Modify: `app/api/version/route.ts` (role check :104-127, insert :130-138)
- Test: `tests/unit/version-history-reassurance.test.tsx` (mock chain gains `or`)

**Interfaces:**
- Consumes: `fetchVersionsForEntity` (Task 3).
- Produces: version checkpoints written with `page_id` for pages (RLS pages branch); the list queries `page_id OR document_id`; the API route resolves pages first.

- [ ] **Step 1: Update the failing test**

In `tests/unit/version-history-reassurance.test.tsx`, the supabase mock chain (lines 8-16) must gain `or` (and `insert`, `upload` for the save path — not exercised by the retention test, but the chain needs `or` for `fetchVersionsForEntity`):

```ts
vi.mock('@/lib/supabase', () => ({
	supabase: {
		from: vi.fn(() => ({
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			order: vi.fn().mockReturnThis(),
			or: vi.fn().mockReturnThis(),
			then: vi.fn((cb: any) => Promise.resolve({ data: [], count: 0, error: null }).then(cb)),
		})),
	},
}))
```

Run: `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" && npm run test -- tests/unit/version-history-reassurance.test.tsx`
Expected: currently PASSES (chain `then` missing is tolerated by the catch); after the change it must still pass — treat as regression guard, not red-green.

- [ ] **Step 2: Cut over `components/version-history.tsx`**

(a) Line 9 import: `import { fetchVersions } from '@/services/db'` → `import { fetchVersionsForEntity } from '@/services/graph'`.

(b) `loadVersions` (lines 42-51): `const data = await fetchVersions(documentId)` → `const data = await fetchVersionsForEntity(documentId)`.

(c) Save-version insert (lines 87-95): the `document_versions` insert becomes:
```ts
			const { error: dbError } = await supabase
				.from('document_versions')
				.insert({
					id: versionId,
					page_id: documentId,
					version_name: newVersionName.trim(),
					storage_path: `${documentId}/versions/${versionId}.bin`,
					created_by: user.id,
				})
```

(d) Update the `DocumentVersion` reference in the confirm dialog (line 308): `description={`Are you sure you want to restore "${versionToRestore?.version_name}"? Unsaved changes in the current document will be replaced.`}` → `...Unsaved changes in the current page will be replaced.` (optional copy).

- [ ] **Step 3: Cut over `app/api/version/route.ts`**

(a) Replace the role check (lines 104-127) with pages-first resolution:

```ts
		// 1. Verify user role: only owners and editors can create versions.
		// Pages are the primary entity; legacy documents fall back for
		// unmapped ids (rollback path).
		const { data: page } = await supabaseClient
			.from('pages')
			.select('owner_id')
			.eq('id', documentId)
			.maybeSingle()

		let isOwner = !!(page && page.owner_id === user.id)
		let isEditor = false

		if (!page) {
			const { data: doc } = await supabaseClient
				.from('documents')
				.select('owner_id')
				.eq('id', documentId)
				.maybeSingle()

			isOwner = !!(doc && doc.owner_id === user.id)

			if (!isOwner && doc) {
				const { data: member } = await supabaseClient
					.from('document_members')
					.select('role')
					.eq('document_id', documentId)
					.eq('user_id', user.id)
					.single()

				isEditor = !!(member && member.role === 'editor')
			}
		} else if (!isOwner) {
			const { data: member } = await supabaseClient
				.from('page_members')
				.select('role')
				.eq('page_id', documentId)
				.eq('user_id', user.id)
				.single()

			isEditor = !!(member && member.role === 'editor')
		}

		if (!isOwner && !isEditor) {
			return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 })
		}
```

(b) Replace the insert (lines 130-138) to write `page_id` for pages:

```ts
		// 2. Create the document_versions record (page_id for pages)
		const { data: version, error: dbError } = await supabaseClient
			.from('document_versions')
			.insert(
				page
					? {
						page_id: documentId,
						version_name: versionName,
						created_by: user.id,
					}
					: {
						document_id: documentId,
						version_name: versionName,
						created_by: user.id,
					}
			)
			.select()
			.single()
```

- [ ] **Step 4: Verify**

Run: `npm run test -- tests/unit/version-history-reassurance.test.tsx && npm run lint && npm run build`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add components/version-history.tsx app/api/version/route.ts tests/unit/version-history-reassurance.test.tsx
git commit -m "feat(versions): pages-aware checkpoints and API route"
```

---

### Task 10: Whole-branch verification + live DB matrix

**Files:**
- Test: full focused run of all touched test files + lint + build
- Controller: Supabase MCP live verification + advisors + handover

**Interfaces:**
- Consumes: everything from Tasks 1-9.

- [ ] **Step 1: Full focused test run + gates**

Run:
```bash
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"
npm run test -- tests/unit/server.test.ts tests/unit/db-graph.test.ts tests/unit/graph-index.test.ts tests/unit/dashboard-refetch-on-auth.test.tsx tests/unit/editor-formatting.test.tsx tests/unit/settings-tabs.test.tsx tests/unit/version-history-reassurance.test.tsx tests/unit/db.test.ts tests/unit/db-collaborators.test.ts tests/unit/db-credits-limits.test.ts
npm run lint
npm run build
```
Expected: all pass, lint clean, build green. (Do NOT run the full `npm run test` — it OOMs on this machine.)

- [ ] **Step 2: Controller live-verify RLS on the project (Supabase MCP)**

Using `supabase_execute_sql` with the authenticated simulation pattern (`SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims', '{"sub":"<uid>"}', true)`), verify against project `hftipkzqbltdkrcjynad`:

(a) `can_access_page` no longer references document_members:
```sql
SELECT prosrc LIKE '%document_members%' AS still_references FROM pg_proc WHERE proname = 'can_access_page';
```
Expected: `still_references = false`.

(b) Member read / stranger denied / public read on pages:
```sql
-- as owner: 1
SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"<owner-uid>"}', true); SELECT count(*) FROM public.pages;
```
Expected: owner sees their pages; a stranger uid sees 0 (unless public); anon sees only `is_public = true` pages via `select_pages_public` (verify with a known public page from the live data).

(c) Twin-less page storage access: create a scratch page (as owner), then as that owner simulate storage RLS:
```sql
SELECT public.can_access_document_storage('<scratch-page-id>/main_state.bin', 'select');
SELECT public.can_access_document_storage('<scratch-page-id>/main_state.bin', 'insert');
SELECT public.can_access_document_storage('<scratch-page-id>/main_state.bin', 'delete');
```
Expected: select/insert true, delete true for owner. Stranger uid: all false. **Then delete the scratch page.**

(d) Invitee self-insert: insert a pending `page_invitations` row for a scratch page (service role), then as the invitee uid:
```sql
SELECT set_config('request.jwt.claims', '{"sub":"<invitee-uid>", "email":"<invitee-email>"}', true);
INSERT INTO public.page_members (page_id, user_id, role) VALUES ('<page>', '<invitee-uid>', 'viewer');
```
Expected: INSERT succeeds (self-insert policy). Then delete the row (service role) and clean the scratch invitation.

(e) Pending legacy invite conversion: `SELECT count(*) FROM public.page_invitations WHERE status = 'pending';` — count should match the pre-existing pending `document_invitations` rows that had page mappings (compare against `SELECT count(*) FROM public.document_invitations di JOIN public.pages p ON p.source_document_id = di.document_id WHERE di.status = 'pending'` — counts must be equal; invitee/token values copied).

- [ ] **Step 3: Advisors check**

Run: `supabase_get_advisors` (security + performance). Expected: same intentional WARNs as P1 (SECURITY DEFINER helpers, auth.uid() guard pattern, pre-existing legacy warnings) — no NEW findings introduced by the new policies.

- [ ] **Step 4: Final review pass (controller)**

Run a whole-branch review: `git log --oneline main..HEAD`, verify each of the 10 tasks' commits exists and no stray files; confirm `git status` clean.

- [ ] **Step 5: Write the SDD handover**

Create `.superpowers/sdd/2026-08-15-p2-client-cutover/HANDOVER.md` (mirror the P1 handover structure: state, what was built, live verification results, gotchas, deferred items — e.g. `profiles.plan`/credits retirement rides on the billing plan; `fetchPastCollaborators` still reads legacy tables so it is empty for twin-less pages; the `page_members` stale-vs-live-grant problem is gone by construction because the legacy app no longer writes `document_members`).

- [ ] **Step 6: Commit**

```bash
git add .superpowers/sdd/2026-08-15-p2-client-cutover/HANDOVER.md
git commit -m "docs(handover): P2 client cutover handover"
```
(.superpowers is git-ignored — if `git add` warns, note that the handover is stored locally for the next session like P1's.)
