import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * T5 — gateway contract, fake rail, currency-agnostic route wrappers.
 *
 * Pins (plan T5 / spec §5 as amended by PDEC-12/11/8b):
 *  - routing matrix USD→stripe, INR→razorpay, Team+INR → explicit-USD rejection
 *  - fake adapter contract surface (checkout URL `#fake-checkout`, read-back getters)
 *  - route-level single-live-subscription invariant (reject live non-detaching,
 *    permit verified-detaching) + cancel/portal rail routing
 */

const h = vi.hoisted(() => {
	const state = {
		user: { id: 'user-1' } as { id: string } | null,
		workspace: null as Record<string, unknown> | null,
		plan: null as Record<string, unknown> | null,
	}
	const client = {
		auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
		from: (table: string) => {
			const result = () => ({
				data: table === 'workspaces' ? state.workspace : state.plan,
				error: null,
			})
			const chain: Record<string, unknown> = {}
			chain.select = () => chain
			chain.eq = () => chain
			chain.order = () => chain
			chain.maybeSingle = async () => result()
			chain.single = async () => result()
			return chain
		},
	}
	return { state, client }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.client }))

import {
	assertSellableCheckout,
	TierUnavailableError,
	railForCurrency,
	classifySubscription,
	withStoredCancelFlag,
	type GatewaySubscriptionState,
	type PaymentGateway,
	type Rail,
} from '@/lib/billing/gateway'
import {
	gatewayForCurrency,
	gatewayForRail,
	registerGateway,
} from '@/lib/billing/gateway-factory'
import { getFakeBillingStore, getFakeGateway } from '@/lib/billing/gateway-fake'
import { POST as checkoutPOST } from '@/app/api/billing/checkout/route'
import { POST as portalPOST } from '@/app/api/billing/portal/route'
import { POST as cancelPOST } from '@/app/api/billing/cancel/route'

const ORIGINAL_FAKE = process.env.LEKHAN_FAKE_PAYMENTS

function stubGateway(rail: 'stripe' | 'razorpay'): PaymentGateway {
	return {
		rail,
		createCheckout: vi.fn(async () => ({ checkoutUrl: `${rail}-checkout`, opaqueRef: `${rail}-ref` })),
		portalUrl: vi.fn(async () => ({ url: `${rail}-portal`, kind: 'billing_portal' as const })),
		schedulePlanChange: vi.fn(async () => ({
			subscriptionRef: `${rail}-sub`,
			tier: 'pro' as const,
			cycle: 'monthly' as const,
			effectiveAt: '2026-02-01T00:00:00.000Z',
			scheduledChangeRef: `${rail}-change`,
		})),
		cancelAtPeriodEnd: vi.fn(async () => undefined),
		getSubscriptionState: vi.fn(async (): Promise<GatewaySubscriptionState> => ({
			subscriptionRef: `${rail}-sub`,
			status: 'active',
			cancelAtPeriodEnd: false,
			currentPeriodEnd: '2026-02-01T00:00:00.000Z',
		})),
	}
}

