/**
 * REVIEW BLOCKING-1 — permanent regression pin for rail self-registration.
 *
 * DO NOT REORDER THESE IMPORTS. The first static import is intentionally the
 * Razorpay rail itself. That makes `razorpay -> gateway -> gateway-factory ->
 * razorpay` evaluate with the rail as the module-graph entry — the exact order in
 * which a non-lazy `registerGateway("razorpay", razorpayGateway)` captured
 * `undefined` (bundler transform) or threw a TDZ ReferenceError (native ESM), so
 * `gatewayForRail("razorpay")` then failed for every INR call. The import order is
 * the test.
 *
 * SIL-56: the seam is the T6 `builtinRails` lazy loader (T7's eager getter-delegate
 * was superseded at integration). This pin proves the loader still resolves to the
 * REAL, callable singleton under the rail-first graph — by identity, by runtime
 * member completeness (REVIEW L-1), and by the production fail-closed card-update
 * guard the fake would never raise (a fake returns "#fake-card-update").
 */
import {
	razorpayGateway,
	RazorpayConfigError,
	type RazorpayGateway,
} from "@/lib/billing/razorpay"
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { gatewayForCurrency, gatewayForRail } from "@/lib/billing/gateway-factory"

/**
 * Every member the rail exposes through the registry seam: the five shared
 * `PaymentGateway` methods plus Razorpay's scheduled-change surface.
 */
const SEAM_MEMBERS = [
	"createCheckout",
	"portalUrl",
	"schedulePlanChange",
	"cancelAtPeriodEnd",
	"getSubscriptionState",
	"retrieveScheduledChange",
	"cancelScheduledChange",
] as const

describe("razorpay rail registration under a razorpay-first import graph", () => {
	const previousFake = process.env.LEKHAN_FAKE_PAYMENTS

	beforeEach(() => {
		delete process.env.LEKHAN_FAKE_PAYMENTS
	})

	afterEach(() => {
		if (previousFake === undefined) delete process.env.LEKHAN_FAKE_PAYMENTS
		else process.env.LEKHAN_FAKE_PAYMENTS = previousFake
	})

	it("registers the real, callable rail even when the rail is the entry module", async () => {
		expect(razorpayGateway).toBeDefined()

		// Scope-4 (SIL-56): the lazy loader hands back the rail's own singleton —
		// no stub, no silent fallback for INR under any import order.
		const gateway = gatewayForRail("razorpay")
		expect(gateway).toBe(razorpayGateway)
		expect(gatewayForCurrency("INR")).toBe(razorpayGateway)
		expect(gateway.rail).toBe("razorpay")

		// The production rail resolves the card-update link only from a `sub_…`
		// subscription ref (SIL-56 escalation-1 ruling); a customer id fails closed.
		// Reaching this rejection — where the fake would have returned
		// "#fake-card-update" — proves the registered gateway is the real rail whose
		// closures resolve after full graph evaluation.
		await expect(gateway.portalUrl("cust_D00000000000006")).rejects.toBeInstanceOf(RazorpayConfigError)

		// L-1: delegate/loader completeness is verified at RUNTIME, not only by the
		// compile-time typed registration.
		for (const member of SEAM_MEMBERS) {
			expect(typeof (gateway as unknown as Record<string, unknown>)[member]).toBe("function")
		}
	})

	it("exposes the extended scheduled-change surface through the seam", () => {
		const gateway = gatewayForRail("razorpay") as RazorpayGateway
		expect(typeof gateway.retrieveScheduledChange).toBe("function")
		expect(typeof gateway.cancelScheduledChange).toBe("function")
	})
})
