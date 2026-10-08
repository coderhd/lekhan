-- Retroactive Page-link resolution (SIL-57 / #78 S1, plan §1 gap 2).
--
-- Creating a Page must resolve existing unresolved Page links
-- (`page_links.to_page_id IS NULL`) in the same Workspace whose `to_title`
-- matches the new Page's title — WITHOUT requiring the source Page to be
-- re-saved or re-indexed.
--
-- `page_links` intentionally has no authenticated UPDATE policy (writes are
-- server-side via the service key), so resolution cannot run from the client.
-- A SECURITY DEFINER trigger on `pages` performs it, strictly scoped by
-- `workspace_id` so a title in one Workspace can never resolve a link in
-- another.

-- Title normalization MUST match the JS `normalizeTitle` used by
-- server/graph-index.js: lowercase, trim, collapse internal whitespace.
CREATE OR REPLACE FUNCTION public.normalize_page_title(p_title text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
	SELECT lower(btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g')));
$$;

CREATE OR REPLACE FUNCTION public.resolve_unresolved_page_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
	UPDATE public.page_links
	SET to_page_id = NEW.id
	WHERE to_page_id IS NULL
		AND workspace_id = NEW.workspace_id
		AND public.normalize_page_title(to_title) = public.normalize_page_title(NEW.title);

	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resolve_unresolved_page_links_on_page ON public.pages;
CREATE TRIGGER resolve_unresolved_page_links_on_page
	AFTER INSERT OR UPDATE OF title ON public.pages
	FOR EACH ROW
	EXECUTE FUNCTION public.resolve_unresolved_page_links();

-- One-time backfill: resolve links that already match an existing Page (the
-- trigger only covers pages created/renamed after this migration).
UPDATE public.page_links l
SET to_page_id = p.id
FROM public.pages p
WHERE l.to_page_id IS NULL
	AND l.workspace_id = p.workspace_id
	AND public.normalize_page_title(l.to_title) = public.normalize_page_title(p.title);

-- Atomic Page-properties merge used by the paste path (Obsidian frontmatter →
-- Page properties). Deliberately NOT SECURITY DEFINER: it runs as the caller so
-- the owner-only `update_pages` RLS policy applies, and the single-statement
-- jsonb `||` avoids the lost-update race of a client read-modify-write.
CREATE OR REPLACE FUNCTION public.merge_page_properties(p_page_id uuid, p_patch jsonb)
RETURNS void
LANGUAGE sql
AS $$
	UPDATE public.pages
	SET properties = coalesce(properties, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb)
	WHERE id = p_page_id;
$$;
