import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * T8 — Stripe webhook rail (plan T8; spec §6; Review Focus 1+2).
 *
 * Signature verification runs through the REAL Stripe SDK path
 * (`Stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET`); payloads are
 * the committed recorded-shaped fixtures signed in-test with the documented
 * Stripe scheme and a test-only secret. The provider client behind the default
 * read-back is mocked at the `getStripeClient` seam — no network, and
 * entitlement state is written from the read-back object, never the payload.
 *
 * Pins: valid signed fixture processed end-to-end (price reverse-mapped from
 * env bindings, conversion grant fired); tampered/missing/wrong-secret
 * signatures fail closed 400 with no row; canceling representation; terminal
 * cancellation incl. the resource-missing DB-binding fallback; past_due
 * transition on invoice.payment_failed; renewal hook on invoice.paid; unknown
 * events stored + no-op; duplicate event.id replays short-circuit.
 */

import { processStripeWebhook } from "@/services/billing/webhook-processor"
import {
	asSupabaseClient,
	fakeDb,
	seedStore,
	stripeSignatureHeader,
	STRIPE_TEST_SECRET,
	SUB,
	WS,
} from "./billing-webhook-testkit"

import checkoutCompleted from "@/tests/fixtures/billing/stripe-checkout-session-completed.json"
import subscriptionUpdated from "@/tests/fixtures/billing/stripe-customer-subscription-updated.json"
import subscriptionDeleted from "@/tests/fixtures/billing/stripe-customer-subscription-deleted.json"
import invoicePaid from "@/tests/fixtures/billing/stripe-invoice-paid.json"
import invoicePaymentFailed from "@/tests/fixtures/billing/stripe-invoice-payment-failed.json"

const ENV_KEYS = [
	"STRIPE_WEBHOOK_SECRET",
	"STRIPE_PRICE_PLUS_MONTHLY_GA_USD",
	"STRIPE_PRICE_PLUS_MONTHLY_FOUNDING_USD",
	"STRIPE_PRICE_PRO_MONTHLY_GA_USD",
] as const

const saved: Record<string, string | undefined> = {}

const PERIOD_END = 1769904000 // 2026-02-01T00:00:00Z — fixture value
const PRICE_PLUS_MONTHLY_GA = "price_test_plus_monthly_ga"
const PRICE_PLUS_MONTHLY_FOUNDING = "price_test_plus_monthly_founding"

const stripeClientHolder = vi.hoisted(() => ({ client: null as unknown }))
vi.mock("@/lib/billing/stripe", () => ({
	getStripeClient: () => stripeClientHolder.client,
}))

type Json = Record<string, unknown>

function makeStripeSubscription(overrides: Json = {}): Json {
	return {
		id: SUB,
		object: "subscription",
		customer: "cus_test_001",
		status: "active",
		cancel_at_period_end: false,
		metadata: { workspace_id: WS, is_founding: "false" },
		items: {
			data: [
				{
					id: "si_test_001",
					quantity: 1,
					current_period_start: PERIOD_END - 2_678_400,
					current_period_end: PERIOD_END,
					price: { id: PRICE_PLUS_MONTHLY_GA, object: "price", currency: "usd" },
				},
			],
		},
		...overrides,
	}
}

function resourceMissing(): Error {
	return Object.assign(new Error("No such subscription: " + SUB), { code: "resource_missing" })
}

interface SetupOpts {
	plan?: Json
}

function setup(opts: SetupOpts = {}) {
	const store = seedStore({ plan: opts.plan })
	const db = asSupabaseClient(fakeDb(store))
	const grantConversion = vi.fn(async () => ({ granted: false, reason: "not-referred", months: 0, deferred: false }))
	const applyRenewalCredits = vi.fn(async () => ({ applied: false, reason: "nothing-banked", monthsApplied: 0, creditMinorUnits: 0, balanceTransactionId: null }))
	return { store, db, grantConversion, applyRenewalCredits }
}

