-- Fix plpgsql variable/column ambiguity in both access helpers (found during
-- live review-finding verification). With the default plpgsql conflict mode
-- ('error'), an unqualified name that matches both a declared variable and a
-- column is an ERROR at runtime: `user_id` collides with
-- page_members.user_id / document_members.user_id, so every RLS evaluation of
-- can_access_page / can_access_document_storage with a real authenticated
-- user (and no early return) raised 42702. Rename the variables to v_uid.
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
			OR (
				p.source_document_id IS NOT NULL
				AND EXISTS (
					SELECT 1 FROM public.document_members dm
					WHERE dm.document_id = p.source_document_id AND dm.user_id = v_uid
				)
			)
		)
	);
END;
$$;

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
	v_uid uuid;
BEGIN
	v_uid := auth.uid();
	IF v_uid IS NULL THEN
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
			WHERE d.id::text = doc_id_text
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
			WHERE d.id::text = doc_id_text AND d.owner_id = v_uid
		);
	END IF;

	RETURN false;
END;
$$;
