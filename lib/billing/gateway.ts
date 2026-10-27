/**
 * T5 — server-only billing gateway contract.
 *
 * The workspace is the billing root (spec §1 invariant 1): every gateway call is
 * keyed by `workspaceId`, and no rail ever accepts a client-declared amount, tier
 * price, or cohort flag. Rails (Stripe = USD, Razorpay = INR) implement
 * `PaymentGateway` and register through `lib/billing/gateway-factory.ts`.
 *
 * Amended by PDEC-12: `schedulePlanChange` is part of the contract. There is no
 * Stripe-style portal *session* on the Razorpay seam — there, `portalUrl` resolves the
 * hosted card-update link from a live subscription read-back (PDEC-1; SIL-56 ruling:
 * never persisted, never fabricated; see `PaymentGateway.portalUrl`).
 *
 * The `gatewayForCurrency` / `gatewayForRail` resolver lives in the factory
 * module and is re-exported here so spec §5's import site stays true.
 */

export type Rail = "stripe" | "razorpay"

// gateway-abstraction depends on pricing-config (spec §3 capability map): reuse its
// tier/cycle/currency vocabulary and its domain error instead of duplicating them.
import { TierUnavailableError, type BillingCurrency, type BillingCycle, type PaidTier } from "./prices"

export { TierUnavailableError }
export type { BillingCycle }
export type Currency = BillingCurrency
export type BillingTier = PaidTier

export const BILLING_TIERS: readonly BillingTier[] = ["plus", "pro", "team"]
export const BILLING_CYCLES: readonly BillingCycle[] = ["monthly", "annual"]
export const CURRENCIES: readonly Currency[] = ["USD", "INR"]

/** Team is USD-only at H0 (spec §16 D11): no founding INR per-seat price exists. */
export const TEAM_REQUIRED_CURRENCY: Currency = "USD"

export interface CheckoutRequest {
	workspaceId: string
	tier: BillingTier
	cycle: BillingCycle
	currency: Currency
	isFounding: boolean
	seats?: number
}

export interface CheckoutSession {
	checkoutUrl: string
	opaqueRef: string
}

/** PDEC-12: provider-native plan-change seam (Stripe portal / Razorpay scheduled change). */
export interface SchedulePlanChangeRequest {
	subscriptionRef: string
	tier: BillingTier
	cycle: BillingCycle
	seats?: number
}

export interface SchedulePlanChangeResult {
	subscriptionRef: string
	tier: BillingTier
	cycle: BillingCycle
	effectiveAt: string
	scheduledChangeRef: string
}

export type PortalKind = "billing_portal" | "card_update"

export interface PortalSession {
	url: string
	kind: PortalKind
}

export type GatewaySubscriptionStatus = "active" | "past_due" | "canceled" | "incomplete"

/** Read-back shape: entitlement state is written from the provider object, never the payload. */
export interface GatewaySubscriptionState {
	subscriptionRef: string
	status: GatewaySubscriptionStatus
	cancelAtPeriodEnd: boolean
	currentPeriodEnd: string | null
}

/**
 * PDEC-11 transfer-window classification:
 *  - `inactive`  — not a live subscription; a new checkout is allowed.
 *  - `detaching` — active provider-side but verified cancel-at-period-end / scheduled
 *                  cancellation; bills nothing further, so a new checkout is allowed
 *                  (read-back-based, never inferred).
 *  - `live`      — active/past_due and not detaching; a second subscription is blocked.
 */
export type SubscriptionLifecycle = "inactive" | "live" | "detaching"

const LIVE_STATUSES: readonly GatewaySubscriptionStatus[] = ["active", "past_due"]

export function classifySubscription(state: GatewaySubscriptionState): SubscriptionLifecycle {
	if (!LIVE_STATUSES.includes(state.status)) return "inactive"
	return state.cancelAtPeriodEnd ? "detaching" : "live"
}

export function isLiveNonDetaching(state: GatewaySubscriptionState): boolean {
	return classifySubscription(state) === "live"
}

