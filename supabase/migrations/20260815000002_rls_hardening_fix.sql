-- P2 RLS hardening fix: qualify outer-column references in the invitee
-- self-insert arm. Unqualified `page_id`/`role` inside the EXISTS subquery
-- bind to the inner page_invitations row (innermost scope wins), making the
-- checks always-true. Qualifying with `page_members.` forces outer binding
-- (same pattern the legacy insert_members policy uses).

DROP POLICY IF EXISTS insert_page_members ON public.page_members;
CREATE POLICY insert_page_members ON public.page_members
FOR INSERT TO authenticated WITH CHECK (
	EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
	OR (
		user_id = auth.uid()
		AND EXISTS (
			SELECT 1 FROM public.page_invitations pi
			WHERE pi.page_id = public.page_members.page_id
			AND pi.invitee_email = (SELECT email FROM public.profiles WHERE id = auth.uid())
			AND pi.status = 'pending'
			AND pi.role = public.page_members.role
		)
	)
);
