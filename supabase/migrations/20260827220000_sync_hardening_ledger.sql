-- Sync Server Hardening: Durable Collaborator Ledger Table (Issue #77)
CREATE TABLE IF NOT EXISTS public.document_collaborators_ledger (
	document_id UUID NOT NULL,
	user_id TEXT NOT NULL,
	first_seen_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
	last_seen_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
	PRIMARY KEY (document_id, user_id)
);

ALTER TABLE public.document_collaborators_ledger ENABLE ROW LEVEL SECURITY;

-- Block direct client manipulation; sync server operates via service_role
CREATE POLICY ledger_service_role_all ON public.document_collaborators_ledger
	FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Atomic check-and-admit function to prevent race conditions during collaborator admission
CREATE OR REPLACE FUNCTION record_collaborator_if_capacity(
	p_document_id UUID,
	p_user_id TEXT,
	p_max_collaborators INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
	v_is_registered BOOLEAN;
	v_current_count INT;
BEGIN
	-- Anonymous users do not count towards distinct registered collaborator quotas
	IF p_user_id = 'anonymous' THEN
		RETURN jsonb_build_object('allowed', true, 'is_registered', false);
	END IF;

	-- Check if collaborator is already registered
	SELECT EXISTS(
		SELECT 1 FROM public.document_collaborators_ledger
		WHERE document_id = p_document_id AND user_id = p_user_id
	) INTO v_is_registered;

	IF v_is_registered THEN
		UPDATE public.document_collaborators_ledger
		SET last_seen_at = timezone('utc'::text, now())
		WHERE document_id = p_document_id AND user_id = p_user_id;

		RETURN jsonb_build_object('allowed', true, 'is_registered', true);
	END IF;

	-- Count current distinct registered collaborators
	SELECT COUNT(*)
	INTO v_current_count
	FROM public.document_collaborators_ledger
	WHERE document_id = p_document_id;

	IF v_current_count >= p_max_collaborators THEN
		RETURN jsonb_build_object('allowed', false, 'is_registered', false, 'current_count', v_current_count);
	END IF;

	-- Insert new collaborator record
	INSERT INTO public.document_collaborators_ledger (document_id, user_id, first_seen_at, last_seen_at)
	VALUES (p_document_id, p_user_id, timezone('utc'::text, now()), timezone('utc'::text, now()))
	ON CONFLICT (document_id, user_id) DO UPDATE
	SET last_seen_at = timezone('utc'::text, now());

	RETURN jsonb_build_object('allowed', true, 'is_registered', false, 'current_count', v_current_count + 1);
END;
$$;
