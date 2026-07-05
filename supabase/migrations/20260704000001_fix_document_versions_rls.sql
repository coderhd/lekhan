DROP POLICY IF EXISTS "select_versions" ON public.document_versions;
CREATE POLICY "select_versions" ON public.document_versions
FOR SELECT USING (
	EXISTS (
		SELECT 1 FROM public.documents d 
		WHERE d.id = document_id 
		AND (
			d.owner_id = auth.uid() 
			OR 
			EXISTS (SELECT 1 FROM public.document_members m WHERE m.document_id = d.id AND m.user_id = auth.uid())
		)
	)
);

DROP POLICY IF EXISTS "insert_versions" ON public.document_versions;
CREATE POLICY "insert_versions" ON public.document_versions
FOR INSERT WITH CHECK (
	EXISTS (
		SELECT 1 FROM public.documents d 
		WHERE d.id = document_id 
		AND (
			d.owner_id = auth.uid() 
			OR 
			EXISTS (SELECT 1 FROM public.document_members m WHERE m.document_id = d.id AND m.user_id = auth.uid() AND m.role = 'editor')
		)
	)
);
