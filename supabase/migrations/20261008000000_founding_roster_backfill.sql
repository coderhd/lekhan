-- =====================================================================================
-- T14(a) — Founding-roster backfill (spec §4.4/§15, PDEC-6, plan T14).
--
-- Roster: the `join_waitlist` founding cohort, `waitlist.position <= 500` (position is
-- the numbered spot; there is no separate cohort table — see
-- docs/superpowers/specs/29-waitlist-ddl-snapshot.md).
--
-- Account mapping (pinned here, as PDEC-6 requires): the waitlist row is matched to a
-- real account through `referral_attribution.email_hash`, which the signup companion
-- trigger writes as `md5(lower(email))`. This is the mapping named in spec §4.4
-- ("matched to accounts at signup via the referral_attribution mapping").
--
-- Known, deliberate boundary: a founder who signed up WITHOUT a `?ref` has no
-- `referral_attribution` row and is therefore not matched by this backfill. That is a
-- product decision for the founding-roster owner (TL/PO), not silently widened here:
-- matching on `profiles.email` would mark accounts that never joined the waitlist.
--
-- Locking: `is_founding` is locked at subscription creation (spec §15, T6/T7 persist it
-- on the gateway object; T8 mirrors it). This migration only flips pre-existing rows
-- from `false` to `true`, never back, so later roster drift cannot re-price anyone.
--
-- Idempotent: re-running matches the same rows (or none); `is_founding = false` is the
-- only value updated.
--
-- The waitlist domain is out-of-band (PDEC-6): on environments where the waitlist table
-- has not been provisioned yet (fresh local DB, CI), the migration records a notice and
-- leaves every row untouched instead of failing the whole migration chain. Re-run it on
-- the target environment after the out-of-band DDL exists.
-- =====================================================================================

DO $$
DECLARE
	v_matched INTEGER := 0;
BEGIN
	IF to_regclass('public.waitlist') IS NULL THEN
		RAISE NOTICE 'founding_roster_backfill: public.waitlist is absent on this environment; skipping (PDEC-6 out-of-band DDL).';
		RETURN;
	END IF;

	WITH founding_accounts AS (
		SELECT DISTINCT ra.user_id
		FROM public.waitlist w
		JOIN public.referral_attribution ra
			ON ra.email_hash = md5(lower(w.email::text))
		WHERE w."position" <= 500
	)
	UPDATE public.workspace_plans wp
	SET is_founding = true,
		updated_at = timezone('utc'::text, now())
	FROM public.workspaces ws
	JOIN founding_accounts fa ON fa.user_id = ws.owner_id
	WHERE wp.workspace_id = ws.id
		AND wp.is_founding = false;

	GET DIAGNOSTICS v_matched = ROW_COUNT;
	RAISE NOTICE 'founding_roster_backfill: marked % workspace_plans row(s) founding.', v_matched;
END
$$;

-- Verification (run read-only after applying; expected: every row below is founding):
--
--   SELECT w."position", ra.user_id, wp.workspace_id, wp.is_founding
--   FROM public.waitlist w
--   JOIN public.referral_attribution ra ON ra.email_hash = md5(lower(w.email::text))
--   JOIN public.workspaces ws ON ws.owner_id = ra.user_id
--   JOIN public.workspace_plans wp ON wp.workspace_id = ws.id
--   WHERE w."position" <= 500
--   ORDER BY w."position";
--
-- Non-founding spot ≤ 500 accounts without attribution (the known boundary above):
--
--   SELECT count(*) FROM public.waitlist w
--   WHERE w."position" <= 500
--     AND NOT EXISTS (
--       SELECT 1 FROM public.referral_attribution ra
--       WHERE ra.email_hash = md5(lower(w.email::text))
--     );
