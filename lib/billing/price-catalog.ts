/**
 * T12 — display catalogue for the pricing UI (PRD §5.1).
 *
 * This module is deliberately runtime-import-free and env-free: it is the one
 * place the *amounts* live, shared by the server-side price resolver
 * (`lib/billing/prices.ts`) and the client pricing matrix. The client may render
 * these amounts, but it never sends them anywhere — checkout requests are opaque
 * `{ tier, cycle, currency, seats }` and the server resolves the real gateway
 * price object from env bindings (spec invariant 4: client never decides price).
 */

export type PaidTier = "plus" | "pro" | "team"
export type BillingCycle = "monthly" | "annual"
export type BillingCurrency = "USD" | "INR"
export type PriceCohort = "founding" | "ga"

/**
 * PRD §5.1 amounts in minor units (USD cents / INR paise). Annual is the
 * pay-for-ten convention on every paid tier. `team` is USD-only (spec §16 D11)
 * and its amount is PER SEAT.
 */
export const PRICE_AMOUNTS: Record<
	BillingCurrency,
	Record<"plus" | "pro", Record<PriceCohort, Record<BillingCycle, number>>>
> = {
	USD: {
		plus: {
			founding: { monthly: 400, annual: 4000 },
			ga: { monthly: 600, annual: 6000 },
		},
		pro: {
			founding: { monthly: 800, annual: 8000 },
			ga: { monthly: 1200, annual: 12000 },
		},
	},
	INR: {
		plus: {
			founding: { monthly: 24900, annual: 249900 },
			ga: { monthly: 49900, annual: 499000 },
		},
		pro: {
			founding: { monthly: 49900, annual: 499900 },
			ga: { monthly: 99900, annual: 999000 },
		},
	},
}

/** Team is USD-only at H0 — per-seat amounts, same pay-for-ten annual rule. */
export const TEAM_PRICE_AMOUNTS: Record<PriceCohort, Record<BillingCycle, number>> = {
	founding: { monthly: 800, annual: 8000 },
	ga: { monthly: 1000, annual: 10000 },
}

/** Amount in minor units for a tier/cycle/currency/cohort combination. */
export function priceAmountMinor(
	tier: PaidTier,
	cycle: BillingCycle,
	currency: BillingCurrency,
	cohort: PriceCohort,
): number {
	if (tier === "team") {
		// Team cannot be sold in INR; callers must guard (TierUnavailableError on the
		// server). Returning the USD amount here keeps the catalogue exhaustive.
		return TEAM_PRICE_AMOUNTS[cohort][cycle]
	}
	return PRICE_AMOUNTS[currency][tier][cohort][cycle]
}

/** Amount in major units (what a human sees on the pricing card). */
export function priceAmountMajor(
	tier: PaidTier,
	cycle: BillingCycle,
	currency: BillingCurrency,
	cohort: PriceCohort,
): number {
	return priceAmountMinor(tier, cycle, currency, cohort) / 100
}

/**
 * Currency-aware renderer. USD keeps whole dollars ($4 / $40) and INR keeps
 * whole rupees (₹249 / ₹2,499) — never a trailing `.00` on a marketing card.
 */
export function formatPrice(amount: number, currency: BillingCurrency): string {
	const symbol = currency === "INR" ? "₹" : "$"
	return `${symbol}${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
}

/** Team seat bounds (PRD §5.1: 2–10, 11–25, 26+; H0 UI sells 2–25). */
export const TEAM_MIN_SEATS = 2
export const TEAM_MAX_SEATS = 25