function request(url: string, body?: unknown, token = 'tok'): NextRequest {
	return new NextRequest(`http://localhost:3000${url}`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${token}`,
			'content-type': 'application/json',
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	})
}

beforeEach(() => {
	delete process.env.LEKHAN_FAKE_PAYMENTS
	getFakeBillingStore().reset()
	h.state.user = { id: 'user-1' }
	h.state.workspace = { id: 'ws-1', owner_id: 'user-1' }
	h.state.plan = null
})

afterEach(() => {
	if (ORIGINAL_FAKE === undefined) delete process.env.LEKHAN_FAKE_PAYMENTS
	else process.env.LEKHAN_FAKE_PAYMENTS = ORIGINAL_FAKE
})

describe('gateway routing matrix', () => {
	it('rejects an unregistered rail instead of silently falling back', () => {
		// Rails self-register at first use (T6 Stripe, T7 Razorpay). An unknown rail has
		// no loader, so the factory still fails closed rather than falling back to another.
		expect(() => gatewayForRail('unknown' as Rail)).toThrow(/no gateway registered/i)
	})

	it('routes USD to stripe and INR to razorpay via the registry', () => {
		const stripe = stubGateway('stripe')
		const razorpay = stubGateway('razorpay')
		registerGateway('stripe', stripe)
		registerGateway('razorpay', razorpay)

		expect(gatewayForCurrency('USD')).toBe(stripe)
		expect(gatewayForCurrency('INR')).toBe(razorpay)
		expect(gatewayForRail('stripe')).toBe(stripe)
		expect(gatewayForRail('razorpay')).toBe(razorpay)
		expect(railForCurrency('USD')).toBe('stripe')
		expect(railForCurrency('INR')).toBe('razorpay')
	})

	it('rejects Team in INR with an explicit USD signal', () => {
		let caught: unknown
		try {
			assertSellableCheckout({ tier: 'team', currency: 'INR' })
		} catch (err) {
			caught = err
		}
		expect(caught).toBeInstanceOf(TierUnavailableError)
		expect((caught as Error).message).toMatch(/USD/)
	})

	it('allows Team in USD and any non-Team tier', () => {
		expect(() => assertSellableCheckout({ tier: 'team', currency: 'USD' })).not.toThrow()
		expect(() => assertSellableCheckout({ tier: 'plus', currency: 'INR' })).not.toThrow()
		expect(() => assertSellableCheckout({ tier: 'pro', currency: 'INR' })).not.toThrow()
	})

	it('selects the fake rail for every currency when LEKHAN_FAKE_PAYMENTS=1', async () => {
		process.env.LEKHAN_FAKE_PAYMENTS = '1'
		const usd = gatewayForCurrency('USD')
		const inr = gatewayForCurrency('INR')
		expect(usd.rail).toBe('stripe')
		expect(inr.rail).toBe('razorpay')

		const session = await usd.createCheckout({
			workspaceId: 'ws-1',
			tier: 'pro',
			cycle: 'monthly',
			currency: 'USD',
			isFounding: false,
		})
		expect(session.checkoutUrl).toBe('#fake-checkout')
	})
})

describe('PDEC-11 transfer-window overlay (SIL-56 ruling)', () => {
	const state = (cancelAtPeriodEnd: boolean): GatewaySubscriptionState => ({
		subscriptionRef: 'sub-1',
		status: 'active',
		cancelAtPeriodEnd,
		currentPeriodEnd: '2026-02-01T00:00:00.000Z',
	})

	it('softens live to detaching for INR when the stored cancel flag is set', () => {
		// Razorpay never echoes cancel_at_cycle_end on GET: the stored column is the
		// provenanced accepted-cancel-action supplement, applied at classification time.
		expect(classifySubscription(withStoredCancelFlag(state(false), 'razorpay', true))).toBe('detaching')
	})

	it('is inert on the stripe rail: a stale stored mirror cannot open a double-charge window', () => {
		// Stripe read-back already carries the provider flag. If the stored mirror says
		// true while the live subscription says false (e.g. portal-side resume, webhook
		// not yet applied), provider state wins — the overlay must not soften `live`.
		expect(withStoredCancelFlag(state(false), 'stripe', true).cancelAtPeriodEnd).toBe(false)
		expect(classifySubscription(withStoredCancelFlag(state(false), 'stripe', true))).toBe('live')
	})

	it('never rewrites provider read-back: stored false/null cannot unset a read-back true', () => {
		expect(withStoredCancelFlag(state(true), 'razorpay', false).cancelAtPeriodEnd).toBe(true)
		expect(withStoredCancelFlag(state(true), 'razorpay', null).cancelAtPeriodEnd).toBe(true)
		expect(withStoredCancelFlag(state(true), 'razorpay', undefined).cancelAtPeriodEnd).toBe(true)
	})

	it('cannot make a terminal (non-live) subscription appear billable', () => {
		const canceled: GatewaySubscriptionState = {
			subscriptionRef: 'sub-1',
			status: 'canceled',
			cancelAtPeriodEnd: false,
			currentPeriodEnd: null,
		}
		expect(classifySubscription(withStoredCancelFlag(canceled, 'razorpay', true))).toBe('inactive')
	})
})

describe('fake adapter contract surface', () => {
	it('creates a deterministic active subscription with a read-back getter', async () => {
		const fake = getFakeGateway('stripe')
		const session = await fake.createCheckout({
			workspaceId: 'ws-1',
			tier: 'pro',
			cycle: 'monthly',
			currency: 'USD',
			isFounding: true,
		})
		expect(session.checkoutUrl).toBe('#fake-checkout')
		expect(session.opaqueRef).toMatch(/^fake_sub_/)

		const state = await fake.getSubscriptionState(session.opaqueRef)
		expect(state.status).toBe('active')
		expect(state.cancelAtPeriodEnd).toBe(false)
		expect(classifySubscription(state)).toBe('live')

		const record = getFakeBillingStore().get(session.opaqueRef)
		expect(record?.isFounding).toBe(true)
		expect(record?.currency).toBe('USD')
	})

	it('marks a subscription detaching on cancelAtPeriodEnd', async () => {
		const fake = getFakeGateway('razorpay')
		const session = await fake.createCheckout({
			workspaceId: 'ws-1',
			tier: 'plus',
			cycle: 'annual',
			currency: 'INR',
			isFounding: false,
		})
		await fake.cancelAtPeriodEnd(session.opaqueRef)
		const state = await fake.getSubscriptionState(session.opaqueRef)
		expect(state.cancelAtPeriodEnd).toBe(true)
		expect(classifySubscription(state)).toBe('detaching')
	})

	it('schedules a plan change at cycle end and returns the hosted portal kind per rail', async () => {
		const stripe = getFakeGateway('stripe')
		const razorpay = getFakeGateway('razorpay')
		const session = await stripe.createCheckout({
			workspaceId: 'ws-1',
			tier: 'plus',
			cycle: 'monthly',
			currency: 'USD',
			isFounding: false,
		})
		const change = await stripe.schedulePlanChange({
			subscriptionRef: session.opaqueRef,
			tier: 'pro',
			cycle: 'annual',
		})
		expect(change.tier).toBe('pro')
		expect(change.effectiveAt).toBeTruthy()
		expect((await stripe.portalUrl('cus')).kind).toBe('billing_portal')
		expect((await razorpay.portalUrl('cus')).kind).toBe('card_update')
	})

	it('classifies terminal states as inactive', () => {
		expect(classifySubscription({ subscriptionRef: 's', status: 'canceled', cancelAtPeriodEnd: false, currentPeriodEnd: null })).toBe('inactive')
		expect(classifySubscription({ subscriptionRef: 's', status: 'incomplete', cancelAtPeriodEnd: false, currentPeriodEnd: null })).toBe('inactive')
		expect(classifySubscription({ subscriptionRef: 's', status: 'past_due', cancelAtPeriodEnd: false, currentPeriodEnd: 'x' })).toBe('live')
	})
})

describe('/api/billing/checkout — single-live-subscription invariant', () => {
	beforeEach(() => {
		process.env.LEKHAN_FAKE_PAYMENTS = '1'
	})

	it('rejects a second checkout against a live, non-detaching subscription', async () => {
		h.state.plan = {
			workspace_id: 'ws-1',
			gateway: 'stripe',
			gateway_subscription_id: 'sub-existing',
			gateway_customer_id: 'cus-existing',
			currency: 'USD',
			is_founding: false,
			tier: 'pro',
		}
		getFakeBillingStore().seed({
			subscriptionRef: 'sub-existing',
			workspaceId: 'ws-1',
			rail: 'stripe',
			status: 'active',
			cancelAtPeriodEnd: false,
			currentPeriodEnd: '2026-02-01T00:00:00.000Z',
			tier: 'pro',
			cycle: 'monthly',
			currency: 'USD',
			isFounding: false,
		})

		const res = await checkoutPOST(request('/api/billing/checkout', { tier: 'pro', cycle: 'monthly', currency: 'USD' }))
		expect(res.status).toBe(409)
		const body = await res.json()
		expect(body.code).toBe('subscription_exists')
	})

	it('permits a checkout against a verified-detaching predecessor', async () => {
		h.state.plan = {
			workspace_id: 'ws-1',
			gateway: 'stripe',
			gateway_subscription_id: 'sub-detaching',
			gateway_customer_id: 'cus-existing',
			currency: 'USD',
			is_founding: false,
			tier: 'pro',
		}
		getFakeBillingStore().seed({
			subscriptionRef: 'sub-detaching',
			workspaceId: 'ws-1',
			rail: 'stripe',
			status: 'active',
			cancelAtPeriodEnd: true,
			currentPeriodEnd: '2026-02-01T00:00:00.000Z',
			tier: 'pro',
			cycle: 'monthly',
			currency: 'USD',
			isFounding: false,
		})

		const res = await checkoutPOST(request('/api/billing/checkout', { tier: 'pro', cycle: 'monthly', currency: 'USD' }))
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.checkoutUrl).toBe('#fake-checkout')
	})

	it('permits a checkout when the stored cancel flag marks the INR predecessor detaching (PDEC-11 / SIL-56)', async () => {
		// Razorpay's GET never echoes cancel_at_cycle_end, so the rail honestly reads
		// back live; the stored ACCEPTED-CANCEL-ACTION flag is the provenanced
		// supplement that opens the transfer window.
		h.state.plan = {
			workspace_id: 'ws-1',
			gateway: 'razorpay',
			gateway_subscription_id: 'sub-inr-window',
			gateway_customer_id: 'cus-inr',
			currency: 'INR',
			is_founding: false,
			tier: 'plus',
			cancel_at_period_end: true,
		}
		getFakeBillingStore().seed({
			subscriptionRef: 'sub-inr-window',
			workspaceId: 'ws-1',
			rail: 'razorpay',
			status: 'active',
			cancelAtPeriodEnd: false,
			currentPeriodEnd: '2026-02-01T00:00:00.000Z',
			tier: 'plus',
			cycle: 'monthly',
			currency: 'INR',
			isFounding: false,
		})

		const res = await checkoutPOST(request('/api/billing/checkout', { tier: 'plus', cycle: 'monthly', currency: 'INR' }))
		expect(res.status).toBe(200)
		expect((await res.json()).checkoutUrl).toBe('#fake-checkout')
	})

	it('rejects checkout when a stale stripe stored flag contradicts a live read-back (SIL-56 review MEDIUM-1)', async () => {
		// Stripe's provider read-back carries cancel_at_period_end directly, so a
		// stored `true` that the live subscription says `false` is STALE (e.g. a
		// portal-side resume awaiting reconciliation). Provider state wins — the
		// overlay is inert on this rail and the single-live invariant holds.
		h.state.plan = {
			workspace_id: 'ws-1',
			gateway: 'stripe',
			gateway_subscription_id: 'sub-resumed',
			gateway_customer_id: 'cus-existing',
			currency: 'USD',
			is_founding: false,
			tier: 'pro',
			cancel_at_period_end: true,
		}
		getFakeBillingStore().seed({
			subscriptionRef: 'sub-resumed',
			workspaceId: 'ws-1',
			rail: 'stripe',
			status: 'active',
			cancelAtPeriodEnd: false,
			currentPeriodEnd: '2026-02-01T00:00:00.000Z',
			tier: 'pro',
			cycle: 'monthly',
			currency: 'USD',
			isFounding: false,
		})

		const res = await checkoutPOST(request('/api/billing/checkout', { tier: 'pro', cycle: 'monthly', currency: 'USD' }))
		expect(res.status).toBe(409)
		expect((await res.json()).code).toBe('subscription_exists')
	})

	it('resolves isFounding from server state, never from the request body', async () => {
		h.state.plan = { workspace_id: 'ws-1', gateway: 'none', is_founding: false, tier: 'free' }
		const res = await checkoutPOST(request('/api/billing/checkout', { tier: 'pro', cycle: 'monthly', currency: 'USD', isFounding: true }))
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(getFakeBillingStore().get(body.opaqueRef)?.isFounding).toBe(false)
	})

	it('rejects Team+INR at the route with the explicit-USD signal', async () => {
		h.state.plan = { workspace_id: 'ws-1', gateway: 'none', is_founding: false, tier: 'free' }
		const res = await checkoutPOST(request('/api/billing/checkout', { tier: 'team', cycle: 'monthly', currency: 'INR' }))
		expect(res.status).toBe(400)
		const body = await res.json()
		expect(body.code).toBe('tier_unavailable')
		expect(body.requiredCurrency).toBe('USD')
	})

	it('rejects when the caller resolves no workspace of their own', async () => {
		h.state.workspace = null
		const res = await checkoutPOST(request('/api/billing/checkout', { tier: 'pro', cycle: 'monthly', currency: 'USD' }))
		expect(res.status).toBe(404)
	})
})

describe('/api/billing/portal — rail routing', () => {
	beforeEach(() => {
		process.env.LEKHAN_FAKE_PAYMENTS = '1'
	})

	it('routes USD/stripe to the hosted billing portal', async () => {
		h.state.plan = { workspace_id: 'ws-1', gateway: 'stripe', gateway_customer_id: 'cus-1', currency: 'USD', tier: 'pro' }
		const res = await portalPOST(request('/api/billing/portal'))
		expect(res.status).toBe(200)
		expect((await res.json()).kind).toBe('billing_portal')
	})

	it('routes INR/razorpay to the hosted card-update link from the subscription ref', async () => {
		// SIL-56 escalation-1 ruling: the INR portal key is the stored SUBSCRIPTION
		// ref (rail resolves the hosted short_url from provider read-back), not the
		// customer id.
		h.state.plan = {
			workspace_id: 'ws-1', gateway: 'razorpay',
			gateway_customer_id: 'cus-1', gateway_subscription_id: 'sub-inr-1',
			currency: 'INR', tier: 'pro',
		}
		const res = await portalPOST(request('/api/billing/portal'))
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body.kind).toBe('card_update')
		expect(body.url).toBe('#fake-card-update')
	})

	it('fails closed when the rail-specific portal ref is missing (never a guessed link)', async () => {
		// Razorpay without a subscription ref: the customer id alone must not be
		// echoed as a card-update link (the BLOCKING-3 broken-redirect vector).
		h.state.plan = { workspace_id: 'ws-1', gateway: 'razorpay', gateway_customer_id: 'cus-1', currency: 'INR', tier: 'pro' }
		const res = await portalPOST(request('/api/billing/portal'))
		expect(res.status).toBe(400)
		expect((await res.json()).code).toBe('no_billing_account')

		// Stripe without a customer ref: the subscription id alone must not open a
		// Billing Portal session against the wrong object.
		h.state.plan = { workspace_id: 'ws-1', gateway: 'stripe', gateway_subscription_id: 'sub-1', currency: 'USD', tier: 'pro' }
		const res2 = await portalPOST(request('/api/billing/portal'))
		expect(res2.status).toBe(400)
	})

	it('rejects a portal request with no stored customer', async () => {
		h.state.plan = { workspace_id: 'ws-1', gateway: 'none', tier: 'free' }
		const res = await portalPOST(request('/api/billing/portal'))
		expect(res.status).toBe(400)
	})
})

describe('/api/billing/cancel — rail routing', () => {
	beforeEach(() => {
		process.env.LEKHAN_FAKE_PAYMENTS = '1'
	})

	it('cancels at period end on the stored rail', async () => {
		h.state.plan = { workspace_id: 'ws-1', gateway: 'stripe', gateway_subscription_id: 'sub-1', gateway_customer_id: 'cus-1', currency: 'USD', tier: 'pro' }
		getFakeBillingStore().seed({
			subscriptionRef: 'sub-1', workspaceId: 'ws-1', rail: 'stripe', status: 'active',
			cancelAtPeriodEnd: false, currentPeriodEnd: '2026-02-01T00:00:00.000Z',
			tier: 'pro', cycle: 'monthly', currency: 'USD', isFounding: false,
		})
		const res = await cancelPOST(request('/api/billing/cancel'))
		expect(res.status).toBe(200)
		expect(getFakeBillingStore().get('sub-1')?.cancelAtPeriodEnd).toBe(true)
	})

	it('rejects a cancel request with no stored subscription', async () => {
		h.state.plan = { workspace_id: 'ws-1', gateway: 'none', tier: 'free' }
		const res = await cancelPOST(request('/api/billing/cancel'))
		expect(res.status).toBe(400)
	})
})

describe('checkout request validation', () => {
	beforeEach(() => {
		process.env.LEKHAN_FAKE_PAYMENTS = '1'
	})

	it('rejects invalid tiers, cycles, and currencies', async () => {
		h.state.plan = { workspace_id: 'ws-1', gateway: 'none', tier: 'free' }
		for (const body of [
			{ tier: 'enterprise', cycle: 'monthly', currency: 'USD' },
			{ tier: 'pro', cycle: 'weekly', currency: 'USD' },
			{ tier: 'pro', cycle: 'monthly', currency: 'EUR' },
		]) {
			const res = await checkoutPOST(request('/api/billing/checkout', body))
			expect(res.status).toBe(400)
		}
	})

	it('requires authentication', async () => {
		h.state.user = null
		const res = await checkoutPOST(request('/api/billing/checkout', { tier: 'pro', cycle: 'monthly', currency: 'USD' }))
		expect(res.status).toBe(401)
	})
})
