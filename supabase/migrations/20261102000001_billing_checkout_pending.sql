-- Billing: close the checkout→activation race on the single-live-subscription invariant.
--
-- The invariant in `app/api/billing/checkout/route.ts` is read-back based, but the
-- row only learns the new `gateway_subscription_id` when the activation webhook
-- applies. Between creating a checkout and that webhook (provider lag, a 502 retry,
-- a redelivery) a second checkout could start, producing two live subscriptions
-- where the later activation silently overwrites the earlier ref — leaving a ghost
-- subscription that keeps invoicing the customer and is invisible to reconciliation.
--
-- `checkout_pending_at` + `checkout_pending_ref` record the attempt. A checkout in
-- the pending window is refused; the marker is cleared when the activation applies
-- (and ages out after `CHECKOUT_PENDING_WINDOW_MS` if the user abandons it).

ALTER TABLE public.workspace_plans
	ADD COLUMN IF NOT EXISTS checkout_pending_at TIMESTAMPTZ,
	ADD COLUMN IF NOT EXISTS checkout_pending_ref TEXT;

COMMENT ON COLUMN public.workspace_plans.checkout_pending_at IS
	'When the most recent checkout session was created; blocks a second checkout until activation applies or the window expires.';
COMMENT ON COLUMN public.workspace_plans.checkout_pending_ref IS
	'Rail-opaque ref of the pending checkout session (audit only; never used for entitlement).';
