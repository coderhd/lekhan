-- Restrict page_links SELECT to rows whose FROM page is accessible (PR review
-- finding #11). The previous OR-of-both-endpoints policy let any user with
-- access to ONE page enumerate links into it from private pages (leaking
-- private page titles). Backlinks for an accessible target remain visible
-- only when the linking (from) page is itself accessible.
DROP POLICY IF EXISTS select_page_links ON public.page_links;
CREATE POLICY select_page_links ON public.page_links
	FOR SELECT TO authenticated USING (public.can_access_page(from_page_id));
