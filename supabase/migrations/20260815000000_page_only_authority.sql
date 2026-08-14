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
