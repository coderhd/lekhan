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
-- Known, deliberate boundary (RESOLVED by ADR 0005 / SIL-141): a founder who signed up
-- WITHOUT a `?ref` has no `referral_attribution` row and is therefore not matched by this
-- backfill. The narrow predicate is CONFIRMED — no email-fallback widening (waitlist emails
-- are unverified; a wrong grant is irreversible once the workspace subscribes). The gap is
-- owned by a MANDATORY manual reconciliation step in the SIL-140 apply runbook: review the
-- unmatched list (header query 3 below), grant only on exact lower(email) match to a single
-- auth user owning an unlocked plan row, and record the evidence in a QA doc.
--
-- Second boundary (RESOLVED by ADR 0005 / SIL-141): `confirmed_at` (the waitlist double
-- opt-in) is deliberately NOT part of the predicate. The spot is allocated and counted at
-- join time (join_waitlist allocates unconditionally; services/waitlist.ts counts all rows
-- toward the 500 cap), so unconfirmed spots <= 500 are cohort members; confirmation is a
-- deliverability gate, not a cohort gate.
--
-- Third boundary (RESOLVED by ADR 0005 / SIL-141): founding pricing FOLLOWS THE FOUNDER,
-- per workspace — this backfill marks every workspace owned by a matched founding account
-- (not one-per-founder). New workspaces created after this backfill inherit is_founding at
-- plan creation via the companion inheritance migration (ADR 0005 Q2); ownership transfer
-- re-evaluates founding from the new owner (US-8 guardrail, ADR 0005).
--
-- Locking (spec §15): `is_founding` is persisted once, at subscription creation.
-- This backfill therefore only ever touches rows that have NEVER been subscribed:
-- `status = 'none'` AND `gateway_subscription_id IS NULL` AND `is_founding = false`.
-- A founder who already subscribed at GA is reported (notice) but NOT re-priced —
-- flipping them would contradict the "locked at subscription creation" invariant and
-- could change the next renewal or portal plan change.
--
-- Idempotent: re-running matches the same rows (or none); `is_founding = false` is the
-- only value updated and never back.
--
-- Out-of-band DDL (PDEC-6): the waitlist objects are not in supabase/migrations/. On an
-- environment where `public.waitlist` (or the T3-created `referral_attribution`) is
-- absent, the migration records a notice and leaves every row untouched instead of
-- failing the whole chain. Migration tooling records the version as applied in that
-- case, so the backfill MUST be re-run by hand on the target environment once the
-- out-of-band DDL exists (`psql -f` this file, or `supabase db push --include-all`
-- after deleting nothing). The NOTICE line is the proof of the run.
-- =====================================================================================

DO $$
DECLARE
	v_matched INTEGER := 0;
	v_locked INTEGER := 0;
	v_no_plan INTEGER := 0;
BEGIN
	IF to_regclass('public.waitlist') IS NULL THEN
		RAISE NOTICE 'founding_roster_backfill: public.waitlist is absent on this environment; skipping (PDEC-6 out-of-band DDL).';
		RETURN;
	END IF;

	IF to_regclass('public.referral_attribution') IS NULL THEN
		RAISE NOTICE 'founding_roster_backfill: public.referral_attribution is absent (T3 migration not applied); skipping.';
		RETURN;
	END IF;

	CREATE TEMP TABLE _t14_founding_accounts ON COMMIT DROP AS
	SELECT DISTINCT ra.user_id AS user_id
	FROM public.waitlist w
	JOIN public.referral_attribution ra
		ON ra.email_hash = md5(lower(w.email::text))
	WHERE w."position" <= 500;

	-- Matched founders that must NOT be retro-priced (already subscribed at GA).
	SELECT count(*) INTO v_locked
	FROM public.workspace_plans wp
	JOIN public.workspaces ws ON ws.id = wp.workspace_id
	JOIN _t14_founding_accounts fa ON fa.user_id = ws.owner_id
	WHERE wp.is_founding = false
		AND (wp.status <> 'none' OR wp.gateway_subscription_id IS NOT NULL);

	-- Matched founders whose workspace has no workspace_plans row (reported, not created:
	-- the T3 backfill owns row creation; silently inserting here would mask a partial apply).
	SELECT count(*) INTO v_no_plan
	FROM _t14_founding_accounts fa
	WHERE EXISTS (SELECT 1 FROM public.workspaces ws WHERE ws.owner_id = fa.user_id)
		AND NOT EXISTS (
			SELECT 1
			FROM public.workspaces ws
			JOIN public.workspace_plans wp ON wp.workspace_id = ws.id
			WHERE ws.owner_id = fa.user_id
		);

	UPDATE public.workspace_plans wp
	SET is_founding = true,
		updated_at = timezone('utc'::text, now())
	FROM public.workspaces ws
	JOIN _t14_founding_accounts fa ON fa.user_id = ws.owner_id
	WHERE wp.workspace_id = ws.id
		AND wp.is_founding = false
		AND wp.status = 'none'
		AND wp.gateway_subscription_id IS NULL;

	GET DIAGNOSTICS v_matched = ROW_COUNT;

	RAISE NOTICE 'founding_roster_backfill: marked % workspace_plans row(s) founding; % matched row(s) left locked (already subscribed); % founder account(s) have no workspace_plans row.',
		v_matched, v_locked, v_no_plan;

	DROP TABLE IF EXISTS _t14_founding_accounts;
END
$$;

-- Verification (run read-only after applying):
--
-- 1. Founding rows — every row below must be `is_founding = true`:
--
--   SELECT w."position", ra.user_id, wp.workspace_id, wp.is_founding, wp.status
--   FROM public.waitlist w
--   JOIN public.referral_attribution ra ON ra.email_hash = md5(lower(w.email::text))
--   JOIN public.workspaces ws ON ws.owner_id = ra.user_id
--   JOIN public.workspace_plans wp ON wp.workspace_id = ws.id
--   WHERE w."position" <= 500
--   ORDER BY w."position";
--
-- 2. Founders that stayed non-founding ON PURPOSE (already subscribed) — expected
--    non-empty only when someone bought before this migration ran:
--
--   SELECT w."position", wp.status, wp.gateway_subscription_id
--   FROM public.waitlist w
--   JOIN public.referral_attribution ra ON ra.email_hash = md5(lower(w.email::text))
--   JOIN public.workspaces ws ON ws.owner_id = ra.user_id
--   JOIN public.workspace_plans wp ON wp.workspace_id = ws.id
--   WHERE w."position" <= 500 AND wp.is_founding = false
--   ORDER BY w."position";
--
-- 3. Spot <= 500 accounts with no attribution (the `?ref`-less boundary, SIL-141):
--
--   SELECT count(*) FROM public.waitlist w
--   WHERE w."position" <= 500
--     AND NOT EXISTS (
--       SELECT 1 FROM public.referral_attribution ra
--       WHERE ra.email_hash = md5(lower(w.email::text))
--     );
--
-- 4. Matched founders with no workspace_plans row (reported by the NOTICE):
--
--   SELECT DISTINCT ra.user_id
--   FROM public.waitlist w
--   JOIN public.referral_attribution ra ON ra.email_hash = md5(lower(w.email::text))
--   JOIN public.workspaces ws ON ws.owner_id = ra.user_id
--   WHERE w."position" <= 500
--     AND NOT EXISTS (
--       SELECT 1 FROM public.workspace_plans wp WHERE wp.workspace_id = ws.id
--     );
