-- Pages access hardening (final review findings #2/#3).
-- Overrides land in a NEW migration rather than editing the reviewed
-- 20260812000000_pages_graph_schema.sql.

-- Finding #2: anon must be able to SELECT public pages (mirrors legacy
-- select_documents which has no TO clause because it is safe by is_public).
DROP POLICY IF EXISTS select_pages_public ON public.pages;
CREATE POLICY select_pages_public ON public.pages
	FOR SELECT TO anon USING (is_public = true);

-- Finding #3: insert_pages previously asserted only auth.uid() = owner_id,
-- which lets a user claim a page in someone else's workspace. Require
-- workspace ownership (one personal workspace per owner in H0).
DROP POLICY IF EXISTS insert_pages ON public.pages;
CREATE POLICY insert_pages ON public.pages
	FOR INSERT TO authenticated WITH CHECK (
		auth.uid() = owner_id
		AND EXISTS (
			SELECT 1 FROM public.workspaces w
			WHERE w.id = workspace_id AND w.owner_id = auth.uid()
		)
	);