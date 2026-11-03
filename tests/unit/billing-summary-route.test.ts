import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/billing/workspace-billing', () => ({
	getRequestUserId: vi.fn(),
	createBillingAdminClient: vi.fn(() => ({})),
	resolveOwnerBilling: vi.fn(),
	billingContextErrorResponse: vi.fn(() => new Response('context error', { status: 500 })),
}))

vi.mock('@/services/billing/referral-credits', async () => {
	const actual = await vi.importActual<typeof import('@/services/billing/referral-credits')>(
		'@/services/billing/referral-credits',
	)
	return { ...actual, getReferralSummary: vi.fn() }
})

import { GET } from '@/app/api/billing/summary/route'
import { getReferralSummary, ReferralLedgerError } from '@/services/billing/referral-credits'
import { getRequestUserId, resolveOwnerBilling } from '@/lib/billing/workspace-billing'

const plan = {
	workspace_id: 'ws-1',
	tier: 'pro',
	gateway: 'stripe' as const,
	gateway_customer_id: 'cus-1',
	gateway_subscription_id: 'sub-1',
	currency: 'USD' as const,
	is_founding: true,
}

const summary = {
	workspaceId: 'ws-1',
	creditedMonths: 2,
	bankedMonths: 2,
	appliedMonths: 0,
	lifetimeGrantedMonths: 2,
	activationGrants: 2,
	conversionGrants: 0,
	bankCapMonths: 12,
	capReached: false,
	rows: [],
}

function request() {
	return new NextRequest('http://localhost/api/billing/summary', {
		headers: { Authorization: 'Bearer token' },
	})
}

describe('GET /api/billing/summary (T12)', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getRequestUserId).mockResolvedValue('user-1')
		vi.mocked(resolveOwnerBilling).mockResolvedValue({ workspaceId: 'ws-1', plan })
		vi.mocked(getReferralSummary).mockResolvedValue(summary)
	})

	it('rejects an unauthenticated caller', async () => {
		vi.mocked(getRequestUserId).mockResolvedValue(null)
		expect((await GET(request())).status).toBe(401)
	})

	it('returns the owner entitlement plus the referral ledger summary', async () => {
		const res = await GET(request())
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.entitlement.tier).toBe('pro')
		expect(data.entitlement.isFounding).toBe(true)
		expect(data.referral.bankedMonths).toBe(2)
	})

	it('keeps the entitlement when the referral summary fails (decorative card)', async () => {
		vi.mocked(getReferralSummary).mockRejectedValue(new ReferralLedgerError('referral_credit_ledger', 'read_failed', 'boom'))
		const res = await GET(request())
		expect(res.status).toBe(200)
		const data = await res.json()
		expect(data.entitlement.tier).toBe('pro')
		expect(data.referral).toBeNull()
	})
})
