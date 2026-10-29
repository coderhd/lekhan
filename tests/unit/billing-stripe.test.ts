import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type Stripe from "stripe"

/**
 * T6 — Stripe rail (plan T6 / spec §5 as amended by PDEC-12).
 *
 * Adapter-level pins only (the route-level single-live-subscription invariant is
 * pinned in T5's `billing-gateway.test.ts`). No network: the Stripe SDK client is
 * injected, and every assertion is made on the request the rail would send.
 *
 * Pins:
 *  - checkout session carries workspace context + the T2 server-resolved price only
 *    (never a client amount/tier/price; founding namespace only when isFounding)
 *  - founding flag is persisted at creation (`subscription_data.metadata.is_founding`)
 *  - resubscribe reuses the stored `gateway_customer_id`, never a new customer (US-6 AC2)
 *  - portal is the Stripe plan-change mechanism (PDEC-12): generic portal session +
 *    the subscription-update deep-link seam
 *  - cancel-at-period-end + read-back mapping of subscription state
 */

const ENV_KEYS = [
	"STRIPE_SECRET_KEY",
	"NEXT_PUBLIC_APP_URL",
	"STRIPE_PRICE_PRO_MONTHLY_GA_USD",
	"STRIPE_PRICE_PLUS_ANNUAL_FOUNDING_USD",
	"STRIPE_PRICE_TEAM_MONTHLY_GA_USD",
	"LEKHAN_FAKE_PAYMENTS",
] as const

const saved: Record<string, string | undefined> = {}

const PERIOD_END_SECONDS = 1770508800 // 2026-02-08T00:00:00.000Z
const PERIOD_END_ISO = new Date(PERIOD_END_SECONDS * 1000).toISOString()
const APP_URL = "https://lekhan.app"

function makeSubscription(overrides: Record<string, unknown> = {}) {
	return {
		id: "sub_test_1",
		object: "subscription",
		customer: "cus_stored",
		status: "active",
		cancel_at_period_end: false,
		items: {
			data: [
				{
					id: "si_1",
					current_period_start: 1767916800,
					current_period_end: PERIOD_END_SECONDS,
				},
			],
		},
		...overrides,
	}
}

function stripeStub() {
	const calls: { checkout?: any; portal?: any } = {}
	const checkoutCreate = vi.fn(async (params: any) => {
		calls.checkout = params
		return {
			id: "cs_test_1",
			object: "checkout.session",
			url: "https://checkout.stripe.com/c/pay/cs_test_1",
		}
	})
	const portalCreate = vi.fn(async (params: any) => {
		calls.portal = params
		return {
			id: "bps_1",
			object: "billing_portal.session",
			url: "https://billing.stripe.com/session/bps_1",
		}
	})
	const subscriptionUpdate = vi.fn(async (id: string, params: Record<string, unknown>) => ({ id, ...params }))
	const subscriptionRetrieve = vi.fn(async (id: string) => makeSubscription({ id }))

	const client = {
		checkout: { sessions: { create: checkoutCreate } },
		billingPortal: { sessions: { create: portalCreate } },
		subscriptions: { update: subscriptionUpdate, retrieve: subscriptionRetrieve },
	}

	return {
		client: client as unknown as Stripe,
		calls,
		checkoutCreate,
		portalCreate,
		subscriptionUpdate,
		subscriptionRetrieve,
	}
}

async function importRail() {
	return import("@/lib/billing/stripe")
}

beforeEach(() => {
	for (const key of ENV_KEYS) saved[key] = process.env[key]
	delete process.env.LEKHAN_FAKE_PAYMENTS
	delete process.env.STRIPE_SECRET_KEY
	process.env.NEXT_PUBLIC_APP_URL = APP_URL
	process.env.STRIPE_PRICE_PRO_MONTHLY_GA_USD = "price_pro_monthly_ga"
	process.env.STRIPE_PRICE_PLUS_ANNUAL_FOUNDING_USD = "price_plus_annual_founding"
	process.env.STRIPE_PRICE_TEAM_MONTHLY_GA_USD = "price_team_monthly_ga"
})

afterEach(() => {
	for (const key of ENV_KEYS) {
		if (saved[key] === undefined) delete process.env[key]
		else process.env[key] = saved[key]
	}
	vi.restoreAllMocks()
})

