-- T9-rev — referral credit claim semantics + stage-agnostic deferred resolver.
--
-- WHY this companion migration (clean-room review cycle 1 on the T9 diff,
-- docs/reviews/29-t9-referral-credits-review.md, cycle 1 BLOCKING findings 2/4):
--
--  1. `claimed_at` separates the apply-time CLAIM from the settled truth in
--     `applied_at` (spec: `applied_at` is set on the CONFIRMING invoice.paid).
--     Previously a process crash between claim and provider call left rows that
--     looked settled (applied_at set) but never credited the customer — a
--     silently forfeited credit. Claims now live in `claimed_at`, are released
--     on provider failure, and stale claims are recovered on the next renewal;
--     the row-set-derived idempotency key makes a recovered replay settle the
--     SAME provider transaction exactly once.
--
--  2. The workspaces-INSERT deferred resolver filtered
--     `trigger_stage = 'activation'`, so a deferred CONVERSION row
--     (workspace_id NULL, PDEC-4) could never attach to the referrer's
--     workspace once it materialized — banked + cap-counted, but invisible in
--     the summary and unredeemable forever. The resolver now attaches BOTH
--     stages; the bump stays count-guarded (per-resolved-row), so per-stage
--     dedup and the T9 service's own insert-guarded writes remain exactly-once
--     (disjoint guards: the service only touches rows still attachment-pending).

ALTER TABLE public.referral_credit_ledger
	ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

COMMENT ON COLUMN public.referral_credit_ledger.claimed_at IS
	'Apply-time claim stamp for applyCreditsAtRenewal (distinct from the settled truth in applied_at). Released on provider failure; stale claims are released after a claim TTL and recovered on the next renewal.';

-- Stage-agnostic deferred resolver (see header note 2): identical to the T3
-- body except the attachment UPDATE no longer filters trigger_stage.
CREATE OR REPLACE FUNCTION public.handle_workspace_created_billing()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
	v_ref TEXT;
	v_referrer UUID;
	v_referrer_workspace UUID;
	v_invitee_ref TEXT;
	v_inserted_id UUID;
	v_resolved INTEGER;
BEGIN
	v_invitee_ref := NEW.owner_id::text;

	-- Ensure the billing root exists for the workspace just created (completes the
	-- backfill for post-migration workspaces) so later credit bumps have a row to land on.
	INSERT INTO public.workspace_plans (workspace_id, tier)
	SELECT NEW.id, public.normalize_legacy_plan(p.plan)
	FROM public.profiles p
	WHERE p.id = NEW.owner_id
	ON CONFLICT (workspace_id) DO NOTHING;

	-- (c.1) Resolve deferred grants where THIS owner is the referrer: the referrer's
	-- workspace has just materialized, so attach the pending rows (EITHER stage —
	-- T9-rev; the old activation-only filter stranded deferred conversion rows) and
	-- bump the counter by exactly the rows this statement actually attached.
	WITH resolved AS (
		UPDATE public.referral_credit_ledger
		SET workspace_id = NEW.id
		WHERE referrer_user_id = NEW.owner_id
			AND workspace_id IS NULL
		RETURNING 1
	)
	SELECT count(*)::int INTO v_resolved FROM resolved;

	IF v_resolved > 0 THEN
		UPDATE public.workspace_plans
		SET credited_months = credited_months + v_resolved,
			updated_at = timezone('utc'::text, now())
		WHERE workspace_id = NEW.id;
	END IF;

	-- (c.2) This owner may also be an invitee: resolve their attribution and bank the
	-- activation grant on the referrer's workspace (or defer it).
	SELECT ra.ref INTO v_ref
	FROM public.referral_attribution ra
	WHERE ra.user_id = NEW.owner_id;

	IF v_ref IS NOT NULL THEN
		BEGIN
			v_referrer := v_ref::uuid;
		EXCEPTION WHEN invalid_text_representation THEN
			v_referrer := NULL;
		END;

		-- Self-referral (same user) and non-user refs grant nothing. The profile guard
		-- also protects the ledger FK (a bad ref must never break workspace creation).
		IF v_referrer IS NOT NULL
			AND v_referrer <> NEW.owner_id
			AND EXISTS (SELECT 1 FROM public.profiles WHERE id = v_referrer) THEN
			SELECT w.id INTO v_referrer_workspace
			FROM public.workspaces w
			WHERE w.owner_id = v_referrer
			LIMIT 1;

			INSERT INTO public.referral_credit_ledger (
				workspace_id, referrer_user_id, source_ref, invitee_ref,
				invitee_user_id, trigger_stage, months, granted_at
			) VALUES (
				v_referrer_workspace, v_referrer, v_ref, v_invitee_ref,
				NEW.owner_id, 'activation', 1, timezone('utc'::text, now())
			)
			ON CONFLICT DO NOTHING
			RETURNING id INTO v_inserted_id;

			-- Bump only when a new row actually landed (dedup-safe) and the grant is
			-- resolved (deferred rows wait for the referrer's own trigger).
			IF v_inserted_id IS NOT NULL AND v_referrer_workspace IS NOT NULL THEN
				INSERT INTO public.workspace_plans (workspace_id, tier)
				SELECT v_referrer_workspace, public.normalize_legacy_plan(p.plan)
				FROM public.profiles p
				WHERE p.id = v_referrer
				ON CONFLICT (workspace_id) DO NOTHING;

				UPDATE public.workspace_plans
				SET credited_months = credited_months + 1,
					updated_at = timezone('utc'::text, now())
				WHERE workspace_id = v_referrer_workspace;
			END IF;
		END IF;
	END IF;

	RETURN NEW;
END;
$$;
