-- Create documents storage bucket if it does not exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;
-- 1. Storage SELECT Policy: Allow document owners, members, and public document viewers to read version files
DROP POLICY IF EXISTS "select_documents_storage" ON storage.objects;
CREATE POLICY "select_documents_storage" ON storage.objects
FOR SELECT TO authenticated USING (
	bucket_id = 'documents'
	AND EXISTS (
		SELECT 1 FROM public.documents d
		WHERE d.id::text = split_part(name, '/', 1)
		AND (
			d.owner_id = auth.uid()
			OR d.is_public = true
			OR EXISTS (
				SELECT 1 FROM public.document_members m
				WHERE m.document_id = d.id AND m.user_id = auth.uid()
			)
		)
	)
);

-- 2. Storage INSERT Policy: Allow document owners and editors to upload version files
DROP POLICY IF EXISTS "insert_documents_storage" ON storage.objects;
CREATE POLICY "insert_documents_storage" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
	bucket_id = 'documents'
	AND EXISTS (
		SELECT 1 FROM public.documents d
		WHERE d.id::text = split_part(name, '/', 1)
		AND (
			d.owner_id = auth.uid()
			OR EXISTS (
				SELECT 1 FROM public.document_members m
				WHERE m.document_id = d.id AND m.user_id = auth.uid() AND m.role IN ('owner', 'editor')
			)
		)
	)
);

-- 3. Storage UPDATE Policy: Allow document owners and editors to update version files
DROP POLICY IF EXISTS "update_documents_storage" ON storage.objects;
CREATE POLICY "update_documents_storage" ON storage.objects
FOR UPDATE TO authenticated USING (
	bucket_id = 'documents'
	AND EXISTS (
		SELECT 1 FROM public.documents d
		WHERE d.id::text = split_part(name, '/', 1)
		AND (
			d.owner_id = auth.uid()
			OR EXISTS (
				SELECT 1 FROM public.document_members m
				WHERE m.document_id = d.id AND m.user_id = auth.uid() AND m.role IN ('owner', 'editor')
			)
		)
	)
);

-- 4. Storage DELETE Policy: Allow document owners to delete version files
DROP POLICY IF EXISTS "delete_documents_storage" ON storage.objects;
CREATE POLICY "delete_documents_storage" ON storage.objects
FOR DELETE TO authenticated USING (
	bucket_id = 'documents'
	AND EXISTS (
		SELECT 1 FROM public.documents d
		WHERE d.id::text = split_part(name, '/', 1)
		AND d.owner_id = auth.uid()
	)
);

-- Add storage_path column to public.document_versions if missing
ALTER TABLE public.document_versions
ADD COLUMN IF NOT EXISTS storage_path TEXT;

-- Set default auth.uid() on created_by column if not already set
ALTER TABLE public.document_versions
ALTER COLUMN created_by SET DEFAULT auth.uid();
