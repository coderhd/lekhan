import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * T8 — Razorpay webhook rail (plan T8; spec §6; PDEC-8: no SDK, HMAC-SHA256 via
 * node:crypto timing-safe-equal; Review Focus 1+2).
 *
 * Verification runs the REAL HMAC path (`RAZORPAY_WEBHOOK_SECRET`, raw-body hex
 * digest) against the committed recorded-shaped fixtures signed in-test. The
 * provider transport behind the default read-back is the injected T7
 * `RazorpayHttpClient` seam — no network; entitlement state is written from the
 * read-back object (plan_id reverse-mapped from env bindings), never the payload.
 *
 * Pins: valid signed fixture processed end-to-end; tampered/missing/wrong-secret
 * HMAC fail closed 400 with no row; event id from `X-Razorpay-Event-Id` with a
 * content-hash fallback for replays; subscription.authenticated fires the
 * conversion grant; subscription.charged fires the renewal hook (which no-ops
 * for INR per PDEC-2); halted/pending ⇒ past_due; cancelled ⇒ terminal free;
 * unknown events stored + no-op.
 */

import { processRazorpayWebhook } from "@/services/billing/webhook-processor"
import {
	asSupabaseClient,
	fakeDb,
	seedStore,
	razorpaySignature,
	RAZORPAY_TEST_SECRET,
	WS,
} from "./billing-webhook-testkit"

import subscriptionActivated from "@/tests/fixtures/billing/razorpay-subscription-activated.json"
import subscriptionAuthenticated from "@/tests/fixtures/billing/razorpay-subscription-authenticated.json"
import subscriptionCharged from "@/tests/fixtures/billing/razorpay-subscription-charged.json"
import subscriptionHalted from "@/tests/fixtures/billing/razorpay-subscription-halted.json"
import subscriptionCancelled from "@/tests/fixtures/billing/razorpay-subscription-cancelled.json"

const ENV_KEYS = ["RAZORPAY_WEBHOOK_SECRET", "RAZORPAY_PLAN_PLUS_MONTHLY_GA_INR"] as const
const saved: Record<string, string | undefined> = {}

const PLAN_PLUS_MONTHLY_GA = "plan_test_plus_monthly_ga"
const RAZ_SUB = "sub_test_raz_001"

type Json = Record<string, unknown>

function makeRazorpaySubscription(overrides: Json = {}): Json {
	return {
		id: RAZ_SUB,
		entity: "subscription",
		status: "active",
		plan_id: PLAN_PLUS_MONTHLY_GA,
		quantity: 1,
		customer_id: "cust_test_001",
		current_end: 1769904000,
		cancel_at_cycle_end: false,
		notes: { workspace_id: WS, tier: "plus", cycle: "monthly", is_founding: "false" },
		...overrides,
	}
}

function httpReturning(subscription: Json) {
	const request = vi.fn(async () => subscription)
	return { client: { request }, request }
}

interface SetupOpts {
	plan?: Json
}

function setup(opts: SetupOpts = {}) {
	const store = seedStore({ plan: opts.plan })
	const db = asSupabaseClient(fakeDb(store))
	const grantConversion = vi.fn(async () => ({ granted: false, reason: "not-referred", months: 0, deferred: false }))
	const applyRenewalCredits = vi.fn(async () => ({ applied: false, reason: "not-stripe-rail", monthsApplied: 0, creditMinorUnits: 0, balanceTransactionId: null }))
	return { store, db, grantConversion, applyRenewalCredits }
}

async function deliver(
	db: unknown,
	rawBody: string,
	signature: string,
	opts: {
		eventId?: string
		http?: { request: ReturnType<typeof vi.fn> }
		grantConversion?: unknown
		applyRenewalCredits?: unknown
	} = {},
) {
	return processRazorpayWebhook({
		db: db as never,
		rawBody,
		signature,
		...(opts.eventId !== undefined ? { eventId: opts.eventId } : {}),
		deps: {
			now: () => new Date("2026-10-26T00:00:00.000Z"),
			...(opts.http ? { razorpayHttp: opts.http as never } : {}),
			...(opts.grantConversion ? { grantConversion: opts.grantConversion as never } : {}),
			...(opts.applyRenewalCredits ? { applyRenewalCredits: opts.applyRenewalCredits as never } : {}),
		},
	})
}

