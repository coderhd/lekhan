-- Pages-graph schema: workspaces, pages (universal node), members, links, tags.
-- Backfills from legacy documents tables. Legacy tables are preserved for rollback.

-- 1. Workspaces (one personal vault per owner in H0; team workspaces evolve in H2)
CREATE TABLE IF NOT EXISTS public.workspaces (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	name TEXT NOT NULL DEFAULT 'My Workspace',
	owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
	is_team BOOLEAN NOT NULL DEFAULT false,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
	UNIQUE (owner_id)
);

-- 2. Pages (universal node; replaces documents)
CREATE TABLE IF NOT EXISTS public.pages (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
	parent_id UUID REFERENCES public.pages(id) ON DELETE CASCADE,
	title TEXT NOT NULL DEFAULT 'Untitled',
	owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
	icon TEXT,
	cover TEXT,
	properties JSONB NOT NULL DEFAULT '{}'::jsonb,
	is_public BOOLEAN NOT NULL DEFAULT false,
	searchable_text TEXT DEFAULT '',
	source_document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS pages_workspace_parent_idx ON public.pages (workspace_id, parent_id);
CREATE INDEX IF NOT EXISTS pages_owner_idx ON public.pages (owner_id);
CREATE INDEX IF NOT EXISTS pages_source_document_idx ON public.pages (source_document_id);

-- 3. Page members (mirror of document_members)
CREATE TABLE IF NOT EXISTS public.page_members (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	page_id UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
	user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
	role member_role NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
	UNIQUE (page_id, user_id)
);
CREATE INDEX IF NOT EXISTS page_members_page_idx ON public.page_members (page_id);
CREATE INDEX IF NOT EXISTS page_members_user_idx ON public.page_members (user_id);

-- 4. Links index (Obsidian backlinks + Notion block refs)
CREATE TABLE IF NOT EXISTS public.page_links (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
	from_page_id UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
	to_page_id UUID REFERENCES public.pages(id) ON DELETE CASCADE,
	to_title TEXT NOT NULL,
	block_id TEXT,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
	UNIQUE (from_page_id, to_title)
);
CREATE INDEX IF NOT EXISTS page_links_from_idx ON public.page_links (from_page_id);
CREATE INDEX IF NOT EXISTS page_links_to_idx ON public.page_links (to_page_id);
CREATE INDEX IF NOT EXISTS page_links_workspace_idx ON public.page_links (workspace_id);

-- 5. Tags index
CREATE TABLE IF NOT EXISTS public.page_tags (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	page_id UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
	tag TEXT NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
	UNIQUE (page_id, tag)
);
CREATE INDEX IF NOT EXISTS page_tags_page_idx ON public.page_tags (page_id);
CREATE INDEX IF NOT EXISTS page_tags_tag_idx ON public.page_tags (tag);

-- 6. Access helper (mirrors can_access_document_storage pattern)
CREATE OR REPLACE FUNCTION public.can_access_page(target_page_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
	user_id uuid;
BEGIN
	user_id := auth.uid();
	IF user_id IS NULL THEN
		RETURN false;
	END IF;
	RETURN EXISTS (
		SELECT 1 FROM public.pages p
		WHERE p.id = target_page_id
		AND (
			p.owner_id = user_id
			OR p.is_public = true
			OR EXISTS (
				SELECT 1 FROM public.page_members m
				WHERE m.page_id = p.id AND m.user_id = user_id
			)
			OR (
				p.source_document_id IS NOT NULL
				AND EXISTS (
					SELECT 1 FROM public.document_members dm
					WHERE dm.document_id = p.source_document_id AND dm.user_id = user_id
				)
			)
		)
	);
END;
$$;

-- 7. RLS enable
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_tags ENABLE ROW LEVEL SECURITY;

-- 8. Workspaces policies
DROP POLICY IF EXISTS select_workspaces ON public.workspaces;
CREATE POLICY select_workspaces ON public.workspaces
	FOR SELECT TO authenticated USING (owner_id = auth.uid());

DROP POLICY IF EXISTS insert_workspaces ON public.workspaces;
CREATE POLICY insert_workspaces ON public.workspaces
	FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS update_workspaces ON public.workspaces;
CREATE POLICY update_workspaces ON public.workspaces
	FOR UPDATE TO authenticated USING (owner_id = auth.uid());

-- 9. Pages policies
DROP POLICY IF EXISTS select_pages ON public.pages;
CREATE POLICY select_pages ON public.pages
	FOR SELECT TO authenticated USING (public.can_access_page(id));

DROP POLICY IF EXISTS insert_pages ON public.pages;
CREATE POLICY insert_pages ON public.pages
	FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS update_pages ON public.pages;
CREATE POLICY update_pages ON public.pages
	FOR UPDATE TO authenticated USING (owner_id = auth.uid());

DROP POLICY IF EXISTS delete_pages ON public.pages;
CREATE POLICY delete_pages ON public.pages
	FOR DELETE TO authenticated USING (owner_id = auth.uid());

-- 10. Page members policies
DROP POLICY IF EXISTS select_page_members ON public.page_members;
CREATE POLICY select_page_members ON public.page_members
	FOR SELECT TO authenticated USING (public.can_access_page(page_id));

DROP POLICY IF EXISTS insert_page_members ON public.page_members;
CREATE POLICY insert_page_members ON public.page_members
	FOR INSERT TO authenticated WITH CHECK (
		EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
	);

DROP POLICY IF EXISTS delete_page_members ON public.page_members;
CREATE POLICY delete_page_members ON public.page_members
	FOR DELETE TO authenticated USING (
		EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
	);

-- 11. Links index policies (SELECT via accessibility of either endpoint; writes server-side via service key)
DROP POLICY IF EXISTS select_page_links ON public.page_links;
CREATE POLICY select_page_links ON public.page_links
	FOR SELECT TO authenticated USING (
		public.can_access_page(from_page_id) OR public.can_access_page(to_page_id)
	);

-- 12. Tags index policies
DROP POLICY IF EXISTS select_page_tags ON public.page_tags;
CREATE POLICY select_page_tags ON public.page_tags
	FOR SELECT TO authenticated USING (public.can_access_page(page_id));

-- 13. Backfill: one default workspace per profile
INSERT INTO public.workspaces (name, owner_id)
SELECT 'My Workspace', p.id
FROM public.profiles p
ON CONFLICT DO NOTHING;

-- 14. Backfill: pages from documents (page id == document id for migrated rows)
INSERT INTO public.pages (
	id, workspace_id, parent_id, title, owner_id,
	is_public, searchable_text, source_document_id, created_at, updated_at
)
SELECT
	d.id,
	w.id,
	NULL,
	d.title,
	d.owner_id,
	d.is_public,
	d.searchable_text,
	d.id,
	d.created_at,
	d.updated_at
FROM public.documents d
JOIN public.workspaces w ON w.owner_id = d.owner_id
ON CONFLICT (id) DO NOTHING;

-- 15. Backfill: page members from document members
INSERT INTO public.page_members (page_id, user_id, role, created_at)
SELECT p.id, m.user_id, m.role, m.created_at
FROM public.document_members m
JOIN public.pages p ON p.source_document_id = m.document_id
ON CONFLICT (page_id, user_id) DO NOTHING;

-- 16. Storage helper: allow page-based access for documents bucket objects
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
	user_id uuid;
BEGIN
	user_id := auth.uid();
	IF user_id IS NULL THEN
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
				d.owner_id = user_id
				OR d.is_public = true
				OR EXISTS (
					SELECT 1 FROM public.document_members m
					WHERE m.document_id = d.id AND m.user_id = user_id
				)
			)
		) OR EXISTS (
			SELECT 1 FROM public.pages p
			WHERE p.id::text = doc_id_text AND public.can_access_page(p.id)
		);
	ELSIF action IN ('insert', 'update') THEN
		RETURN EXISTS (
			SELECT 1 FROM public.documents d
			WHERE d.id::text = doc_id_text
			AND (
				d.owner_id = user_id
				OR EXISTS (
					SELECT 1 FROM public.document_members m
					WHERE m.document_id = d.id AND m.user_id = user_id AND m.role = 'editor'
				)
			)
		) OR EXISTS (
			SELECT 1 FROM public.pages p
			WHERE p.id::text = doc_id_text
			AND (
				p.owner_id = user_id
				OR EXISTS (
					SELECT 1 FROM public.page_members m
					WHERE m.page_id = p.id AND m.user_id = user_id AND m.role = 'editor'
				)
			)
		);
	ELSIF action = 'delete' THEN
		RETURN EXISTS (
			SELECT 1 FROM public.documents d
			WHERE d.id::text = doc_id_text AND d.owner_id = user_id
		) OR EXISTS (
			SELECT 1 FROM public.pages p
			WHERE p.id::text = doc_id_text AND p.owner_id = user_id
		);
	END IF;

	RETURN false;
END;
$$;