/**
 * PDEC-11 transfer-window overlay (SIL-56 ruling, hardened per integration review).
 * Provider read-back is the ONLY source of status/liveness. The stored
 * `workspace_plans.cancel_at_period_end` is consumed as a provenanced supplement for
 * the detaching classification ONLY on the RAZORPAY rail:
 *  - Razorpay/INR — `cancel_at_cycle_end` is a request param and is NEVER echoed on
 *    GET, so the column records the ACCEPTED CANCEL ACTION: our own
 *    `POST /v1/subscriptions/:id/cancel {cancel_at_cycle_end:true}` returned 2xx.
 *    Provider-acknowledged — never inferred from timing or webhook absence.
 *  - Stripe/USD — inert: the read-back already carries the provider's own
 *    `cancel_at_period_end`, and a STORED mirror can only disagree with fresh provider
 *    state by being stale (e.g. a portal-side resume not yet reconciled). Trusting a
 *    stale mirror there would soften a genuinely-live subscription to `detaching` and
 *    open a double-charge window — read-back wins, always.
 * The overlay may only soften `live` into `detaching`; it can never mark a non-live
 * subscription billable and can never unset a read-back `true`.
 */
export function withStoredCancelFlag(
	state: GatewaySubscriptionState,
	rail: Rail,
	storedCancelAtPeriodEnd: boolean | null | undefined,
): GatewaySubscriptionState {
	if (rail !== "razorpay") return state
	if (storedCancelAtPeriodEnd !== true || state.cancelAtPeriodEnd) return state
	return { ...state, cancelAtPeriodEnd: true }
}

export interface PaymentGateway {
	readonly rail: Rail
	createCheckout(req: CheckoutRequest): Promise<CheckoutSession>
	/**
	 * SIL-56 integration ruling — renamed from `customerRef`, whose name contradicted
	 * PDEC-1 (Razorpay has no portal session and no customer-keyed card-update path).
	 * `portalRef` is a RAIL-SPECIFIC portal lookup key, resolved server-side from
	 * `workspace_plans`; the caller must select the ref by rail:
	 *  - Stripe: stored `gateway_customer_id` (`cus_…`) — opens a Billing Portal session.
	 *  - Razorpay: stored `gateway_subscription_id` (`sub_…`) — the rail resolves the
	 *    subscription's hosted payment-page `short_url` from a live GET read-back
	 *    (PDEC-1: the link is never fabricated and never persisted).
	 * Passing the wrong ref for a rail fails closed, never a silent fallback.
	 */
	portalUrl(portalRef: string): Promise<PortalSession>
	schedulePlanChange(req: SchedulePlanChangeRequest): Promise<SchedulePlanChangeResult>
	cancelAtPeriodEnd(subscriptionRef: string): Promise<void>
	getSubscriptionState(subscriptionRef: string): Promise<GatewaySubscriptionState>
}

export function railForCurrency(currency: Currency): Rail {
	if (currency === "INR") return "razorpay"
	if (currency === "USD") return "stripe"
	throw new UnsupportedCurrencyError(currency)
}

export function isBillingTier(value: unknown): value is BillingTier {
	return typeof value === "string" && (BILLING_TIERS as readonly string[]).includes(value)
}

export function isBillingCycle(value: unknown): value is BillingCycle {
	return typeof value === "string" && (BILLING_CYCLES as readonly string[]).includes(value)
}

export function isCurrency(value: unknown): value is Currency {
	return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value)
}

/** Rejects a tier/currency combination that is not sellable at H0 (Team + non-USD). */
export function assertSellableCheckout(req: Pick<CheckoutRequest, "tier" | "currency">): void {
	if (req.tier === "team" && req.currency !== TEAM_REQUIRED_CURRENCY) {
		throw new TierUnavailableError(
			`Team is not available in ${req.currency} at launch; check out in ${TEAM_REQUIRED_CURRENCY}.`,
		)
	}
}

export class UnsupportedCurrencyError extends Error {
	readonly code = "unsupported_currency"
	constructor(readonly currency: string) {
		super(`No payment rail is available for currency "${currency}".`)
		this.name = "UnsupportedCurrencyError"
	}
}

export class GatewayNotRegisteredError extends Error {
	readonly code = "gateway_not_registered"
	constructor(readonly rail: Rail) {
		super(`No gateway registered for rail "${rail}".`)
		this.name = "GatewayNotRegisteredError"
	}
}

export class SubscriptionNotFoundError extends Error {
	readonly code = "subscription_not_found"
	constructor(readonly subscriptionRef: string) {
		super(`No subscription found for reference "${subscriptionRef}".`)
		this.name = "SubscriptionNotFoundError"
	}
}

// Re-exported from the factory so spec §5's `gateway.ts` import site resolves.
export { gatewayForCurrency, gatewayForRail, registerGateway } from "./gateway-factory"
