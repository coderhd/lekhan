/**
 * SIL-56 scope-1 — Stripe-first counterpart to the permanent Razorpay
 * import-order pin (REVIEW BLOCKING-1).
 *
 * DO NOT REORDER THESE IMPORTS. The first static import is intentionally the
 * Stripe rail itself. That makes `stripe -> gateway -> gateway-factory -> stripe`
 * evaluate with the rail as the module-graph entry — the exact order in which an
 * eager `registerGateway("stripe", <module binding>)` reads a binding whose module
 * body has not run. Registration must resolve through the `builtinRails` lazy
 * loader, which reads the binding only at call time, after the full graph has
 * evaluated. The import order is the test.
 */
import { getStripeGateway, StripeConfigError } from "@/lib/billing/stripe"
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { gatewayForCurrency, gatewayForRail } from "@/lib/billing/gateway-factory"

/** The shared `PaymentGateway` contract surface the loader must deliver. */
const SEAM_MEMBERS = [
	"createCheckout",
	"portalUrl",
	"schedulePlanChange",
	"cancelAtPeriodEnd",
	"getSubscriptionState",
] as const

describe("stripe rail registration under a stripe-first import graph", () => {
	const saved: Record<string, string | undefined> = {}
	const ENV_KEYS = ["LEKHAN_FAKE_PAYMENTS", "STRIPE_SECRET_KEY", "NEXT_PUBLIC_APP_URL"] as const

	beforeEach(() => {
		for (const key of ENV_KEYS) {
			saved[key] = process.env[key]
			delete process.env[key]
		}
	})

	afterEach(() => {
		for (const key of ENV_KEYS) {
			if (saved[key] === undefined) delete process.env[key]
			else process.env[key] = saved[key]
		}
	})

	it("registers the real, callable rail even when the rail is the entry module", async () => {
		expect(getStripeGateway).toBeTypeOf("function")

		const gateway = gatewayForRail("stripe")
		expect(gateway).toBeDefined()
		expect(gateway.rail).toBe("stripe")

		// Scope-4 (SIL-56): no silent fallback for USD — the currency route resolves
		// the SAME loaded rail instance the registry cached, not another gateway.
		expect(gatewayForCurrency("USD")).toBe(gateway)

		// Real-rail proof with zero secrets and zero network: the fake answers any
		// ref with "#fake-billing-portal"; the real rail builds its client lazily and
		// fails closed with StripeConfigError when `STRIPE_SECRET_KEY` is absent.
		// Reaching this rejection proves the loader ran after full graph evaluation.
		await expect(gateway.portalUrl("cus_stored")).rejects.toBeInstanceOf(StripeConfigError)
	})

	it("delivers the full shared contract as real functions through the seam (L-1)", () => {
		const gateway = gatewayForRail("stripe")
		for (const member of SEAM_MEMBERS) {
			expect(typeof (gateway as unknown as Record<string, unknown>)[member]).toBe("function")
		}
	})
})
