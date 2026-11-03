import { describe, it, expect } from "vitest"
import { CHECKOUT_PENDING_WINDOW_MS, isCheckoutPending } from "@/lib/billing/gateway"

const NOW = Date.parse("2026-11-02T10:00:00.000Z")
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString()

describe("isCheckoutPending — checkout→activation gap", () => {
	it("is false when no marker exists (never checked out)", () => {
		expect(isCheckoutPending(null, NOW)).toBe(false)
		expect(isCheckoutPending({}, NOW)).toBe(false)
		expect(isCheckoutPending({ checkout_pending_at: null }, NOW)).toBe(false)
	})

	it("is true while the checkout may still activate", () => {
		expect(isCheckoutPending({ checkout_pending_at: at(-1_000) }, NOW)).toBe(true)
		expect(isCheckoutPending({ checkout_pending_at: at(-CHECKOUT_PENDING_WINDOW_MS + 1) }, NOW)).toBe(true)
	})

	it("is false once the window has expired (abandoned checkout)", () => {
		expect(isCheckoutPending({ checkout_pending_at: at(-CHECKOUT_PENDING_WINDOW_MS) }, NOW)).toBe(false)
		expect(isCheckoutPending({ checkout_pending_at: at(-CHECKOUT_PENDING_WINDOW_MS * 10) }, NOW)).toBe(false)
	})

	it("fails open on a malformed or future timestamp", () => {
		// A corrupt value must not block billing forever; a future value is clock skew.
		expect(isCheckoutPending({ checkout_pending_at: "not-a-date" }, NOW)).toBe(false)
		expect(isCheckoutPending({ checkout_pending_at: at(60_000) }, NOW)).toBe(false)
	})
})
