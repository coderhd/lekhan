import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	assertFoundingEligible,
	FoundingIneligibleError,
	PriceConfigError,
	resolvePriceRequest,
	TierUnavailableError,
} from "@/lib/billing/prices"
import { normalizeLegacyPlan } from "@/lib/billing/legacy-plan-normalization"

// Every price/plan binding named by T1's `.env.example` pattern. The resolver
// must read ONLY these server-side env bindings — never request state.
const STRIPE_PRICE_ENV_KEYS = [
	"STRIPE_PRICE_PLUS_MONTHLY_FOUNDING_USD",
	"STRIPE_PRICE_PLUS_MONTHLY_GA_USD",
	"STRIPE_PRICE_PLUS_ANNUAL_FOUNDING_USD",
	"STRIPE_PRICE_PLUS_ANNUAL_GA_USD",
	"STRIPE_PRICE_PRO_MONTHLY_FOUNDING_USD",
	"STRIPE_PRICE_PRO_MONTHLY_GA_USD",
	"STRIPE_PRICE_PRO_ANNUAL_FOUNDING_USD",
	"STRIPE_PRICE_PRO_ANNUAL_GA_USD",
	"STRIPE_PRICE_TEAM_MONTHLY_FOUNDING_USD",
	"STRIPE_PRICE_TEAM_MONTHLY_GA_USD",
	"STRIPE_PRICE_TEAM_ANNUAL_FOUNDING_USD",
	"STRIPE_PRICE_TEAM_ANNUAL_GA_USD",
]

const RAZORPAY_PLAN_ENV_KEYS = [
	"RAZORPAY_PLAN_PLUS_MONTHLY_FOUNDING_INR",
	"RAZORPAY_PLAN_PLUS_MONTHLY_GA_INR",
	"RAZORPAY_PLAN_PLUS_ANNUAL_FOUNDING_INR",
	"RAZORPAY_PLAN_PLUS_ANNUAL_GA_INR",
	"RAZORPAY_PLAN_PRO_MONTHLY_FOUNDING_INR",
	"RAZORPAY_PLAN_PRO_MONTHLY_GA_INR",
	"RAZORPAY_PLAN_PRO_ANNUAL_FOUNDING_INR",
	"RAZORPAY_PLAN_PRO_ANNUAL_GA_INR",
]

const PRICE_ENV_KEYS = [...STRIPE_PRICE_ENV_KEYS, ...RAZORPAY_PLAN_ENV_KEYS]

const ORIGINAL_ENV: Record<string, string | undefined> = {}

beforeEach(() => {
	for (const key of PRICE_ENV_KEYS) {
		ORIGINAL_ENV[key] = process.env[key]
		delete process.env[key]
	}
})

afterEach(() => {
	for (const key of PRICE_ENV_KEYS) {
		if (ORIGINAL_ENV[key] === undefined) {
			delete process.env[key]
		} else {
			process.env[key] = ORIGINAL_ENV[key]
		}
	}
})

describe("resolvePriceRequest — cohort leakage (Review Focus 4)", () => {
	it("resolves the founding Stripe price only when isFounding is true", () => {
		process.env.STRIPE_PRICE_PLUS_MONTHLY_FOUNDING_USD = "price_founding_sentinel"
		process.env.STRIPE_PRICE_PLUS_MONTHLY_GA_USD = "price_ga_sentinel"

		const resolution = resolvePriceRequest("plus", "monthly", "USD", true)

		expect(resolution.currency).toBe("USD")
		if (resolution.currency !== "USD") throw new Error("expected a USD resolution")
		expect(resolution.priceId).toBe("price_founding_sentinel")
	})

	it("resolves the GA Stripe price and never the founding ID when isFounding is false", () => {
		process.env.STRIPE_PRICE_PLUS_MONTHLY_FOUNDING_USD = "price_founding_sentinel"
		process.env.STRIPE_PRICE_PLUS_MONTHLY_GA_USD = "price_ga_sentinel"

		const resolution = resolvePriceRequest("plus", "monthly", "USD", false)

		if (resolution.currency !== "USD") throw new Error("expected a USD resolution")
		expect(resolution.priceId).toBe("price_ga_sentinel")
		expect(resolution.priceId).not.toBe("price_founding_sentinel")
	})

	it("does not fall back to the founding binding when the GA binding is missing", () => {
		process.env.STRIPE_PRICE_PLUS_MONTHLY_FOUNDING_USD = "price_founding_sentinel"
		// GA binding intentionally absent — a GA request must fail closed, not leak the founding ID.

		expect(() => resolvePriceRequest("plus", "monthly", "USD", false)).toThrow(PriceConfigError)
	})

	it("keeps the GA Razorpay request in the GA env namespace", () => {
		process.env.RAZORPAY_PLAN_PLUS_MONTHLY_FOUNDING_INR = "plan_founding_sentinel"
		process.env.RAZORPAY_PLAN_PLUS_MONTHLY_GA_INR = "plan_ga_sentinel"

		const resolution = resolvePriceRequest("plus", "monthly", "INR", false)

		if (resolution.currency !== "INR") throw new Error("expected an INR resolution")
		expect(resolution.planEnvKey).toBe("RAZORPAY_PLAN_PLUS_MONTHLY_GA_INR")
		expect(resolution.planEnvKey).not.toContain("FOUNDING")
		expect(process.env[resolution.planEnvKey]).toBe("plan_ga_sentinel")
		expect(process.env[resolution.planEnvKey]).not.toBe("plan_founding_sentinel")
	})

	it("keeps the founding Razorpay request in the founding env namespace", () => {
		process.env.RAZORPAY_PLAN_PLUS_ANNUAL_FOUNDING_INR = "plan_founding_sentinel"

		const resolution = resolvePriceRequest("plus", "annual", "INR", true)

		if (resolution.currency !== "INR") throw new Error("expected an INR resolution")
		expect(resolution.planEnvKey).toBe("RAZORPAY_PLAN_PLUS_ANNUAL_FOUNDING_INR")
	})
})

