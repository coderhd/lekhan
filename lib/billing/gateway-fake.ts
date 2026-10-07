/**
 * T5 — deterministic in-memory fake rail for `LEKHAN_FAKE_PAYMENTS=1`.
 *
 * Lets UI/e2e flows exercise the full checkout/portal/cancel/renewal surface with
 * no money and no network. Every mutation lands in a module-level store that
 * exposes the same read-back surface the webhook processor (T8) will use, so the
 * route invariant tests are read-back-based rather than mock-based.
 */

import {
	assertSellableCheckout,
	SubscriptionNotFoundError,
	type BillingCycle,
	type BillingTier,
	type CheckoutRequest,
	type Currency,
	type GatewaySubscriptionState,
	type GatewaySubscriptionStatus,
	type PaymentGateway,
	type Rail,
	type SchedulePlanChangeRequest,
	type SchedulePlanChangeResult,
} from "./gateway"

/** Deterministic period end so fake state is stable across runs. */
export const FAKE_PERIOD_END = "2026-02-01T00:00:00.000Z"

export interface FakeScheduledChange {
	scheduledChangeRef: string
	tier: BillingTier
	cycle: BillingCycle
	effectiveAt: string
}

export interface FakeSubscriptionRecord {
	subscriptionRef: string
	customerRef: string
	workspaceId: string
	rail: Rail
	tier: BillingTier
	cycle: BillingCycle
	currency: Currency
	isFounding: boolean
	seats?: number
	status: GatewaySubscriptionStatus
	cancelAtPeriodEnd: boolean
	currentPeriodEnd: string
	scheduledChange: FakeScheduledChange | null
}

export type FakeSubscriptionSeed = Omit<FakeSubscriptionRecord, "customerRef" | "scheduledChange"> & {
	customerRef?: string
	scheduledChange?: FakeScheduledChange | null
}

export class FakeBillingStore {
	private subscriptions = new Map<string, FakeSubscriptionRecord>()
	private counter = 0

	reset(): void {
		this.subscriptions.clear()
		this.counter = 0
	}

	private nextRef(prefix: string): string {
		this.counter += 1
		return `fake_${prefix}_${this.counter}`
	}

	/** Test/T8 seam: inject a subscription in a known state (e.g. detaching or past_due). */
	seed(input: FakeSubscriptionSeed): FakeSubscriptionRecord {
		const record: FakeSubscriptionRecord = {
			...input,
			customerRef: input.customerRef ?? this.nextRef("cus"),
			scheduledChange: input.scheduledChange ?? null,
		}
		this.subscriptions.set(record.subscriptionRef, record)
		return record
	}

	create(req: CheckoutRequest, rail: Rail): FakeSubscriptionRecord {
		const record: FakeSubscriptionRecord = {
			subscriptionRef: this.nextRef("sub"),
			customerRef: this.nextRef("cus"),
			workspaceId: req.workspaceId,
			rail,
			tier: req.tier,
			cycle: req.cycle,
			currency: req.currency,
			isFounding: req.isFounding,
			seats: req.seats,
			status: "active",
			cancelAtPeriodEnd: false,
			currentPeriodEnd: FAKE_PERIOD_END,
			scheduledChange: null,
		}
		this.subscriptions.set(record.subscriptionRef, record)
		return record
	}

	get(subscriptionRef: string): FakeSubscriptionRecord | undefined {
		return this.subscriptions.get(subscriptionRef)
	}

	list(): FakeSubscriptionRecord[] {
		return [...this.subscriptions.values()]
	}

	setCancelAtPeriodEnd(subscriptionRef: string, value: boolean): FakeSubscriptionRecord {
		const record = this.get(subscriptionRef)
		if (!record) throw new SubscriptionNotFoundError(subscriptionRef)
		record.cancelAtPeriodEnd = value
		return record
	}

	setStatus(subscriptionRef: string, status: GatewaySubscriptionStatus): FakeSubscriptionRecord {
		const record = this.get(subscriptionRef)
		if (!record) throw new SubscriptionNotFoundError(subscriptionRef)
		record.status = status
		return record
	}

	scheduleChange(subscriptionRef: string, req: SchedulePlanChangeRequest): FakeScheduledChange {
		const record = this.get(subscriptionRef)
		if (!record) throw new SubscriptionNotFoundError(subscriptionRef)
		const change: FakeScheduledChange = {
			scheduledChangeRef: this.nextRef("change"),
			tier: req.tier,
			cycle: req.cycle,
			effectiveAt: record.currentPeriodEnd,
		}
		record.scheduledChange = change
		return change
	}

	clearScheduledChange(subscriptionRef: string): void {
		const record = this.get(subscriptionRef)
		if (!record) throw new SubscriptionNotFoundError(subscriptionRef)
		record.scheduledChange = null
	}
}

const STORE = new FakeBillingStore()

export function getFakeBillingStore(): FakeBillingStore {
	return STORE
}

export function createFakeGateway(rail: Rail): PaymentGateway {
	return {
		rail,
		async createCheckout(req: CheckoutRequest): Promise<{ checkoutUrl: string; opaqueRef: string }> {
			assertSellableCheckout(req)
			const record = STORE.create(req, rail)
			return { checkoutUrl: "#fake-checkout", opaqueRef: record.subscriptionRef }
		},
		async portalUrl(): Promise<{ url: string; kind: "billing_portal" | "card_update" }> {
			return rail === "stripe"
				? { url: "#fake-billing-portal", kind: "billing_portal" }
				: { url: "#fake-card-update", kind: "card_update" }
		},
		async schedulePlanChange(req: SchedulePlanChangeRequest): Promise<SchedulePlanChangeResult> {
			const change = STORE.scheduleChange(req.subscriptionRef, req)
			return {
				subscriptionRef: req.subscriptionRef,
				tier: req.tier,
				cycle: req.cycle,
				effectiveAt: change.effectiveAt,
				scheduledChangeRef: change.scheduledChangeRef,
			}
		},
		async cancelAtPeriodEnd(subscriptionRef: string): Promise<void> {
			STORE.setCancelAtPeriodEnd(subscriptionRef, true)
		},
		async getSubscriptionState(subscriptionRef: string): Promise<GatewaySubscriptionState> {
			const record = STORE.get(subscriptionRef)
			if (!record) throw new SubscriptionNotFoundError(subscriptionRef)
			return {
				subscriptionRef,
				status: record.status,
				cancelAtPeriodEnd: record.cancelAtPeriodEnd,
				currentPeriodEnd: record.currentPeriodEnd,
			}
		},
	}
}

const GATEWAYS = new Map<Rail, PaymentGateway>()

export function getFakeGateway(rail: Rail): PaymentGateway {
	const existing = GATEWAYS.get(rail)
	if (existing) return existing
	const created = createFakeGateway(rail)
	GATEWAYS.set(rail, created)
	return created
}
