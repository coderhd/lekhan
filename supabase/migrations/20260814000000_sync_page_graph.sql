-- Atomic, per-page serialized graph replacement (PR review finding #8).
-- indexPage (server/graph-index.js) computes link/tag rows in JS and hands
-- them to this function, which replaces page_links/page_tags and updates the
-- page in ONE transaction, serialized by a row lock on the page.
-- Rollback: any failure (constraint, update error) rolls back all writes.
-- Server-only: EXECUTE revoked from anon/authenticated; invoked via the
-- service key from the sync server.

CREATE OR REPLACE FUNCTION public.sync_page_graph(
	p_page_id uuid,
	p_workspace_id uuid,
	p_searchable_text text,
	p_links jsonb,
	p_tags jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
	v_link jsonb;
	v_tag jsonb;
	v_link_count integer := 0;
	v_tag_count integer := 0;
BEGIN
	-- Serialize per page: concurrent saves for the same page queue on this
	-- row lock, so delete-and-insert cannot interleave between saves.
	PERFORM 1 FROM public.pages WHERE id = p_page_id FOR UPDATE;
	IF NOT FOUND THEN
		RETURN jsonb_build_object('links', 0, 'tags', 0);
	END IF;

	-- Atomic replace of the link index for this page.
	DELETE FROM public.page_links WHERE from_page_id = p_page_id;
	IF p_links IS NOT NULL THEN
		FOR v_link IN SELECT * FROM jsonb_array_elements(p_links) LOOP
			INSERT INTO public.page_links (workspace_id, from_page_id, to_page_id, to_title)
			VALUES (p_workspace_id, p_page_id, (v_link->>'to_page_id')::uuid, v_link->>'to_title');
			v_link_count := v_link_count + 1;
		END LOOP;
	END IF;

	DELETE FROM public.page_tags WHERE page_id = p_page_id;
	IF p_tags IS NOT NULL THEN
		FOR v_tag IN SELECT * FROM jsonb_array_elements(p_tags) LOOP
			INSERT INTO public.page_tags (page_id, tag)
			VALUES (p_page_id, v_tag->>'tag');
			v_tag_count := v_tag_count + 1;
		END LOOP;
	END IF;

	UPDATE public.pages
	SET searchable_text = p_searchable_text,
		updated_at = timezone('utc'::text, now())
	WHERE id = p_page_id;

	RETURN jsonb_build_object('links', v_link_count, 'tags', v_tag_count);
END;
$$;

-- Server-only: invoked via the service key from the sync server. PUBLIC/anon/
-- authenticated are revoked so clients cannot call it via the REST rpc.
REVOKE EXECUTE ON FUNCTION public.sync_page_graph(uuid, uuid, text, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_page_graph(uuid, uuid, text, jsonb, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_page_graph(uuid, uuid, text, jsonb, jsonb) TO service_role;
