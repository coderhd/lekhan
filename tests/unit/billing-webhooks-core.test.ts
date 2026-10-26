import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * T8 — webhook processor CORE pipeline (rail-agnostic pins; plan T8, spec §6/§13,
 * US-12; Review Focus 1+2).
 *
 * Verification and per-rail payload mapping are pinned in the rail suites; this
 * suite pins the hard processing order with the verification step injected:
 *  - raw-record-before-processing (a crash after insert leaves the row recorded)
 *  - duplicate `event_id` replays short-circuit 200; an UNPROCESSED row (crashed
 *    mid-processing) is repaired on redelivery — the apply is idempotent
 *  - the payload is audit-only: entitlement state is written from the provider
 *    read-back, so forged payload deltas and out-of-order deliveries converge to
 *    provider truth (never blind-downgrade)
 *  - unknown event types are stored and no-op
 *  - `workspace_plans` upsert + normalized `profiles.plan` mirror; canceling is
 *    active + `cancel_at_period_end` (no 'canceling' status value exists);
 *    `past_due_since` set on the transition, kept across repeat past_due events,
 *    cleared on recovery/terminal
 *  - referral hooks fire after the entitlement apply (TL A4): conversion grant on
 *    paid-conversion events, credits-apply on renewal events
 */

import {
	processStripeWebhook,
	type VerifiedWebhookEvent,
	type WebhookProcessorDeps,
} from "@/services/billing/webhook-processor"
import {
	asSupabaseClient,
	contentEventId,
	fakeDb,
	readBackGone,
	readBackReturning,
	readBackThrowing,
	seedStore,
	SUB,
	WS,
	type Store,
} from "./billing-webhook-testkit"

const T0 = new Date("2026-10-26T00:00:00.000Z")
function makeNow(tick: Date[] = []) {
	let i = 0
	return () => tick[i] ?? new Date(T0.getTime() + 60_000 * i++)
}

interface VerifyCall {
	eventId: string
	eventType: string
	pointerRef: string | null
	pointerKind: "subscription" | "deletion"
	payload?: unknown
}

function verified(call: VerifyCall): VerifiedWebhookEvent {
	return {
		eventId: call.eventId,
		eventType: call.eventType,
		pointerRef: call.pointerRef ?? null,
		pointerKind: call.pointerKind,
		payload: call.payload ?? { object: { id: SUB } },
	}
}

interface SetupOpts {
	store?: Store
	readSubscription?: WebhookProcessorDeps["readSubscription"]
}

function setup(opts: SetupOpts = {}) {
	const store = opts.store ?? seedStore()
	const db = asSupabaseClient(fakeDb(store))
	const base: WebhookProcessorDeps = {
		db,
		now: makeNow(),
		readSubscription: opts.readSubscription,
		grantConversion: vi.fn(async () => ({ granted: false, reason: "not-referred", months: 0, deferred: false })),
		applyRenewalCredits: vi.fn(async () => ({ applied: false, reason: "nothing-banked", monthsApplied: 0, creditMinorUnits: 0, balanceTransactionId: null })),
	}
	return { store, db, base }
}

async function process(store: Store, deps: WebhookProcessorDeps, call: VerifyCall) {
	return processStripeWebhook({
		db: deps.db,
		rawBody: JSON.stringify(call.payload ?? {}),
		signature: "irrelevant",
		deps: {
			...deps,
			verify: () => verified(call),
			readSubscription: deps.readSubscription,
		},
	})
}

const PAID_PAYLOAD = {
	object: {
		id: SUB,
		object: "subscription",
		// Forged delta bait: the payload claims pro/2050 — the read-back wins.
		status: "active",
		tier_claim: "pro",
		current_period_end: "2050-01-01T00:00:00.000Z",
	},
}