describe("billing webhooks — razorpay rail (T8)", () => {
	beforeEach(() => {
		for (const key of ENV_KEYS) {
			saved[key] = process.env[key]
			delete process.env[key]
		}
		process.env.RAZORPAY_WEBHOOK_SECRET = RAZORPAY_TEST_SECRET
		process.env.RAZORPAY_PLAN_PLUS_MONTHLY_GA_INR = PLAN_PLUS_MONTHLY_GA
	})

	afterEach(() => {
		for (const key of ENV_KEYS) {
			if (saved[key] === undefined) delete process.env[key]
			else process.env[key] = saved[key]
		}
		vi.restoreAllMocks()
	})

	it("verifies and processes a genuine signed subscription.activated fixture end-to-end", async () => {
		const { store, db, grantConversion, applyRenewalCredits } = setup()
		const http = httpReturning(makeRazorpaySubscription())
		const raw = JSON.stringify(subscriptionActivated)

		const result = await deliver(db, raw, razorpaySignature(raw), { http: http as never, grantConversion, applyRenewalCredits })

		expect(result.status).toBe(200)
		expect(result.code).toBe("processed")
		// Read-back pointed at the fixture's subscription id…
		expect(http.request).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `/subscriptions/${RAZ_SUB}` }))
		const plan = store.workspace_plans[0]
		// …and applied provider-truth state (plan_id reverse-mapped via env bindings).
		expect(plan.tier).toBe("plus")
		expect(plan.billing_cycle).toBe("monthly")
		expect(plan.status).toBe("active")
		expect(plan.gateway).toBe("razorpay")
		expect(plan.gateway_subscription_id).toBe(RAZ_SUB)
		expect(plan.currency).toBe("INR")
		expect(plan.current_period_end).toBe("2026-02-01T00:00:00.000Z") // fixture current_end: 1769904000
		// Activation is not a paid-conversion event; the conversion grant must not fire.
		expect(grantConversion).not.toHaveBeenCalled()
		expect(applyRenewalCredits).not.toHaveBeenCalled()
	})

	it("writes entitlement state from the read-back, never the payload (forged delta)", async () => {
		const { store, db } = setup()
		const http = httpReturning(makeRazorpaySubscription({ status: "active" }))
		const forged = JSON.parse(JSON.stringify(subscriptionActivated)) as Json
		;(forged.payload as Json).subscription = { entity: { id: RAZ_SUB, status: "cancelled", plan_id: PLAN_PLUS_MONTHLY_GA, notes: {} } }
		const raw = JSON.stringify(forged)

		await deliver(db, raw, razorpaySignature(raw), { http: http as never })

		expect(store.workspace_plans[0].status).toBe("active")
		expect(store.workspace_plans[0].tier).toBe("plus")
	})

	it("rejects a tampered payload with 400 and records nothing", async () => {
		const { store, db } = setup()
		const raw = JSON.stringify(subscriptionActivated)
		const tampered = JSON.stringify({ ...subscriptionActivated, payload: { subscription: { entity: { id: "sub_attacker" } } } })

		const result = await deliver(db, tampered, razorpaySignature(raw)) // signature of the ORIGINAL body

		expect(result.status).toBe(400)
		expect(result.code).toBe("unverified")
		expect(store.gateway_events).toHaveLength(0)
	})

	it("rejects a missing signature header with 400 and records nothing", async () => {
		const { store, db } = setup()
		const result = await deliver(db, JSON.stringify(subscriptionActivated), "")

		expect(result.status).toBe(400)
		expect(result.code).toBe("unverified")
		expect(store.gateway_events).toHaveLength(0)
	})

	it("rejects a signature computed with a different secret with 400", async () => {
		const { store, db } = setup()
		const raw = JSON.stringify(subscriptionActivated)
		const result = await deliver(db, raw, razorpaySignature(raw, "rzp_attacker_secret"))

		expect(result.status).toBe(400)
		expect(result.code).toBe("unverified")
		expect(store.gateway_events).toHaveLength(0)
	})

	it("rejects a wrong-length signature with 400 and records nothing", async () => {
		const { store, db } = setup()
		const raw = JSON.stringify(subscriptionActivated)
		// Valid hex, wrong byte length — the timing-safe pre-check must reject it
		// as 400, never an uncaught comparison error.
		const result = await deliver(db, raw, "deadbeef")

		expect(result.status).toBe(400)
		expect(result.code).toBe("unverified")
		expect(store.gateway_events).toHaveLength(0)
	})

	it("fails closed as webhook_config when RAZORPAY_WEBHOOK_SECRET is unset", async () => {
		delete process.env.RAZORPAY_WEBHOOK_SECRET
		const { store, db } = setup()
		const raw = JSON.stringify(subscriptionActivated)

		const result = await deliver(db, raw, razorpaySignature(raw, RAZORPAY_TEST_SECRET))

		expect(result.status).toBe(500)
		expect(result.code).toBe("webhook_config")
		expect(store.gateway_events).toHaveLength(0)
	})

	it("fires the conversion referral grant on subscription.authenticated after the apply", async () => {
		const { store, db, grantConversion } = setup()
		const http = httpReturning(makeRazorpaySubscription({ status: "authenticated" }))
		const raw = JSON.stringify(subscriptionAuthenticated)

		const result = await deliver(db, raw, razorpaySignature(raw), { http: http as never, grantConversion })

		expect(result.code).toBe("processed")
		expect(store.workspace_plans[0].status).toBe("active") // entitlement first
		expect(grantConversion).toHaveBeenCalledWith(WS) // grant after
	})

	it("fires the renewal credits-apply hook on subscription.charged (INR rows no-op per PDEC-2)", async () => {
		const { db, applyRenewalCredits } = setup()
		const http = httpReturning(makeRazorpaySubscription())
		const raw = JSON.stringify(subscriptionCharged)

		const result = await deliver(db, raw, razorpaySignature(raw), { http: http as never, applyRenewalCredits })

		expect(result.code).toBe("processed")
		expect(applyRenewalCredits).toHaveBeenCalledWith(WS)
	})

	it("maps subscription.halted to past_due and sets past_due_since (7-day grace window D9)", async () => {
		const { store, db } = setup()
		const http = httpReturning(makeRazorpaySubscription({ status: "halted" }))
		const raw = JSON.stringify(subscriptionHalted)

		await deliver(db, raw, razorpaySignature(raw), { http: http as never })

		const plan = store.workspace_plans[0]
		expect(plan.status).toBe("past_due")
		expect(plan.past_due_since).toBe("2026-10-26T00:00:00.000Z")
		expect(plan.tier).toBe("plus") // fully entitled during grace
	})

	it("applies terminal cancellation from the read-back on subscription.cancelled", async () => {
		const { store, db } = setup()
		const http = httpReturning(makeRazorpaySubscription({ status: "cancelled", cancel_at_cycle_end: true }))
		const raw = JSON.stringify(subscriptionCancelled)

		await deliver(db, raw, razorpaySignature(raw), { http: http as never })

		const plan = store.workspace_plans[0]
		expect(plan.status).toBe("canceled")
		expect(plan.tier).toBe("free")
		expect(plan.billing_cycle).toBe("none")
		expect(plan.cancel_at_period_end).toBe(false)
		expect(store.profiles[0].plan).toBe("free")
	})

	it("reverse-maps a padded Razorpay plan env binding (operator whitespace)", async () => {
		process.env.RAZORPAY_PLAN_PLUS_MONTHLY_GA_INR = `  ${PLAN_PLUS_MONTHLY_GA}  `
		const { store, db } = setup()
		const http = httpReturning(makeRazorpaySubscription())
		const raw = JSON.stringify(subscriptionActivated)

		const result = await deliver(db, raw, razorpaySignature(raw), { http: http as never })

		expect(result.code).toBe("processed")
		expect(store.workspace_plans[0].tier).toBe("plus")
		expect(store.workspace_plans[0].billing_cycle).toBe("monthly")
	})

	it("preserves an accepted cancel-at-cycle-end across non-terminal Razorpay webhooks (provider never echoes it)", async () => {
		const { store, db } = setup({
			plan: {
				workspace_id: WS,
				tier: "plus",
				billing_cycle: "monthly",
				status: "active",
				gateway: "razorpay",
				gateway_subscription_id: RAZ_SUB,
				cancel_at_period_end: true,
			},
		})
		const http = httpReturning(makeRazorpaySubscription({ status: "active", cancel_at_cycle_end: false }))
		const raw = JSON.stringify(subscriptionActivated)

		await deliver(db, raw, razorpaySignature(raw), { http: http as never })

		expect(store.workspace_plans[0].status).toBe("active")
		expect(store.workspace_plans[0].cancel_at_period_end).toBe(true)
	})

	it("does not inherit a previous generation's cancel flag on resubscribe", async () => {
		const { store, db } = setup({
			plan: {
				workspace_id: WS,
				tier: "plus",
				billing_cycle: "monthly",
				status: "active",
				gateway: "razorpay",
				gateway_subscription_id: "sub_test_raz_old",
				cancel_at_period_end: true,
			},
		})
		const http = httpReturning(makeRazorpaySubscription({ status: "active", cancel_at_cycle_end: false }))
		const raw = JSON.stringify(subscriptionActivated)

		await deliver(db, raw, razorpaySignature(raw), { http: http as never })

		expect(store.workspace_plans[0].gateway_subscription_id).toBe(RAZ_SUB)
		expect(store.workspace_plans[0].cancel_at_period_end).toBe(false)
	})

	it("uses the X-Razorpay-Event-Id header as the dedup key when present", async () => {
		const { store, db } = setup()
		const http = httpReturning(makeRazorpaySubscription())
		const raw = JSON.stringify(subscriptionActivated)

		await deliver(db, raw, razorpaySignature(raw), { eventId: "evt_raz_header_001", http: http as never })
		const second = await deliver(db, raw, razorpaySignature(raw), { eventId: "evt_raz_header_001", http: http as never })

		expect(second.code).toBe("duplicate")
		expect(store.gateway_events).toHaveLength(1)
		expect(store.gateway_events[0].event_id).toBe("evt_raz_header_001")
	})

	it("dedupes headerless replays via the content-hash fallback event id", async () => {
		const { store, db } = setup()
		const http = httpReturning(makeRazorpaySubscription())
		const raw = JSON.stringify(subscriptionActivated)

		await deliver(db, raw, razorpaySignature(raw), { http: http as never })
		const second = await deliver(db, raw, razorpaySignature(raw), { http: http as never })

		expect(second.code).toBe("duplicate")
		expect(store.gateway_events).toHaveLength(1)
	})

	it("stores and no-ops unknown Razorpay event types", async () => {
		const { store, db } = setup()
		const http = httpReturning(makeRazorpaySubscription())
		const unknownEvent = { event: "payment.authorized", payload: { payment: { entity: { id: "pay_test_002" } } } }
		const raw = JSON.stringify(unknownEvent)

		const result = await deliver(db, raw, razorpaySignature(raw), { http: http as never })

		expect(result.status).toBe(200)
		expect(result.code).toBe("ignored")
		const row = store.gateway_events[0]
		expect(row?.type).toBe("payment.authorized")
		expect(row?.processed_at).not.toBeNull()
		expect(http.request).not.toHaveBeenCalled()
		expect(store.workspace_plans[0].tier).toBe("free")
	})
})