describe("resolvePriceRequest — tier/currency availability", () => {
	it("rejects Team + INR with TierUnavailableError (Team is USD-only at H0)", () => {
		expect(() => resolvePriceRequest("team", "monthly", "INR", false)).toThrow(TierUnavailableError)
		expect(() => resolvePriceRequest("team", "annual", "INR", true)).toThrow(TierUnavailableError)
	})

	it("resolves Team on the USD rail", () => {
		process.env.STRIPE_PRICE_TEAM_MONTHLY_GA_USD = "price_team_ga"

		const resolution = resolvePriceRequest("team", "monthly", "USD", false)

		if (resolution.currency !== "USD") throw new Error("expected a USD resolution")
		expect(resolution.priceId).toBe("price_team_ga")
	})

	it("rejects the free tier (free has no checkout price object)", () => {
		// @ts-expect-error free is not a paid checkout tier
		expect(() => resolvePriceRequest("free", "monthly", "USD", false)).toThrow(PriceConfigError)
	})

	it("rejects an unsupported currency", () => {
		// @ts-expect-error EUR is not a supported rail currency
		expect(() => resolvePriceRequest("plus", "monthly", "EUR", false)).toThrow(PriceConfigError)
	})

	it("fails closed when the requested Stripe env binding is missing", () => {
		expect(() => resolvePriceRequest("pro", "annual", "USD", false)).toThrow(PriceConfigError)
	})

	it("fails closed when the requested Razorpay env binding is missing", () => {
		expect(() => resolvePriceRequest("pro", "monthly", "INR", false)).toThrow(PriceConfigError)
	})
})

describe("resolvePriceRequest — server-resolved amounts", () => {
	it("returns the founding Plus monthly USD amount in cents", () => {
		process.env.STRIPE_PRICE_PLUS_MONTHLY_FOUNDING_USD = "price_founding"

		const resolution = resolvePriceRequest("plus", "monthly", "USD", true)

		expect(resolution.amount).toBe(400)
		expect(resolution.currency).toBe("USD")
	})

	it("returns the founding Plus monthly INR amount in paise", () => {
		process.env.RAZORPAY_PLAN_PLUS_MONTHLY_FOUNDING_INR = "plan_founding"

		const resolution = resolvePriceRequest("plus", "monthly", "INR", true)

		expect(resolution.amount).toBe(24900)
		expect(resolution.currency).toBe("INR")
	})

	it("applies the pay-for-ten annual convention on the GA INR rail", () => {
		process.env.RAZORPAY_PLAN_PLUS_ANNUAL_GA_INR = "plan_ga_annual"

		const resolution = resolvePriceRequest("plus", "annual", "INR", false)

		expect(resolution.amount).toBe(499000)
	})

	it("returns the GA Team monthly amount in USD cents (per seat)", () => {
		process.env.STRIPE_PRICE_TEAM_MONTHLY_GA_USD = "price_team_ga"

		const resolution = resolvePriceRequest("team", "monthly", "USD", false)

		expect(resolution.amount).toBe(1000)
		expect(resolution.currency).toBe("USD")
	})
})

describe("assertFoundingEligible", () => {
	it("allows the founding cohort", () => {
		expect(() => assertFoundingEligible(true)).not.toThrow()
	})

	it("rejects a non-founding request from using founding resolution", () => {
		expect(() => assertFoundingEligible(false)).toThrow(FoundingIneligibleError)
	})
})

describe("normalizeLegacyPlan", () => {
	it("maps the retired go tier to plus", () => {
		expect(normalizeLegacyPlan("go")).toBe("plus")
	})

	it("trims and lowercases the legacy token", () => {
		expect(normalizeLegacyPlan("Go ")).toBe("plus")
		expect(normalizeLegacyPlan("  GO  ")).toBe("plus")
		expect(normalizeLegacyPlan(" Pro ")).toBe("pro")
	})

	it("passes through current canonical tiers", () => {
		expect(normalizeLegacyPlan("free")).toBe("free")
		expect(normalizeLegacyPlan("plus")).toBe("plus")
		expect(normalizeLegacyPlan("pro")).toBe("pro")
		expect(normalizeLegacyPlan("team")).toBe("team")
	})

	it("maps enterprise to free (out of H0 scope)", () => {
		expect(normalizeLegacyPlan("enterprise")).toBe("free")
	})

	it("maps unknown or missing tokens to free", () => {
		expect(normalizeLegacyPlan("bogus")).toBe("free")
		expect(normalizeLegacyPlan("")).toBe("free")
		expect(normalizeLegacyPlan(null)).toBe("free")
		expect(normalizeLegacyPlan(undefined)).toBe("free")
	})
})