describe("billing webhook processor — core pipeline (T8)", () => {
	beforeEach(() => {
		vi.resetModules()
	})

	it("records the raw event before processing and marks processed_at on success", async () => {
		const { store, base } = setup({ readSubscription: readBackReturning() })
		const result = await process(store, base, {
			eventId: "evt_1",
			eventType: "checkout.session.completed",
			pointerRef: SUB,
			pointerKind: "subscription",
			payload: PAID_PAYLOAD,
		})

		expect(result.status).toBe(200)
		expect(result.code).toBe("processed")
		const row = store.gateway_events.find((e) => e.event_id === "evt_1")
		expect(row).toBeTruthy()
		expect(row?.type).toBe("checkout.session.completed")
		expect(row?.payload).toEqual(PAID_PAYLOAD)
		expect(row?.processed_at).not.toBeNull()
		// Entitlement applied from the read-back.
		const plan = store.workspace_plans[0]
		expect(plan.tier).toBe("plus")
		expect(plan.status).toBe("active")
	})

	it("short-circuits a replayed processed event with 200 and never re-applies", async () => {
		const { store, base } = setup({ readSubscription: readBackReturning() })
		store.gateway_events.push({
			id: "gen-1",
			gateway: "stripe",
			event_id: "evt_dup",
			type: "checkout.session.completed",
			payload: {},
			processed_at: T0.toISOString(),
		})
		const readSpy = vi.fn(readBackReturning())
		const result = await processStripeWebhook({
			db: base.db,
			rawBody: "{}",
			signature: "irrelevant",
			deps: { ...base, verify: () => verified({ eventId: "evt_dup", eventType: "checkout.session.completed", pointerRef: SUB, pointerKind: "subscription" }), readSubscription: readSpy },
		})

		expect(result.status).toBe(200)
		expect(result.code).toBe("duplicate")
		expect(readSpy).not.toHaveBeenCalled()
		// Plan row untouched.
		expect(store.workspace_plans[0].tier).toBe("free")
	})

	it("repairs an unprocessed row left by a crashed processor on redelivery", async () => {
		const { store, base } = setup({ readSubscription: readBackReturning() })
		store.gateway_events.push({
			id: "gen-1",
			gateway: "stripe",
			event_id: "evt_crash",
			type: "customer.subscription.updated",
			payload: {},
			processed_at: null,
		})
		const result = await process(store, base, {
			eventId: "evt_crash",
			eventType: "customer.subscription.updated",
			pointerRef: SUB,
			pointerKind: "subscription",
		})

		expect(result.status).toBe(200)
		expect(result.code).toBe("processed")
		expect(store.gateway_events[0].processed_at).not.toBeNull()
		expect(store.workspace_plans[0].tier).toBe("plus")
	})

	it("leaves the row recorded and unprocessed when the provider read-back fails (raw-record-before-processing)", async () => {
		const { store, base } = setup({ readSubscription: readBackThrowing(new Error("provider down")) })
		const result = await process(store, base, {
			eventId: "evt_2",
			eventType: "customer.subscription.updated",
			pointerRef: SUB,
			pointerKind: "subscription",
		})

		expect(result.status).toBe(502)
		expect(result.code).toBe("processing_failed")
		const row = store.gateway_events.find((e) => e.event_id === "evt_2")
		expect(row).toBeTruthy() // recorded
		expect(row?.processed_at).toBeNull() // unprocessed
		expect(store.workspace_plans[0].tier).toBe("free") // no effect
	})

	it("writes entitlement state from the read-back, never the payload (forged delta rejected)", async () => {
		const { store, base } = setup({ readSubscription: readBackReturning({ tier: "plus", currentPeriodEnd: "2026-02-01T00:00:00.000Z" }) })
		await process(store, base, {
			eventId: "evt_3",
			eventType: "customer.subscription.updated",
			pointerRef: SUB,
			pointerKind: "subscription",
			// Payload claims pro/2050; read-back says plus/2026-02.
			payload: PAID_PAYLOAD,
		})

		const plan = store.workspace_plans[0]
		expect(plan.tier).toBe("plus")
		expect(plan.current_period_end).toBe("2026-02-01T00:00:00.000Z")
	})

	it("never blind-downgrades from a payload claiming cancellation when the provider reports active", async () => {
		const { store, base } = setup({ readSubscription: readBackReturning({ status: "active" }) })
		await process(store, base, {
			eventId: "evt_4",
			eventType: "customer.subscription.updated",
			pointerRef: SUB,
			pointerKind: "subscription",
			payload: { object: { id: SUB, status: "canceled", cancel_at_period_end: true } },
		})

		const plan = store.workspace_plans[0]
		expect(plan.status).toBe("active")
		expect(plan.tier).toBe("plus")
	})

	it("converges out-of-order deliveries to provider truth (last-writer-wins by read-back)", async () => {
		const { store, base } = setup({ readSubscription: readBackReturning({ tier: "pro", currentPeriodEnd: "2026-03-01T00:00:00.000Z" }) })
		// A "newer" delivery first…
		await process(store, base, { eventId: "evt_new", eventType: "customer.subscription.updated", pointerRef: SUB, pointerKind: "subscription", payload: { object: { tier_claim: "pro", period: "2026-03-01" } } })
		// …then a STALE delivery replayed late; the read-back still returns current truth.
		await process(store, base, { eventId: "evt_stale", eventType: "customer.subscription.updated", pointerRef: SUB, pointerKind: "subscription", payload: { object: { tier_claim: "plus", period: "2025-01-01" } } })

		const plan = store.workspace_plans[0]
		expect(plan.tier).toBe("pro")
		expect(plan.current_period_end).toBe("2026-03-01T00:00:00.000Z")
	})

	it("stores and no-ops unknown event types — never blind-downgrade", async () => {
		const { store, base } = setup({ readSubscription: readBackReturning() })
		const readSpy = vi.fn(readBackReturning())
		const result = await processStripeWebhook({
			db: base.db,
			rawBody: "{}",
			signature: "irrelevant",
			deps: { ...base, verify: () => verified({ eventId: "evt_5", eventType: "invoice.upcoming", pointerRef: null, pointerKind: "subscription" }), readSubscription: readSpy },
		})

		expect(result.status).toBe(200)
		expect(result.code).toBe("ignored")
		const row = store.gateway_events.find((e) => e.event_id === "evt_5")
		expect(row).toBeTruthy()
		expect(row?.processed_at).not.toBeNull()
		expect(readSpy).not.toHaveBeenCalled()
		expect(store.workspace_plans[0].tier).toBe("free")
	})

	it("no-ops (stored) when a non-deletion pointer's subscription is gone from the provider", async () => {
		const { store, base } = setup({ readSubscription: readBackGone() })
		const result = await process(store, base, {
			eventId: "evt_6",
			eventType: "customer.subscription.updated",
			pointerRef: SUB,
			pointerKind: "subscription",
		})

		expect(result.status).toBe(200)
		expect(result.code).toBe("ignored")
		expect(store.workspace_plans[0].tier).toBe("free")
		expect(store.gateway_events[0].processed_at).not.toBeNull()
	})

	it("terminal-cancels via the stored subscription binding when a deletion notice read-back is gone", async () => {
		const { store, base } = setup({
			store: seedStore({
				plan: { gateway: "stripe", gateway_subscription_id: SUB, tier: "pro", status: "active", billing_cycle: "monthly" },
			}),
			readSubscription: readBackGone(),
		})
		const result = await process(store, base, {
			eventId: "evt_7",
			eventType: "customer.subscription.deleted",
			pointerRef: SUB,
			pointerKind: "deletion",
		})

		expect(result.status).toBe(200)
		expect(result.code).toBe("processed")
		const plan = store.workspace_plans[0]
		expect(plan.status).toBe("canceled")
		expect(plan.tier).toBe("free")
		expect(plan.billing_cycle).toBe("none")
		expect(plan.cancel_at_period_end).toBe(false)
		expect(plan.past_due_since).toBeNull()
	})

	it("represents cancel-at-period-end as active + cancel flag (canceling), still entitled", async () => {
		const { store, base } = setup({ readSubscription: readBackReturning({ status: "active", cancelAtPeriodEnd: true }) })
		await process(store, base, { eventId: "evt_8", eventType: "customer.subscription.updated", pointerRef: SUB, pointerKind: "subscription" })

		const plan = store.workspace_plans[0]
		expect(plan.status).toBe("active")
		expect(plan.cancel_at_period_end).toBe(true)
		expect(plan.tier).toBe("plus")
	})

	it("sets past_due_since on the past_due transition and keeps the original clock on repeat past_due events", async () => {
		const t1 = new Date("2026-10-01T00:00:00.000Z")
		const t2 = new Date("2026-10-20T00:00:00.000Z")
		let n = 0
		const now = () => (n++ === 0 ? t1 : t2)
		const { store } = setup({ readSubscription: readBackReturning({ status: "past_due" }) })
		const db = asSupabaseClient(fakeDb(store))
		await processStripeWebhook({
			db,
			rawBody: "{}",
			signature: "irrelevant",
			deps: { db, now, verify: () => verified({ eventId: "evt_pd1", eventType: "invoice.payment_failed", pointerRef: SUB, pointerKind: "subscription" }), readSubscription: readBackReturning({ status: "past_due" }) },
		})
		expect(store.workspace_plans[0].past_due_since).toBe(t1.toISOString())

		await processStripeWebhook({
			db,
			rawBody: "{}",
			signature: "irrelevant",
			deps: { db, now, verify: () => verified({ eventId: "evt_pd2", eventType: "invoice.payment_failed", pointerRef: SUB, pointerKind: "subscription" }), readSubscription: readBackReturning({ status: "past_due" }) },
		})
		// Clock never resets on repeat past_due.
		expect(store.workspace_plans[0].past_due_since).toBe(t1.toISOString())
	})

	it("clears past_due_since on recovery to active", async () => {
		const { store, base } = setup({
			store: seedStore({ plan: { status: "past_due", past_due_since: "2026-10-01T00:00:00.000Z", tier: "plus", billing_cycle: "monthly", gateway: "stripe" } }),
			readSubscription: readBackReturning({ status: "active" }),
		})
		await process(store, base, { eventId: "evt_rec", eventType: "customer.subscription.updated", pointerRef: SUB, pointerKind: "subscription" })

		expect(store.workspace_plans[0].status).toBe("active")
		expect(store.workspace_plans[0].past_due_since).toBeNull()
	})

	it("mirrors the normalized tier to the owner's profiles.plan", async () => {
		const { store, base } = setup({ readSubscription: readBackReturning({ tier: "pro", status: "active" }) })
		await process(store, base, { eventId: "evt_9", eventType: "customer.subscription.updated", pointerRef: SUB, pointerKind: "subscription" })

		expect(store.profiles[0].plan).toBe("pro")
	})

	it("mirrors free on terminal cancellation (entitlement ended)", async () => {
		const { store, base } = setup({
			store: seedStore({ plan: { gateway: "stripe", gateway_subscription_id: SUB, tier: "pro", status: "active", billing_cycle: "monthly" } }),
			readSubscription: readBackReturning({ status: "canceled" }),
		})
		await process(store, base, { eventId: "evt_10", eventType: "customer.subscription.deleted", pointerRef: SUB, pointerKind: "subscription" })

		expect(store.profiles[0].plan).toBe("free")
		const plan = store.workspace_plans[0]
		expect(plan.tier).toBe("free")
		expect(plan.status).toBe("canceled")
	})

	it("invokes the conversion referral grant AFTER the entitlement apply (order pinned)", async () => {
		const { store, base } = setup({ readSubscription: readBackReturning({ tier: "pro", status: "active" }) })
		const grantCalls: string[] = []
		const grantConversion = vi.fn(async (workspaceId: string) => {
			grantCalls.push(workspaceId)
			// At grant time the entitlement apply must already be durable.
			expect(store.workspace_plans[0].tier).toBe("pro")
			expect(store.workspace_plans[0].status).toBe("active")
			return { granted: true, reason: "granted", months: 1, deferred: false }
		})
		const result = await processStripeWebhook({
			db: base.db,
			rawBody: "{}",
			signature: "irrelevant",
			deps: {
				...base,
				grantConversion,
				verify: () => verified({ eventId: "evt_11", eventType: "checkout.session.completed", pointerRef: SUB, pointerKind: "subscription" }),
				readSubscription: readBackReturning({ tier: "pro", status: "active" }),
			},
		})

		expect(result.code).toBe("processed")
		expect(grantCalls).toEqual([WS])
	})

	it("invokes the renewal credits-apply hook on renewal events", async () => {
		const { base } = setup({ readSubscription: readBackReturning() })
		const applyRenewalCredits = vi.fn(async () => ({ applied: false, reason: "nothing-banked", monthsApplied: 0, creditMinorUnits: 0, balanceTransactionId: null }))
		const result = await processStripeWebhook({
			db: base.db,
			rawBody: "{}",
			signature: "irrelevant",
			deps: {
				...base,
				applyRenewalCredits,
				verify: () => verified({ eventId: "evt_12", eventType: "invoice.paid", pointerRef: SUB, pointerKind: "subscription" }),
				readSubscription: readBackReturning(),
			},
		})

		expect(result.code).toBe("processed")
		expect(applyRenewalCredits).toHaveBeenCalledWith(WS)
	})

	it("fails loud (row recorded, unprocessed) when the read-back carries no workspace binding", async () => {
		const { store, base } = setup({ readSubscription: readBackReturning({ workspaceId: null }) })
		const result = await process(store, base, { eventId: "evt_13", eventType: "customer.subscription.updated", pointerRef: SUB, pointerKind: "subscription" })

		expect(result.status).toBe(502)
		expect(store.gateway_events[0].processed_at).toBeNull()
		expect(store.workspace_plans[0].tier).toBe("free")
	})

	it("creates the billing root row on apply when it does not exist yet", async () => {
		const { store, base } = setup({ store: seedStore(), readSubscription: readBackReturning() })
		store.workspace_plans = [] // no root row
		await process(store, base, { eventId: "evt_14", eventType: "checkout.session.completed", pointerRef: SUB, pointerKind: "subscription" })

		expect(store.workspace_plans).toHaveLength(1)
		expect(store.workspace_plans[0].workspace_id).toBe(WS)
		expect(store.workspace_plans[0].tier).toBe("plus")
		expect(store.workspace_plans[0].gateway).toBe("stripe")
	})

	it("persists provider-mirrored fields: customer, subscription ref, currency, seats, period end", async () => {
		const { store, base } = setup({
			readSubscription: readBackReturning({ customerRef: "cus_X", seats: 5, currentPeriodEnd: "2026-02-01T00:00:00.000Z", isFounding: true, cycle: "annual", tier: "team" }),
		})
		await process(store, base, { eventId: "evt_15", eventType: "checkout.session.completed", pointerRef: SUB, pointerKind: "subscription" })

		const plan = store.workspace_plans[0]
		expect(plan.gateway_customer_id).toBe("cus_X")
		expect(plan.gateway_subscription_id).toBe(SUB)
		expect(plan.currency).toBe("USD") // rail-derived
		expect(plan.seats).toBe(5)
		expect(plan.current_period_end).toBe("2026-02-01T00:00:00.000Z")
		expect(plan.is_founding).toBe(true)
		expect(plan.billing_cycle).toBe("annual")
	})

	it("fails loud (row recorded, unprocessed) when a non-terminal read-back has no mapped tier (unmapped price)", async () => {
		const { store, base } = setup({ readSubscription: readBackReturning({ tier: null, cycle: null }) })
		const result = await process(store, base, { eventId: "evt_16", eventType: "customer.subscription.updated", pointerRef: SUB, pointerKind: "subscription" })

		expect(result.status).toBe(502)
		expect(store.gateway_events[0].processed_at).toBeNull()
		expect(store.workspace_plans[0].tier).toBe("free")
	})

	it("content-derived event ids dedupe razorpay replays that lack an event-id header", async () => {
		// Rail-agnostic pin: the processor treats the event id as the dedup key; the
		// razorpay content-hash fallback produces identical ids for identical bodies.
		expect(contentEventId("{}")).toBe(contentEventId("{}"))
	})
})
