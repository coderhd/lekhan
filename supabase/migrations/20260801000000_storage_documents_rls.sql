-- Create documents storage bucket if it does not exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- Helper SQL authorization function for storage document access
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
		);
	ELSIF action = 'delete' THEN
		RETURN EXISTS (
			SELECT 1 FROM public.documents d
			WHERE d.id::text = doc_id_text AND d.owner_id = user_id
		);
	END IF;

	RETURN false;
END;
$$;

-- 1. Storage SELECT Policy: Allow document owners, members, and public document viewers to read version files
DROP POLICY IF EXISTS "select_documents_storage" ON storage.objects;
CREATE POLICY "select_documents_storage" ON storage.objects
FOR SELECT TO authenticated USING (
	bucket_id = 'documents'
	AND public.can_access_document_storage(name, 'select')
);

-- 2. Storage INSERT Policy: Allow document owners and editors to upload version files
DROP POLICY IF EXISTS "insert_documents_storage" ON storage.objects;
CREATE POLICY "insert_documents_storage" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
	bucket_id = 'documents'
	AND public.can_access_document_storage(name, 'insert')
);

-- 3. Storage UPDATE Policy: Allow document owners and editors to update version files
DROP POLICY IF EXISTS "update_documents_storage" ON storage.objects;
CREATE POLICY "update_documents_storage" ON storage.objects
FOR UPDATE TO authenticated USING (
	bucket_id = 'documents'
	AND public.can_access_document_storage(name, 'update')
);

-- 4. Storage DELETE Policy: Allow document owners to delete version files
DROP POLICY IF EXISTS "delete_documents_storage" ON storage.objects;
CREATE POLICY "delete_documents_storage" ON storage.objects
FOR DELETE TO authenticated USING (
	bucket_id = 'documents'
	AND public.can_access_document_storage(name, 'delete')
);

-- Add storage_path column to public.document_versions if missing
ALTER TABLE public.document_versions
ADD COLUMN IF NOT EXISTS storage_path TEXT;

-- Set default auth.uid() on created_by column if not already set
ALTER TABLE public.document_versions
ALTER COLUMN created_by SET DEFAULT auth.uid();
