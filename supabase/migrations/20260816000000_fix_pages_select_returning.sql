-- P2 bugfix: INSERT ... RETURNING on pages fails RLS (42501) even for the
-- page owner. createPage (services/graph.ts) and PostgREST return=representation
-- both generate INSERT ... RETURNING *, and the only authenticated SELECT
-- policy (select_pages = can_access_page(id)) subqueries the pages table
-- itself. At RETURNING check time the new row is not yet visible to that
-- self-subquery (statement snapshot), so the policy evaluates false and the
-- insert is rejected. Plain INSERT (no RETURNING) was unaffected, which is
-- why workspace creation (slot-based select_workspaces) worked.
--
-- Fix: rewrite select_pages slot-based — owner_id / is_public live on the
-- row being checked; the page_members subquery targets a different table
-- (member rows exist for real pages), so it is unaffected by the new-row
-- visibility gap. Semantics are identical to can_access_page(id) for
-- existing rows (owner OR public OR member).

DROP POLICY IF EXISTS select_pages ON public.pages;
CREATE POLICY select_pages ON public.pages
FOR SELECT TO authenticated USING (
	owner_id = auth.uid()
	OR is_public = true
	OR EXISTS (
		SELECT 1 FROM public.page_members m
		WHERE m.page_id = pages.id AND m.user_id = auth.uid()
	)
);
