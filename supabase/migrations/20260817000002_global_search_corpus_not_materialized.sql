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
	v_limit := greatest(least(coalesce(p_limit, 15), 50), 0);
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
		-- NOT MATERIALIZED: corpus is referenced by several UNION branches and
		-- materializing it would block pushdown of the title/searchable_text
		-- ILIKE predicates onto the pages GIN indexes. Inlining keeps the
		-- owner-or-member access predicate intact while letting the planner
		-- use the trigram indexes.
		WITH corpus AS NOT MATERIALIZED (
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