describe("Stripe createCheckout", () => {
	it("builds a subscription session from the server-resolved price and workspace context", async () => {
		const { createStripeGateway } = await importRail()
		const { client, calls } = stripeStub()
		const gateway = createStripeGateway(client)

		const session = await gateway.createCheckout({
			workspaceId: "ws-1",
			tier: "pro",
			cycle: "monthly",
			currency: "USD",
			isFounding: false,
		})

		expect(session).toEqual({
			checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_1",
			opaqueRef: "cs_test_1",
		})

		const params = calls.checkout
		expect(params.mode).toBe("subscription")
		// Price id comes from env resolution only — never from the request.
		expect(params.line_items).toEqual([{ price: "price_pro_monthly_ga", quantity: 1 }])
		expect(params.metadata).toEqual({ workspace_id: "ws-1" })
		expect(params.subscription_data.metadata).toEqual({ workspace_id: "ws-1", is_founding: "false" })
		expect(params.success_url).toBe(`${APP_URL}/settings?billing=checkout_success`)
		expect(params.cancel_url).toBe(`${APP_URL}/settings?billing=checkout_cancelled`)
		// No stored customer → Stripe creates one during Checkout (persisted by T8 read-back).
		expect(params.customer).toBeUndefined()
	})

	it("persists the founding flag at creation and resolves the founding price namespace", async () => {
		const { createStripeGateway } = await importRail()
		const { client, calls } = stripeStub()
		const gateway = createStripeGateway(client)

		await gateway.createCheckout({
			workspaceId: "ws-1",
			tier: "plus",
			cycle: "annual",
			currency: "USD",
			isFounding: true,
		})

		const params = calls.checkout
		expect(params.line_items).toEqual([{ price: "price_plus_annual_founding", quantity: 1 }])
		expect(params.subscription_data.metadata.is_founding).toBe("true")
	})

	it("reuses a stored customer id when present (resubscribe — US-6 AC2)", async () => {
		const { createStripeGateway } = await importRail()
		const { client, calls } = stripeStub()
		const gateway = createStripeGateway(client)

		await gateway.createCheckout({
			workspaceId: "ws-1",
			tier: "pro",
			cycle: "monthly",
			currency: "USD",
			isFounding: false,
			customerRef: "cus_stored",
		})

		const params = calls.checkout
		expect(params.customer).toBe("cus_stored")
		expect(params.customer_creation).toBeUndefined()
	})

	it("scales the Team line item by purchased seats", async () => {
		const { createStripeGateway } = await importRail()
		const { client, calls } = stripeStub()
		const gateway = createStripeGateway(client)

		await gateway.createCheckout({
			workspaceId: "ws-1",
			tier: "team",
			cycle: "monthly",
			currency: "USD",
			isFounding: false,
			seats: 3,
		})

		const params = calls.checkout
		expect(params.line_items).toEqual([{ price: "price_team_monthly_ga", quantity: 3 }])
	})

	it("fails closed when the server-side price binding is missing", async () => {
		const { createStripeGateway } = await importRail()
		const { PriceConfigError } = await import("@/lib/billing/prices")
		const { client } = stripeStub()
		const gateway = createStripeGateway(client)
		delete process.env.STRIPE_PRICE_PRO_MONTHLY_GA_USD

		await expect(
			gateway.createCheckout({ workspaceId: "ws-1", tier: "pro", cycle: "monthly", currency: "USD", isFounding: false }),
		).rejects.toBeInstanceOf(PriceConfigError)
	})

	it("rejects a non-USD currency on the Stripe rail", async () => {
		const { createStripeGateway } = await importRail()
		const { UnsupportedCurrencyError } = await import("@/lib/billing/gateway")
		const { client } = stripeStub()
		const gateway = createStripeGateway(client)

		await expect(
			gateway.createCheckout({ workspaceId: "ws-1", tier: "pro", cycle: "monthly", currency: "INR", isFounding: false }),
		).rejects.toBeInstanceOf(UnsupportedCurrencyError)
	})

	it("fails closed when STRIPE_SECRET_KEY is missing for the default client", async () => {
		const { createStripeGateway, StripeConfigError } = await importRail()
		const gateway = createStripeGateway()

		await expect(
			gateway.createCheckout({ workspaceId: "ws-1", tier: "pro", cycle: "monthly", currency: "USD", isFounding: false }),
		).rejects.toBeInstanceOf(StripeConfigError)
	})
})

describe("Stripe portalUrl", () => {
	it("returns a Billing Portal session for the stored customer (plan change rides the portal — PDEC-12)", async () => {
		const { createStripeGateway } = await importRail()
		const { client, portalCreate } = stripeStub()
		const gateway = createStripeGateway(client)

		const portal = await gateway.portalUrl("cus_stored")

		expect(portal).toEqual({ url: "https://billing.stripe.com/session/bps_1", kind: "billing_portal" })
		expect(portalCreate).toHaveBeenCalledWith({
			customer: "cus_stored",
			return_url: `${APP_URL}/settings?billing=portal_return`,
		})
	})

	it("fails closed when NEXT_PUBLIC_APP_URL is missing", async () => {
		const { createStripeGateway, StripeConfigError } = await importRail()
		const { client } = stripeStub()
		const gateway = createStripeGateway(client)
		delete process.env.NEXT_PUBLIC_APP_URL

		await expect(gateway.portalUrl("cus_stored")).rejects.toBeInstanceOf(StripeConfigError)
	})
})