async function deliver(
	db: unknown,
	rawBody: string,
	signature: string,
	hooks: { grantConversion?: unknown; applyRenewalCredits?: unknown } = {},
) {
	return processStripeWebhook({
		db: db as never,
		rawBody,
		signature,
		deps: {
			now: () => new Date("2026-10-26T00:00:00.000Z"),
			...(hooks.grantConversion ? { grantConversion: hooks.grantConversion as never } : {}),
			...(hooks.applyRenewalCredits ? { applyRenewalCredits: hooks.applyRenewalCredits as never } : {}),
		},
	})
}

describe("billing webhooks — stripe rail (T8)", () => {
	beforeEach(() => {
		for (const key of ENV_KEYS) {
			saved[key] = process.env[key]
			delete process.env[key]
		}
		process.env.STRIPE_WEBHOOK_SECRET = STRIPE_TEST_SECRET
		process.env.STRIPE_PRICE_PLUS_MONTHLY_GA_USD = PRICE_PLUS_MONTHLY_GA
		process.env.STRIPE_PRICE_PLUS_MONTHLY_FOUNDING_USD = PRICE_PLUS_MONTHLY_FOUNDING
		stripeClientHolder.client = {
			subscriptions: { retrieve: vi.fn(async () => makeStripeSubscription()) },
		}
	})

	afterEach(() => {
		for (const key of ENV_KEYS) {
			if (saved[key] === undefined) delete process.env[key]
			else process.env[key] = saved[key]
		}
		vi.restoreAllMocks()
	})

	it("verifies and processes a genuine signed checkout.session.completed fixture end-to-end", async () => {
		const { store, db, grantConversion, applyRenewalCredits } = setup()
		const raw = JSON.stringify(checkoutCompleted)

		const result = await deliver(db, raw, stripeSignatureHeader(raw), { grantConversion, applyRenewalCredits })

		expect(result.status).toBe(200)
		expect(result.code).toBe("processed")
		const plan = store.workspace_plans[0]
		// Price reverse-mapped from env bindings via T2 (tier/cycle), read-back applied.
		expect(plan.tier).toBe("plus")
		expect(plan.billing_cycle).toBe("monthly")
		expect(plan.status).toBe("active")
		expect(plan.gateway).toBe("stripe")
		expect(plan.gateway_subscription_id).toBe(SUB)
		expect(plan.currency).toBe("USD")
		expect(store.gateway_events[0].event_id).toBe("evt_test_stripe_checkout_completed_001")
		// Paid conversion ⇒ referral grant fired (TL A4), renewal hook not.
		expect(grantConversion).toHaveBeenCalledWith(WS)
		expect(applyRenewalCredits).not.toHaveBeenCalled()
	})

	it("does not grant conversion credit when the checkout subscription is still unpaid (incomplete)", async () => {
		const { store, db, grantConversion } = setup()
		stripeClientHolder.client = {
			subscriptions: { retrieve: vi.fn(async () => makeStripeSubscription({ status: "incomplete" })) },
		}
		const raw = JSON.stringify(checkoutCompleted)

		const result = await deliver(db, raw, stripeSignatureHeader(raw), { grantConversion })

		expect(result.code).toBe("processed")
		expect(store.workspace_plans[0].status).toBe("incomplete")
		expect(store.profiles[0].plan).toBe("free") // not entitled
		expect(grantConversion).not.toHaveBeenCalled()
	})

	it("falls back to the legacy invoice root subscription field (pre-Basil endpoint pin)", async () => {
		const { db, applyRenewalCredits } = setup()
		const legacy: Json = {
			...invoicePaid,
			id: "evt_test_stripe_invoice_paid_legacy",
			data: {
				object: {
					...(invoicePaid.data.object as Json),
					parent: null,
					subscription: SUB,
				},
			},
		}
		const raw = JSON.stringify(legacy)

		const result = await deliver(db, raw, stripeSignatureHeader(raw), { applyRenewalCredits })

		expect(result.code).toBe("processed")
		expect(applyRenewalCredits).toHaveBeenCalledWith(WS)
	})

	it("writes entitlement state from the provider read-back, never the payload (forged delta)", async () => {
		const { store, db } = setup()
		stripeClientHolder.client = {
			subscriptions: { retrieve: vi.fn(async () => makeStripeSubscription({ status: "active" })) },
		}
		const forged = { ...checkoutCompleted, data: { object: { ...checkoutCompleted.data.object, subscription: SUB, status: "active", amount: 1 } } }
		const raw = JSON.stringify(forged)

		await deliver(db, raw, stripeSignatureHeader(raw))

		const plan = store.workspace_plans[0]
		expect(plan.tier).toBe("plus") // from the read-back price mapping, not the payload
	})

	it("rejects a tampered payload with 400 and records nothing", async () => {
		const { store, db } = setup()
		const raw = JSON.stringify(checkoutCompleted)
		const tampered = JSON.stringify({ ...checkoutCompleted, data: { object: { ...checkoutCompleted.data.object, subscription: "sub_attacker" } } })

		const result = await deliver(db, tampered, stripeSignatureHeader(raw)) // signature of the ORIGINAL body

		expect(result.status).toBe(400)
		expect(result.code).toBe("unverified")
		expect(store.gateway_events).toHaveLength(0)
	})

	it("rejects a missing signature header with 400 and records nothing", async () => {
		const { store, db } = setup()
		const result = await deliver(db, JSON.stringify(checkoutCompleted), "")

		expect(result.status).toBe(400)
		expect(result.code).toBe("unverified")
		expect(store.gateway_events).toHaveLength(0)
	})

	it("rejects a signature computed with a different secret with 400", async () => {
		const { store, db } = setup()
		const raw = JSON.stringify(checkoutCompleted)
		const result = await deliver(db, raw, stripeSignatureHeader(raw, "whsec_attacker_key"))

		expect(result.status).toBe(400)
		expect(result.code).toBe("unverified")
		expect(store.gateway_events).toHaveLength(0)
	})

	it("fails closed as webhook_config when STRIPE_WEBHOOK_SECRET is unset", async () => {
		delete process.env.STRIPE_WEBHOOK_SECRET
		const { store, db } = setup()
		const raw = JSON.stringify(checkoutCompleted)

		const result = await deliver(db, raw, stripeSignatureHeader(raw, STRIPE_TEST_SECRET))

		expect(result.status).toBe(500)
		expect(result.code).toBe("webhook_config")
		expect(store.gateway_events).toHaveLength(0)
	})

	it("maps a canceling subscription to active + cancel_at_period_end (still entitled)", async () => {
		const { store, db } = setup()
		stripeClientHolder.client = {
			subscriptions: { retrieve: vi.fn(async () => makeStripeSubscription({ cancel_at_period_end: true })) },
		}
		const raw = JSON.stringify(subscriptionUpdated)

		await deliver(db, raw, stripeSignatureHeader(raw))

		const plan = store.workspace_plans[0]
		expect(plan.status).toBe("active")
		expect(plan.cancel_at_period_end).toBe(true)
		expect(plan.tier).toBe("plus")
	})

	it("applies terminal cancellation from the read-back on customer.subscription.deleted", async () => {
		const { store, db } = setup()
		stripeClientHolder.client = {
			subscriptions: { retrieve: vi.fn(async () => makeStripeSubscription({ status: "canceled", ended_at: 1770000150 })) },
		}
		const raw = JSON.stringify(subscriptionDeleted)

		const result = await deliver(db, raw, stripeSignatureHeader(raw))

		expect(result.code).toBe("processed")
		const plan = store.workspace_plans[0]
		expect(plan.status).toBe("canceled")
		expect(plan.tier).toBe("free")
		expect(plan.billing_cycle).toBe("none")
		expect(store.profiles[0].plan).toBe("free")
	})

	it("terminal-cancels via the stored subscription binding when the deleted read-back is gone", async () => {
		const { store, db } = setup({ plan: { gateway: "stripe", gateway_subscription_id: SUB, tier: "pro", status: "active", billing_cycle: "monthly" } })
		stripeClientHolder.client = {
			subscriptions: { retrieve: vi.fn(async () => { throw resourceMissing() }) },
		}
		const raw = JSON.stringify(subscriptionDeleted)

		const result = await deliver(db, raw, stripeSignatureHeader(raw))

		expect(result.code).toBe("processed")
		const plan = store.workspace_plans[0]
		expect(plan.status).toBe("canceled")
		expect(plan.tier).toBe("free")
	})

	it("sets past_due_since on invoice.payment_failed and keeps the tier readable", async () => {
		const { store, db } = setup()
		stripeClientHolder.client = {
			subscriptions: { retrieve: vi.fn(async () => makeStripeSubscription({ status: "past_due" })) },
		}
		const raw = JSON.stringify(invoicePaymentFailed)

		await deliver(db, raw, stripeSignatureHeader(raw))

		const plan = store.workspace_plans[0]
		expect(plan.status).toBe("past_due")
		expect(plan.past_due_since).toBe("2026-10-26T00:00:00.000Z")
		expect(store.profiles[0].plan).toBe("plus") // grace window is fully entitled (D9)
	})

	it("invokes the renewal credits-apply hook on invoice.paid", async () => {
		const { db, applyRenewalCredits } = setup()
		const raw = JSON.stringify(invoicePaid)

		const result = await deliver(db, raw, stripeSignatureHeader(raw), { applyRenewalCredits })

		expect(result.code).toBe("processed")
		expect(applyRenewalCredits).toHaveBeenCalledWith(WS)
	})

	it("stores and no-ops unknown Stripe event types", async () => {
		const { store, db } = setup()
		const retrieve = vi.fn(async () => makeStripeSubscription())
		stripeClientHolder.client = { subscriptions: { retrieve } }
		const unknownEvent = { ...subscriptionUpdated, id: "evt_test_stripe_unknown_001", type: "invoice.upcoming" }
		const raw = JSON.stringify(unknownEvent)

		const result = await deliver(db, raw, stripeSignatureHeader(raw))

		expect(result.status).toBe(200)
		expect(result.code).toBe("ignored")
		const row = store.gateway_events.find((e) => e.event_id === "evt_test_stripe_unknown_001")
		expect(row).toBeTruthy()
		expect(row?.processed_at).not.toBeNull()
		expect(retrieve).not.toHaveBeenCalled()
		expect(store.workspace_plans[0].tier).toBe("free")
	})

	it("short-circuits a duplicate event.id replay with 200 and no second apply", async () => {
		const { store, db } = setup()
		const raw = JSON.stringify(checkoutCompleted)

		await deliver(db, raw, stripeSignatureHeader(raw))
		const second = await deliver(db, raw, stripeSignatureHeader(raw))

		expect(second.status).toBe(200)
		expect(second.code).toBe("duplicate")
		expect(store.gateway_events).toHaveLength(1)
	})

	it("reverse-maps the founding cohort from the persisted subscription metadata", async () => {
		const { store, db } = setup()
		stripeClientHolder.client = {
			subscriptions: {
				retrieve: vi.fn(async () =>
					makeStripeSubscription({
						metadata: { workspace_id: WS, is_founding: "true" },
						items: { data: [{ id: "si_test_001", quantity: 1, current_period_end: PERIOD_END, price: { id: PRICE_PLUS_MONTHLY_FOUNDING, object: "price", currency: "usd" } }] },
					}),
				),
			},
		}
		const raw = JSON.stringify(subscriptionUpdated)

		await deliver(db, raw, stripeSignatureHeader(raw))

		const plan = store.workspace_plans[0]
		expect(plan.is_founding).toBe(true)
		expect(plan.tier).toBe("plus")
	})
})
