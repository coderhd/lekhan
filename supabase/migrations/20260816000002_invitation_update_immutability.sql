-- P2 review follow-up: update_page_invitations_invitee validates only status
-- in its WITH CHECK (status IN ('accepted','declined')), so an invitee can
-- pivot page_id, role, invitee_email, inviter_id, or token in the same UPDATE
-- that resolves the invite. Policies cannot compare against the old row, so
-- enforce column immutability with a BEFORE UPDATE trigger: only status may
-- change, only while the invite is pending, and only to accepted/declined.
-- The app flow (insert member while pending, then flip status) is unaffected;
-- the invitee WITH CHECK policy remains as defense in depth.

CREATE OR REPLACE FUNCTION public.restrict_invitation_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF (
		OLD.page_id IS DISTINCT FROM NEW.page_id
		OR OLD.inviter_id IS DISTINCT FROM NEW.inviter_id
		OR OLD.invitee_email IS DISTINCT FROM NEW.invitee_email
		OR OLD.role IS DISTINCT FROM NEW.role
		OR OLD.token IS DISTINCT FROM NEW.token
	) THEN
		RAISE EXCEPTION 'invitation immutable fields cannot be changed';
	END IF;

	IF OLD.status <> 'pending' THEN
		RAISE EXCEPTION 'invitation has already been resolved';
	END IF;

	IF NEW.status NOT IN ('accepted', 'declined') THEN
		RAISE EXCEPTION 'invitation status may only be set to accepted or declined';
	END IF;

	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restrict_invitation_update ON public.page_invitations;
CREATE TRIGGER restrict_invitation_update
BEFORE UPDATE ON public.page_invitations
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.restrict_invitation_update();