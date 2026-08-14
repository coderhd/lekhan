-- Advisor follow-up: pin the trigger function's search_path (it only touches
-- OLD/NEW records, no table access, but the database linter flags the mutable
-- default).

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

	IF OLD.status <> 'pending' THEN
		RAISE EXCEPTION 'invitation has already been resolved';
	END IF;

	IF NEW.status NOT IN ('accepted', 'declined') THEN
		RAISE EXCEPTION 'invitation status may only be set to accepted or declined';
	END IF;

	RETURN NEW;
END;
$$;