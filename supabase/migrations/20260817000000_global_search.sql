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
