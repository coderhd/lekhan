-- Review follow-up: the BEFORE UPDATE trigger fired only when status changed
-- (WHEN OLD.status IS DISTINCT FROM NEW.status), leaving an owner-side gap —
-- an owner can edit non-status columns while leaving status unchanged (the
-- invitee side was covered by the WITH CHECK policy; the managed/owner policy
-- has none). Fire on every row update. True no-op updates (nothing changed)
-- are still allowed so idempotent retries keep working.

CREATE OR REPLACE FUNCTION public.restrict_invitation_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
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

	-- No-op update (only status field examined below; no other column differs).
	IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
		RETURN NEW;
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
EXECUTE FUNCTION public.restrict_invitation_update();