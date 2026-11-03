-- =====================================================================================
-- T14(c) — Founding follows the owner (ADR 0005 Q2 / SIL-141 binding ruling, PDEC-13).
--
-- Ruling: founding pricing FOLLOWS THE FOUNDER, per workspace — not one-per-founder.
-- The roster backfill (`20261008000000`) marks every workspace a matched founding
-- account owned at backfill time. This migration closes the temporal gap: a workspace
-- created AFTER that backfill must also inherit founding status, because nothing else
-- ever re-derives `is_founding` (it is persisted once at subscription creation, spec
-- §15, and checkout resolves prices only from the persisted flag).
--
-- Mechanism (billing-tables only — no waitlist coupling, PDEC-6 clean):
--   1. An AFTER INSERT trigger on `workspace_plans`: a fresh plan row flips
--      `is_founding = true` when its owner ALREADY owns another workspace whose plan
--      row is founding. Only owners with an existing founding workspace can propagate —
--      no non-cohort account can self-grant.
--   2. A one-shot idempotent catch-up UPDATE for plan rows created before this
--      migration whose owner has since become founding (e.g. via a later backfill
--      re-run or manual reconciliation).
--
-- Lock guards (identical to the roster backfill): only `is_founding = false` AND
-- `status = 'none'` AND `gateway_subscription_id IS NULL` rows are ever touched.
-- A workspace already locked with a live founding subscription keeps its locked price
-- with the subscription; transfer semantics are pinned in ADR 0005 (US-8 guardrail).
--
-- Idempotent: re-running re-creates the same trigger (no-op) and the catch-up matches
-- the same rows (or none); `updated_at` does not drift once every eligible row is true.
-- =====================================================================================

-- 1. Inheritance trigger — fires whenever a workspace_plans row is materialized
--    (workspaces-insert billing trigger, T3 backfill re-runs, webhook inserts).
CREATE OR REPLACE FUNCTION public.handle_workspace_plan_founding_inherit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
	UPDATE public.workspace_plans wp
	SET is_founding = true,
		updated_at = timezone('utc'::text, now())
	WHERE wp.workspace_id = NEW.workspace_id
		AND wp.is_founding = false
		AND wp.status = 'none'
		AND wp.gateway_subscription_id IS NULL
		AND EXISTS (
			SELECT 1
			FROM public.workspaces mine
			JOIN public.workspaces sib
				ON sib.owner_id = mine.owner_id
				AND sib.id <> mine.id
			JOIN public.workspace_plans sibp
				ON sibp.workspace_id = sib.id
			WHERE mine.id = NEW.workspace_id
				AND sibp.is_founding = true
		);
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_workspace_plan_created_founding_inherit ON public.workspace_plans;
CREATE TRIGGER on_workspace_plan_created_founding_inherit
	AFTER INSERT ON public.workspace_plans
	FOR EACH ROW EXECUTE FUNCTION public.handle_workspace_plan_founding_inherit();

-- 2. One-shot catch-up for rows created before this migration whose owner has since
--    become founding elsewhere (backfill re-run, manual reconciliation, sibling flip).
DO $$
DECLARE
	v_caught INTEGER := 0;
BEGIN
	UPDATE public.workspace_plans wp
	SET is_founding = true,
		updated_at = timezone('utc'::text, now())
	FROM public.workspaces ws
	WHERE wp.workspace_id = ws.id
		AND wp.is_founding = false
		AND wp.status = 'none'
		AND wp.gateway_subscription_id IS NULL
		AND EXISTS (
			SELECT 1
			FROM public.workspaces sib
			JOIN public.workspace_plans sibp
				ON sibp.workspace_id = sib.id
			WHERE sib.owner_id = ws.owner_id
				AND sib.id <> ws.id
				AND sibp.is_founding = true
		);

	GET DIAGNOSTICS v_caught = ROW_COUNT;
	RAISE NOTICE 'founding_follows_owner: inherited founding onto % workspace(s) whose owner already has a founding workspace.', v_caught;
END
$$;

-- Verification (run read-only after applying; expected: empty — no unlocked workspace of a
-- founding owner may remain non-founding):
--
--   SELECT wp.workspace_id, ws.owner_id
--   FROM public.workspaces ws
--   JOIN public.workspace_plans wp ON wp.workspace_id = ws.id
--   WHERE wp.is_founding = false
--     AND wp.status = 'none'
--     AND wp.gateway_subscription_id IS NULL
--     AND EXISTS (
--       SELECT 1 FROM public.workspaces sib
--       JOIN public.workspace_plans sibp ON sibp.workspace_id = sib.id
--       WHERE sib.owner_id = ws.owner_id AND sib.id <> ws.id AND sibp.is_founding = true
--     );
--
-- Founding audit (every unlocked workspace of every founding owner):
--
--   SELECT ws.owner_id, ws.id, wp.is_founding, wp.status
--   FROM public.workspaces ws
--   JOIN public.workspace_plans wp ON wp.workspace_id = ws.id
--   WHERE ws.owner_id IN (
--     SELECT DISTINCT ra.user_id
--     FROM public.waitlist w
--     JOIN public.referral_attribution ra ON ra.email_hash = md5(lower(w.email::text))
--     WHERE w."position" <= 500
--   )
--   ORDER BY ws.owner_id, ws.id;
