import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Transport-level tests for /api/waitlist (#85): content negotiation
 * (JSON vs no-JS form fallback), validation mapping, and the response
 * contract. The service layer is stubbed — its behavior is covered in
 * waitlist.test.ts.
 */

const joinWaitlist = vi.fn()
const retryBrevoOutbox = vi.fn()

vi.mock('@/services/waitlist', async importOriginal => {
	const actual = await importOriginal<typeof import('@/services/waitlist')>()
	return {
		...actual,
		joinWaitlist: (...args: unknown[]) => joinWaitlist(...args),
		retryBrevoOutbox: (...args: unknown[]) => retryBrevoOutbox(...args),
	}
})

vi.mock('@/lib/supabase', () => ({
	supabase: {
		from: vi.fn().mockReturnThis(),
		insert: vi.fn().mockResolvedValue({ error: null }),
	},
}))

import { POST } from '@/app/api/waitlist/route'
import { FOUNDING_COHORT_CAP } from '@/services/waitlist'

function jsonRequest (body: unknown, ref?: string): Request {
	const url = new URL(ref ? `https://lekhan.app/api/waitlist?ref=${ref}` : 'https://lekhan.app/api/waitlist')
	return new Request(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	})
}

function formRequest (fields: Record<string, string>): Request {
	const body = new URLSearchParams(fields).toString()
	return new Request('https://lekhan.app/api/waitlist?ref=instagram', {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			accept: 'text/html',
		},
		body,
	})
}

describe('POST /api/waitlist', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		joinWaitlist.mockResolvedValue({ position: 37, alreadyJoined: false, foundingFull: false })
	})

	it('returns the position contract as JSON', async () => {
		const response = await POST(jsonRequest({ email: 'a@example.com' }) as never)
		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({
			position: 37,
			alreadyJoined: false,
			foundingFull: false,
			cap: FOUNDING_COHORT_CAP,
		})
	})

	it('maps service validation errors to 400 with a field error', async () => {
		joinWaitlist.mockRejectedValue(new Error('Invalid email address'))
		const response = await POST(jsonRequest({ email: 'garbage' }) as never)
		expect(response.status).toBe(400)
		await expect(response.json()).resolves.toEqual({ error: 'Please enter a valid email address.' })
	})

	it('parses no-JS form posts and redirects back to the page with the spot number', async () => {
		const response = await POST(
			formRequest({ email: 'form@example.com', use_case: 'personal wiki' }) as never,
		)
		expect(response.status).toBe(303)
		expect(response.headers.get('location')).toContain('/early?joined=37')
		expect(joinWaitlist).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ email: 'form@example.com', utmSource: 'instagram' }),
		)
	})

	it('rate-limits bursts from one ip with 429', async () => {
		const request = jsonRequest({ email: 'burst@example.com' }) as never
		for (let i = 0; i < 10; i++) await POST(request)
		const response = await POST(request)
		expect(response.status).toBe(429)
	})
})
