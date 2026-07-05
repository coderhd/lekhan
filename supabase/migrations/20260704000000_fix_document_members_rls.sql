DROP POLICY IF EXISTS insert_members ON public.document_members;
CREATE POLICY insert_members ON public.document_members
	FOR INSERT WITH CHECK (
		EXISTS (
			SELECT 1 FROM public.documents 
			WHERE documents.id = public.document_members.document_id AND documents.owner_id = auth.uid()
		)
		OR
		(
			user_id = auth.uid() AND
			EXISTS (
				SELECT 1 FROM public.document_invitations
				WHERE document_invitations.document_id = public.document_members.document_id
				AND document_invitations.invitee_email = (SELECT email FROM public.profiles WHERE id = auth.uid())
				AND document_invitations.status = 'pending'
			)
		)
	);

DROP POLICY IF EXISTS update_invitations ON public.document_invitations;
CREATE POLICY update_invitations ON public.document_invitations
	FOR UPDATE USING (
		inviter_id = auth.uid() OR
		EXISTS (
			SELECT 1 FROM public.documents 
			WHERE documents.id = public.document_invitations.document_id AND documents.owner_id = auth.uid()
		) OR
		invitee_email = (SELECT email FROM public.profiles WHERE id = auth.uid())
	);