describe("Stripe schedulePlanChange", () => {
	it("deep-links the subscription-update portal flow and reports the period-end effect", async () => {
		const { createStripeGateway } = await importRail()
		const { client, portalCreate, subscriptionRetrieve } = stripeStub()
		const gateway = createStripeGateway(client)

		const result = await gateway.schedulePlanChange({
			subscriptionRef: "sub_test_1",
			tier: "pro",
			cycle: "annual",
		})

		expect(result).toEqual({
			subscriptionRef: "sub_test_1",
			tier: "pro",
			cycle: "annual",
			effectiveAt: PERIOD_END_ISO,
			scheduledChangeRef: "bps_1",
		})
		expect(subscriptionRetrieve).toHaveBeenCalledWith("sub_test_1")
		expect(portalCreate).toHaveBeenCalledWith({
			customer: "cus_stored",
			return_url: `${APP_URL}/settings?billing=plan_change_return`,
			flow_data: {
				type: "subscription_update",
				subscription_update: { subscription: "sub_test_1" },
			},
		})
	})

	it("fails closed when the provider read-back omits the period end", async () => {
		const { createStripeGateway, StripeConfigError } = await importRail()
		const { client, portalCreate, subscriptionRetrieve } = stripeStub()
		const gateway = createStripeGateway(client)

		// A subscription whose items carry no `current_period_end`: the rail must not
		// emit a "" sentinel into `effectiveAt` (module doctrine: fails closed).
		subscriptionRetrieve.mockResolvedValueOnce(makeSubscription({ items: { data: [] } }) as any)

		await expect(
			gateway.schedulePlanChange({
				subscriptionRef: "sub_test_1",
				tier: "pro",
				cycle: "annual",
			}),
		).rejects.toBeInstanceOf(StripeConfigError)
		// Fail before opening a portal session we would then have to discard.
		expect(portalCreate).not.toHaveBeenCalled()
	})
})

describe("Stripe cancelAtPeriodEnd", () => {
	it("schedules cancellation at the end of the current period", async () => {
		const { createStripeGateway } = await importRail()
		const { client, subscriptionUpdate } = stripeStub()
		const gateway = createStripeGateway(client)

		await gateway.cancelAtPeriodEnd("sub_test_1")

		expect(subscriptionUpdate).toHaveBeenCalledWith("sub_test_1", { cancel_at_period_end: true })
	})
})

describe("Stripe getSubscriptionState (read-back)", () => {
	it("maps provider status and period end from the live subscription object", async () => {
		const { createStripeGateway } = await importRail()
		const { client, subscriptionRetrieve } = stripeStub()
		const gateway = createStripeGateway(client)

		subscriptionRetrieve.mockResolvedValueOnce(makeSubscription({ status: "trialing" }) as any)
		expect(await gateway.getSubscriptionState("sub_test_1")).toEqual({
			subscriptionRef: "sub_test_1",
			status: "active",
			cancelAtPeriodEnd: false,
			currentPeriodEnd: PERIOD_END_ISO,
		})

		subscriptionRetrieve.mockResolvedValueOnce(makeSubscription({ status: "unpaid", cancel_at_period_end: true }) as any)
		expect(await gateway.getSubscriptionState("sub_test_1")).toEqual({
			subscriptionRef: "sub_test_1",
			status: "past_due",
			cancelAtPeriodEnd: true,
			currentPeriodEnd: PERIOD_END_ISO,
		})

		subscriptionRetrieve.mockResolvedValueOnce(makeSubscription({ status: "incomplete_expired" }) as any)
		expect((await gateway.getSubscriptionState("sub_test_1")).status).toBe("canceled")

		subscriptionRetrieve.mockResolvedValueOnce(makeSubscription({ status: "paused" }) as any)
		expect((await gateway.getSubscriptionState("sub_test_1")).status).toBe("incomplete")
	})

	it("translates a missing provider subscription into SubscriptionNotFoundError", async () => {
		const { createStripeGateway } = await importRail()
		const { SubscriptionNotFoundError } = await import("@/lib/billing/gateway")
		const { client, subscriptionRetrieve } = stripeStub()
		const gateway = createStripeGateway(client)

		subscriptionRetrieve.mockRejectedValueOnce(
			Object.assign(new Error("No such subscription: 'sub_missing'"), { code: "resource_missing" }),
		)

		await expect(gateway.getSubscriptionState("sub_missing")).rejects.toBeInstanceOf(SubscriptionNotFoundError)
	})

	it("returns a null period end when the provider omits one", async () => {
		const { createStripeGateway } = await importRail()
		const { client, subscriptionRetrieve } = stripeStub()
		const gateway = createStripeGateway(client)

		subscriptionRetrieve.mockResolvedValueOnce(makeSubscription({ items: { data: [] } }) as any)
		expect((await gateway.getSubscriptionState("sub_test_1")).currentPeriodEnd).toBeNull()
	})
})

describe("Stripe rail registration", () => {
	it("self-registers with the shared gateway factory and pins the API version", async () => {
		const { STRIPE_API_VERSION } = await importRail()
		const { gatewayForRail, gatewayForCurrency } = await import("@/lib/billing/gateway-factory")

		expect(STRIPE_API_VERSION).toBe("2026-09-30.endive")
		expect(gatewayForRail("stripe").rail).toBe("stripe")
		expect(gatewayForCurrency("USD").rail).toBe("stripe")
	})
})
