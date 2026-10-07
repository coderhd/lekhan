/**
 * Server-only price resolution (spec §5, plan T2).
 *
 * The single mapping from paid tier x billing cycle x cohort x currency to a
 * gateway price/plan identifier. Gateway identifiers are read **only** from
 * server-side env bindings — never from request/client state — so a client can
 * never steer a checkout at a different price object (spec invariant 4).
 *
 * Namespace split is structural, not a runtime branch: founding and GA live in
 * distinct env namespaces (`..._FOUNDING_...` vs `..._GA_...`). A GA request can
 * therefore never resolve a founding identifier, which pins Review Focus 4
 * (cohort leakage).
 *
 * Amounts are minor units (USD cents / INR paise) mirrored from the PRD §5.1
 * pricing table for audit and referral-credit math (PDEC-3); the amount is static
 * server config, never client input. Treasury (`amount`) for the `team` tier is
 * **per seat** — callers multiply by the purchased seat count.
 */

export type PaidTier = "plus" | "pro" | "team"
export type BillingCycle = "monthly" | "annual"
export type BillingCurrency = "USD" | "INR"
export type PriceCohort = "founding" | "ga"

export interface StripePriceResolution {
	amount: number
	currency: "USD"
	/** Resolved `price_...` object id (the value of the `STRIPE_PRICE_*` binding). */
	priceId: string
}

export interface RazorpayPriceResolution {
	amount: number
	currency: "INR"
	/**
	 * Name of the env binding that holds the Razorpay `plan_...` id. Rails read the
	 * value with `process.env[planEnvKey]`; that binding is validated (fail-closed)
	 * during resolution.
	 */
	planEnvKey: string
}

export type PriceResolution = StripePriceResolution | RazorpayPriceResolution

/** Missing/invalid server-side price configuration. Fails closed — never a fallback price. */
export class PriceConfigError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "PriceConfigError"
	}
}

/** The requested tier is not purchasable on the requested currency/rail (Team is USD-only at H0). */
export class TierUnavailableError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "TierUnavailableError"
	}
}

/** A non-founding request attempted to enter the founding-price namespace. */
export class FoundingIneligibleError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "FoundingIneligibleError"
	}
}

const PAID_TIERS = new Set<PaidTier>(["plus", "pro", "team"])
const BILLING_CYCLES = new Set<BillingCycle>(["monthly", "annual"])
const BILLING_CURRENCIES = new Set<BillingCurrency>(["USD", "INR"])

// PRD §5.1 amounts in minor units. Annual = pay-for-ten convention on every paid tier.
// `team` is USD-only (spec §16 D11) and per seat.
const USD_AMOUNTS: Record<PaidTier, Record<PriceCohort, Record<BillingCycle, number>>> = {
	plus: {
		founding: { monthly: 400, annual: 4000 },
		ga: { monthly: 600, annual: 6000 }
	},
	pro: {
		founding: { monthly: 800, annual: 8000 },
		ga: { monthly: 1200, annual: 12000 }
	},
	team: {
		founding: { monthly: 800, annual: 8000 },
		ga: { monthly: 1000, annual: 10000 }
	}
}

const INR_AMOUNTS: Record<"plus" | "pro", Record<PriceCohort, Record<BillingCycle, number>>> = {
	plus: {
		founding: { monthly: 24900, annual: 249900 },
		ga: { monthly: 49900, annual: 499000 }
	},
	pro: {
		founding: { monthly: 49900, annual: 499900 },
		ga: { monthly: 99900, annual: 999000 }
	}
}

function stripeEnvKey(tier: PaidTier, cycle: BillingCycle, cohort: PriceCohort): string {
	return `STRIPE_PRICE_${tier.toUpperCase()}_${cycle.toUpperCase()}_${cohort.toUpperCase()}_USD`
}

function razorpayEnvKey(tier: PaidTier, cycle: BillingCycle, cohort: PriceCohort): string {
	return `RAZORPAY_PLAN_${tier.toUpperCase()}_${cycle.toUpperCase()}_${cohort.toUpperCase()}_INR`
}

function readRequiredEnv(envKey: string): string {
	const value = process.env[envKey]
	if (typeof value !== "string" || value.trim() === "") {
		throw new PriceConfigError(
			`Missing server-side price configuration: ${envKey} must be set to a gateway price/plan id.`
		)
	}
	return value
}

function assertPaidTier(tier: string): void {
	if (!PAID_TIERS.has(tier as PaidTier)) {
		throw new PriceConfigError(`Tier "${tier}" has no checkout price object (only plus, pro, team are payable).`)
	}
}

function assertCycle(cycle: string): void {
	if (!BILLING_CYCLES.has(cycle as BillingCycle)) {
		throw new PriceConfigError(`Unsupported billing cycle "${cycle}"; expected monthly or annual.`)
	}
}

function assertCurrency(currency: string): void {
	if (!BILLING_CURRENCIES.has(currency as BillingCurrency)) {
		throw new PriceConfigError(
			`Unsupported billing currency "${currency}"; H0 supports USD (Stripe) and INR (Razorpay).`
		)
	}
}

/**
 * Guard the founding-price namespace. Founders are the only cohort allowed to
 * resolve founding identifiers, so any caller that is not strictly `true` is
 * rejected rather than silently downgraded to GA (which would let a stale/forged
 * flag pick a cohort price).
 */
export function assertFoundingEligible(isFounding: boolean): void {
	if (isFounding !== true) {
		throw new FoundingIneligibleError(
			"Founding price resolution requires an eligible founding workspace (is_founding === true)."
		)
	}
}

/**
 * Resolve the gateway price/plan request for a paid tier.
 *
 * All identifiers come from server-side env bindings; the cohort namespace is
 * chosen only from the persisted `isFounding` flag.
 */
export function resolvePriceRequest(
	tier: PaidTier,
	cycle: BillingCycle,
	currency: BillingCurrency,
	isFounding: boolean
): PriceResolution {
	assertPaidTier(tier)
	assertCycle(cycle)
	assertCurrency(currency)

	if (currency === "INR" && tier === "team") {
		throw new TierUnavailableError(
			"Team is USD-only at H0 (spec §16 D11); INR Team pricing defers to the GA pricing decision."
		)
	}

	// GA falls through to the GA namespace only — there is no founding fallback.
	const cohort: PriceCohort = isFounding ? "founding" : "ga"
	if (isFounding) {
		assertFoundingEligible(isFounding)
	}

	if (currency === "USD") {
		return {
			amount: USD_AMOUNTS[tier][cohort][cycle],
			currency: "USD",
			priceId: readRequiredEnv(stripeEnvKey(tier, cycle, cohort))
		}
	}

	// Team already threw above, so the INR catalogue is exhaustive over plus|pro.
	const planEnvKey = razorpayEnvKey(tier, cycle, cohort)
	readRequiredEnv(planEnvKey)
	return {
		amount: INR_AMOUNTS[tier as "plus" | "pro"][cohort][cycle],
		currency: "INR",
		planEnvKey
	}
}
