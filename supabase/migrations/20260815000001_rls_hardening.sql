-- P2 RLS hardening (approved review follow-up): close two invitee escalation
-- paths in the page invitation flow.

-- 1. insert_page_members invitee self-insert: bind the inserted role to the
-- pending invitation's role so a viewer-invitee cannot self-insert as owner.
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
			AND pi.role = role
		)
	)
);

-- 2. update_page_invitations split: owner/inviter keep full control; the
-- invitee may only flip status to accepted/declined (cannot pivot page_id,
-- change the role, or keep the invite pending while editing it). The accept
-- flow inserts the page_members row while the invite is still pending, then
-- flips status — this ordering is preserved.
DROP POLICY IF EXISTS update_page_invitations ON public.page_invitations;
CREATE POLICY update_page_invitations_managed ON public.page_invitations
FOR UPDATE TO authenticated USING (
	EXISTS (SELECT 1 FROM public.pages p WHERE p.id = page_id AND p.owner_id = auth.uid())
	OR inviter_id = auth.uid()
);

CREATE POLICY update_page_invitations_invitee ON public.page_invitations
FOR UPDATE TO authenticated USING (
	invitee_email = (SELECT email FROM public.profiles WHERE id = auth.uid())
) WITH CHECK (
	status IN ('accepted', 'declined')
);
