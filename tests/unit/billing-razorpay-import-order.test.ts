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
 */
import {
	razorpayGateway,
	RazorpayConfigError,
	type RazorpayGateway,
} from "@/lib/billing/razorpay"
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { gatewayForRail } from "@/lib/billing/gateway-factory"

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

		const gateway = gatewayForRail("razorpay")
		expect(gateway).toBeDefined()
		expect(gateway.rail).toBe("razorpay")

		// The production rail refuses to fabricate a card-update link from a customer
		// id; the in-memory fake would happily return "#fake-card-update". Reaching
		// this rejection proves the registered gateway is the real rail whose methods
		// resolve after full graph evaluation.
		await expect(gateway.portalUrl("cust_D00000000000006")).rejects.toBeInstanceOf(RazorpayConfigError)

		// And a genuine hosted https link passes through unchanged.
		await expect(gateway.portalUrl("https://rzp.io/i/abc")).resolves.toEqual({
			url: "https://rzp.io/i/abc",
			kind: "card_update",
		})
	})

	it("exposes the extended scheduled-change surface through the seam", () => {
		const gateway = gatewayForRail("razorpay") as RazorpayGateway
		expect(typeof gateway.retrieveScheduledChange).toBe("function")
		expect(typeof gateway.cancelScheduledChange).toBe("function")
	})
})
