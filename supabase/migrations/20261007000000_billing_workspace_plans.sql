-- H0 Real Billing — base schema (plan T3 / spec §4; PDEC-4/5; TL round-2 B3 + note 5).
--
-- Workspace is the billing root: one `workspace_plans` row per `workspaces` row. This
-- migration is additive and idempotent (safe to re-apply). It references NO waitlist
-- objects (PDEC-6) — the founding-roster backfill is a separate T14 migration.
--
-- Boundaries (spec §13): no gateway/price logic lives here; no card data; `profiles.plan`
-- semantics are untouched (it becomes a deprecated read-only mirror maintained by T8).
-- Amounts/price IDs are env-resolved (T2 `lib/billing/prices.ts`); `plan_tiers` is a
-- catalog + limits-snapshot mirror kept for audit/reference only.

-- =====================================================================================
-- 1. plan_tiers — static catalog + limits snapshot mirror of lib/tier-limits.ts
-- =====================================================================================
CREATE TABLE IF NOT EXISTS public.plan_tiers (
	id TEXT PRIMARY KEY,
	tier TEXT NOT NULL UNIQUE CHECK (tier IN ('free', 'plus', 'pro', 'team')),
	display_name TEXT NOT NULL,
	description TEXT,
	-- Founding cohort prices (locked for life); GA = standard pricing after launch.
	founding_monthly_usd_cents INTEGER,
	founding_annual_usd_cents INTEGER,
	ga_monthly_usd_cents INTEGER,
	ga_annual_usd_cents INTEGER,
	founding_monthly_inr_paise INTEGER,
	founding_annual_inr_paise INTEGER,
	ga_monthly_inr_paise INTEGER,
	ga_annual_inr_paise INTEGER,
	-- Team: per-seat USD volume tiers as JSONB ([{ minSeats, maxSeats, usdCents }]).
	seat_price_tiers JSONB,
	min_seats INTEGER,
	max_seats INTEGER,
	-- Snapshot mirror of lib/tier-limits.ts (audit/reference; enforcement reads the code).
	limits JSONB NOT NULL DEFAULT '{}'::jsonb,
	created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Seed the four launch tiers. Prices mirror docs/marketing/founding-cohort-launch.md and
-- are reference-only: the env-bound resolution in T2 remains the single source of truth.
INSERT INTO public.plan_tiers (
	id, tier, display_name, description,
	founding_monthly_usd_cents, founding_annual_usd_cents, ga_monthly_usd_cents, ga_annual_usd_cents,
	founding_monthly_inr_paise, founding_annual_inr_paise, ga_monthly_inr_paise, ga_annual_inr_paise,
	seat_price_tiers, min_seats, max_seats, limits
) VALUES
	('free', 'free', 'Free', 'Unlimited local pages, PKM core, markdown, AI via your own keys.',
		0, 0, 0, 0, 0, 0, 0, 0, NULL, NULL, NULL,
		'{"historyRetentionDays": 1, "maxDistinctCollaborators": 2, "maxStorageMb": 20}'::jsonb),
	('plus', 'plus', 'Plus', 'Sync, extended history, and larger storage.',
		400, 4000, 600, 6000, 24900, 249900, 49900, 499000, NULL, NULL, NULL,
		'{"historyRetentionDays": 90, "maxDistinctCollaborators": 10, "maxStorageMb": 10000}'::jsonb),
	('pro', 'pro', 'Pro', 'Full retention envelope for power users.',
		800, 8000, 1200, 12000, 49900, 499900, 99900, 999900, NULL, NULL, NULL,
		'{"historyRetentionDays": 365, "maxDistinctCollaborators": 25, "maxStorageMb": 50000}'::jsonb),
	('team', 'team', 'Team', 'Collaborative vault; per-seat USD pricing (owner excluded).',
		800, 8000, 1000, 10000, NULL, NULL, NULL, NULL,
		'[{"minSeats": 2, "maxSeats": 10, "usdCents": 800}, {"minSeats": 11, "maxSeats": 25, "usdCents": 700}, {"minSeats": 26, "maxSeats": null, "usdCents": 600}]'::jsonb,
		2, NULL,
		'{"historyRetentionDays": 365, "maxStorageMb": 50000, "maxDistinctCollaborators": "seats"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- =====================================================================================
-- 2. workspace_plans — mutable entitlement state, keyed by workspaces.id (billing root)
-- =====================================================================================
-- Spec §4.2 minus `credit_overlay_months` (retired, PDEC-10 nit-1: `credited_months` is
-- the persisted banked counter; banked-vs-applied truth is ledger `applied_at`).
-- TL round-2 B3 adds the state columns below.
CREATE TABLE IF NOT EXISTS public.workspace_plans (
	workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
	tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'plus', 'pro', 'team')),
	billing_cycle TEXT NOT NULL DEFAULT 'none' CHECK (billing_cycle IN ('monthly', 'annual', 'none')),
	gateway TEXT NOT NULL DEFAULT 'none' CHECK (gateway IN ('stripe', 'razorpay', 'none')),
	gateway_customer_id TEXT,
	gateway_subscription_id TEXT,
	currency TEXT CHECK (currency IN ('USD', 'INR')),
	is_founding BOOLEAN NOT NULL DEFAULT false,
	seats INTEGER,
	status TEXT NOT NULL DEFAULT 'none' CHECK (status IN ('active', 'past_due', 'canceled', 'incomplete', 'none')),
	-- Gateway-mirrored only (spec §8): the provider is the sole renewer; never a local write.
	current_period_end TIMESTAMPTZ,
	credited_months INTEGER NOT NULL DEFAULT 0 CHECK (credited_months >= 0),
	-- TL B3 state columns:
	cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
	past_due_since TIMESTAMPTZ,
	last_checked_at TIMESTAMPTZ,
	created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- =====================================================================================
-- 3. gateway_events — raw webhook audit + idempotency (payload is audit-only, spec §6)
-- =====================================================================================
CREATE TABLE IF NOT EXISTS public.gateway_events (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	gateway TEXT NOT NULL CHECK (gateway IN ('stripe', 'razorpay')),
	event_id TEXT NOT NULL UNIQUE,
	type TEXT NOT NULL,
	payload JSONB NOT NULL DEFAULT '{}'::jsonb,
	processed_at TIMESTAMPTZ,
	created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- =====================================================================================
-- 4. referral_credit_ledger — banked referral months (spec §4.3/§8)
-- =====================================================================================
-- `workspace_id` is the REFERRER's workspace (the credit banks there, US-10 AC1) and is
-- NULL while the referrer's workspace does not exist yet (deferred grant, PDEC-4); the
-- row is then keyed to `referrer_user_id` and resolved by the referrer's own
-- workspaces-insert trigger. `invitee_ref` is the stable per-invitee dedup key (the
-- invitee's user id), so UNIQUE(..., invitee_ref, trigger_stage) grants once per distinct
-- invitee per stage; `source_ref` carries the raw referral code from referral_attribution.
CREATE TABLE IF NOT EXISTS public.referral_credit_ledger (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
	referrer_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
	source_ref TEXT,
	invitee_ref TEXT NOT NULL,
	invitee_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
	trigger_stage TEXT NOT NULL CHECK (trigger_stage IN ('activation', 'conversion')),
	months INTEGER NOT NULL DEFAULT 1 CHECK (months > 0),
	granted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
	applied_at TIMESTAMPTZ,
	CONSTRAINT referral_credit_ledger_workspace_invitee_stage_key
		UNIQUE (workspace_id, invitee_ref, trigger_stage)
);

-- TL round-2 note 5: Postgres NULLs escape the full UNIQUE, so add a partial unique index
-- as belt-and-braces for the deferred (workspace_id IS NULL) rows.
CREATE UNIQUE INDEX IF NOT EXISTS referral_credit_ledger_deferred_stage_key
	ON public.referral_credit_ledger (invitee_ref, trigger_stage)
	WHERE workspace_id IS NULL;

CREATE INDEX IF NOT EXISTS referral_credit_ledger_referrer_idx
	ON public.referral_credit_ledger (referrer_user_id);
CREATE INDEX IF NOT EXISTS referral_credit_ledger_workspace_idx
	ON public.referral_credit_ledger (workspace_id);

-- =====================================================================================
-- 5. referral_attribution — waitlist/?ref → activated account mapping (spec §4.3)
-- =====================================================================================
CREATE TABLE IF NOT EXISTS public.referral_attribution (
	user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
	ref TEXT NOT NULL,
	email_hash TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- =====================================================================================
-- 6. RLS — owner read-own via workspaces.owner_id; ALL writes service-role only
-- =====================================================================================
ALTER TABLE public.plan_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateway_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_attribution ENABLE ROW LEVEL SECURITY;

-- plan_tiers: public catalog, read-only to clients.
DROP POLICY IF EXISTS select_plan_tiers ON public.plan_tiers;
CREATE POLICY select_plan_tiers ON public.plan_tiers
	FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS plan_tiers_service_role_all ON public.plan_tiers;
CREATE POLICY plan_tiers_service_role_all ON public.plan_tiers
	FOR ALL TO service_role USING (true) WITH CHECK (true);

-- workspace_plans: owner reads their own row only (writes are service-role only).
DROP POLICY IF EXISTS select_workspace_plans ON public.workspace_plans;
CREATE POLICY select_workspace_plans ON public.workspace_plans
	FOR SELECT TO authenticated USING (
		EXISTS (
			SELECT 1 FROM public.workspaces w
			WHERE w.id = workspace_id AND w.owner_id = auth.uid()
		)
	);
DROP POLICY IF EXISTS workspace_plans_service_role_all ON public.workspace_plans;
CREATE POLICY workspace_plans_service_role_all ON public.workspace_plans
	FOR ALL TO service_role USING (true) WITH CHECK (true);

-- gateway_events: audit-only; no client access at all (service-role only).
DROP POLICY IF EXISTS gateway_events_service_role_all ON public.gateway_events;
CREATE POLICY gateway_events_service_role_all ON public.gateway_events
	FOR ALL TO service_role USING (true) WITH CHECK (true);

-- referral_credit_ledger: a user may read rows resolved to their own workspace, plus any
-- deferred rows keyed to them as the referrer (workspace_id IS NULL).
DROP POLICY IF EXISTS select_referral_credit_ledger ON public.referral_credit_ledger;
CREATE POLICY select_referral_credit_ledger ON public.referral_credit_ledger
	FOR SELECT TO authenticated USING (
		referrer_user_id = auth.uid()
		OR EXISTS (
			SELECT 1 FROM public.workspaces w
			WHERE w.id = workspace_id AND w.owner_id = auth.uid()
		)
	);
DROP POLICY IF EXISTS referral_credit_ledger_service_role_all ON public.referral_credit_ledger;
CREATE POLICY referral_credit_ledger_service_role_all ON public.referral_credit_ledger
	FOR ALL TO service_role USING (true) WITH CHECK (true);

-- referral_attribution: a user may read their own attribution row only.
DROP POLICY IF EXISTS select_referral_attribution ON public.referral_attribution;
CREATE POLICY select_referral_attribution ON public.referral_attribution
	FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS referral_attribution_service_role_all ON public.referral_attribution;
CREATE POLICY referral_attribution_service_role_all ON public.referral_attribution
	FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================================================
-- 7. (a) normalize_legacy_plan(text) — SQL twin of T2 lib/billing/legacy-plan-normalization.ts
-- =====================================================================================
-- profiles.plan is free TEXT ('free|go|pro|team|enterprise'); this map mirrors the TS
-- function exactly: go->plus, enterprise->free, unknown/empty/NULL->free, case-insensitive
-- and trimmed.
CREATE OR REPLACE FUNCTION public.normalize_legacy_plan(p_plan TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
	SELECT CASE lower(trim(coalesce(p_plan, '')))
		WHEN 'go' THEN 'plus'
		WHEN 'enterprise' THEN 'free'
		WHEN 'plus' THEN 'plus'
		WHEN 'pro' THEN 'pro'
		WHEN 'team' THEN 'team'
		WHEN 'free' THEN 'free'
		ELSE 'free'
	END;
$$;

-- In-migration smoke block: parity pins for the SQL function (the TS half is pinned in
-- tests/unit/billing-prices.test.ts and cross-checked in
-- tests/unit/billing-migration-normalization.test.ts).
DO $$
BEGIN
	IF public.normalize_legacy_plan('go') IS DISTINCT FROM 'plus' THEN
		RAISE EXCEPTION 'normalize_legacy_plan parity: go -> plus';
	END IF;
	IF public.normalize_legacy_plan('Go ') IS DISTINCT FROM 'plus' THEN
		RAISE EXCEPTION 'normalize_legacy_plan parity: trim/lower go -> plus';
	END IF;
	IF public.normalize_legacy_plan('enterprise') IS DISTINCT FROM 'free' THEN
		RAISE EXCEPTION 'normalize_legacy_plan parity: enterprise -> free';
	END IF;
	IF public.normalize_legacy_plan('PRO') IS DISTINCT FROM 'pro' THEN
		RAISE EXCEPTION 'normalize_legacy_plan parity: pro';
	END IF;
	IF public.normalize_legacy_plan('team') IS DISTINCT FROM 'team' THEN
		RAISE EXCEPTION 'normalize_legacy_plan parity: team';
	END IF;
	IF public.normalize_legacy_plan('free') IS DISTINCT FROM 'free' THEN
		RAISE EXCEPTION 'normalize_legacy_plan parity: free';
	END IF;
	IF public.normalize_legacy_plan('wat') IS DISTINCT FROM 'free' THEN
		RAISE EXCEPTION 'normalize_legacy_plan parity: unknown -> free';
	END IF;
	IF public.normalize_legacy_plan(NULL) IS DISTINCT FROM 'free' THEN
		RAISE EXCEPTION 'normalize_legacy_plan parity: NULL -> free';
	END IF;
	IF public.normalize_legacy_plan('') IS DISTINCT FROM 'free' THEN
		RAISE EXCEPTION 'normalize_legacy_plan parity: empty -> free';
	END IF;
END
$$;

-- One-shot idempotent backfill: exactly one workspace_plans row per existing workspaces
-- row, tier = normalized owner profiles.plan (spec §4.4). No waitlist references.
INSERT INTO public.workspace_plans (workspace_id, tier, billing_cycle, gateway, status)
SELECT
	w.id,
	public.normalize_legacy_plan(p.plan),
	'none',
	'none',
	'none'
FROM public.workspaces w
JOIN public.profiles p ON p.id = w.owner_id
ON CONFLICT (workspace_id) DO NOTHING;

-- =====================================================================================
-- 8. (b) handle_new_user companion trigger — write referral_attribution from ?ref
-- =====================================================================================
-- The base trigger (20260703000000, amended 20260727000000) creates the profile; this
-- companion runs after it (trigger-name order) and never redefines handle_new_user.
CREATE OR REPLACE FUNCTION public.handle_new_user_referral_attribution()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
	v_ref TEXT;
BEGIN
	v_ref := nullif(trim(coalesce(NEW.raw_user_meta_data->>'referred_by', '')), '');
	IF v_ref IS NULL THEN
		RETURN NEW;
	END IF;

	INSERT INTO public.referral_attribution (user_id, ref, email_hash, created_at)
	VALUES (NEW.id, left(v_ref, 100), md5(lower(coalesce(NEW.email, ''))), timezone('utc'::text, now()))
	ON CONFLICT (user_id) DO NOTHING;

	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_referral_attribution ON auth.users;
CREATE TRIGGER on_auth_user_created_referral_attribution
	AFTER INSERT ON auth.users
	FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_referral_attribution();

-- =====================================================================================
-- 9. (c) workspaces INSERT trigger — activation grant (PDEC-4)
-- =====================================================================================
-- The inserting owner is the invitee. The referrer is resolved from
-- referral_attribution.ref; at H0 the ref is the referrer's user id (the only self-
-- contained ref->referrer key; campaign refs like "instagram" simply resolve to no
-- referrer and grant nothing — see the T3 completion notes). The grant banks on the
-- REFERRER's workspace: resolved immediately when that workspace exists, otherwise the
-- ledger row is written with workspace_id NULL keyed to referrer_user_id and resolved by
-- the referrer's own workspaces-insert trigger. `credited_months` is bumped only here (in
-- the resolvers), never by grant callers. Bank-cap enforcement lives in the T9 service.
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
	-- workspace has just materialized, so attach the pending rows and bump the counter.
	WITH resolved AS (
		UPDATE public.referral_credit_ledger
		SET workspace_id = NEW.id
		WHERE referrer_user_id = NEW.owner_id
			AND workspace_id IS NULL
			AND trigger_stage = 'activation'
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

DROP TRIGGER IF EXISTS on_workspace_created_billing ON public.workspaces;
CREATE TRIGGER on_workspace_created_billing
	AFTER INSERT ON public.workspaces
	FOR EACH ROW EXECUTE FUNCTION public.handle_workspace_created_billing();
