import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/billing/workspace-billing', () => ({
	getRequestUserId: vi.fn(),
	createBillingAdminClient: vi.fn(() => ({})),
	resolveOwnerBilling: vi.fn(),
	billingContextErrorResponse: vi.fn(() => new Response('context error', { status: 500 })),
}))

vi.mock('@/lib/billing/gateway-factory', () => ({
	gatewayForRail: vi.fn(),
}))

import { POST } from '@/app/api/billing/plan-change/route'
import { gatewayForRail } from '@/lib/billing/gateway-factory'
import { getRequestUserId, resolveOwnerBilling } from '@/lib/billing/workspace-billing'

const razorpayPlan = {
	workspace_id: 'ws-1',
	tier: 'plus',
	gateway: 'razorpay' as const,
	gateway_customer_id: 'cust-1',
	gateway_subscription_id: 'sub-1',
	currency: 'INR' as const,
	is_founding: true,
}

function request(body: unknown) {
	return new NextRequest('http://localhost/api/billing/plan-change', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
		body: JSON.stringify(body),
	})
}

describe('POST /api/billing/plan-change (T12 / PDEC-12)', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getRequestUserId).mockResolvedValue('user-1')
		vi.mocked(resolveOwnerBilling).mockResolvedValue({ workspaceId: 'ws-1', plan: razorpayPlan })
	})

	it('rejects an unauthenticated caller', async () => {
		vi.mocked(getRequestUserId).mockResolvedValue(null)
		const res = await POST(request({ tier: 'pro', cycle: 'annual' }))
		expect(res.status).toBe(401)
	})

	it('rejects an invalid tier/cycle body', async () => {
		const res = await POST(request({ tier: 'go', cycle: 'yearly' }))
		expect(res.status).toBe(400)
	})

	it('refuses when the workspace has no subscription', async () => {
		vi.mocked(resolveOwnerBilling).mockResolvedValue({ workspaceId: 'ws-1', plan: null })
		const res = await POST(request({ tier: 'pro', cycle: 'annual' }))
		expect(res.status).toBe(400)
		expect((await res.json()).code).toBe('no_subscription')
	})

	it('routes Stripe plan changes to the Billing Portal', async () => {
		vi.mocked(resolveOwnerBilling).mockResolvedValue({
			workspaceId: 'ws-1',
			plan: { ...razorpayPlan, gateway: 'stripe', currency: 'USD', gateway_customer_id: 'cus-1' },
		})
		const res = await POST(request({ tier: 'pro', cycle: 'annual' }))
		expect(res.status).toBe(409)
		expect((await res.json()).code).toBe('portal_required')
		expect(gatewayForRail).not.toHaveBeenCalled()
	})

	it('schedules a Razorpay change on the existing subscription', async () => {
		const schedulePlanChange = vi.fn().mockResolvedValue({
			subscriptionRef: 'sub-1',
			tier: 'pro',
			cycle: 'annual',
			effectiveAt: '2026-12-01T00:00:00.000Z',
			scheduledChangeRef: 'sub-1:pro:annual',
		})
		vi.mocked(gatewayForRail).mockReturnValue({ schedulePlanChange } as any)

		const res = await POST(request({ tier: 'pro', cycle: 'annual' }))
		expect(res.status).toBe(200)
		expect(schedulePlanChange).toHaveBeenCalledWith({
			subscriptionRef: 'sub-1',
			tier: 'pro',
			cycle: 'annual',
			seats: undefined,
		})
		expect((await res.json()).effectiveAt).toBe('2026-12-01T00:00:00.000Z')
	})
})
