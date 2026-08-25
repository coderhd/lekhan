import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Transport-level tests for /api/waitlist (#85): content negotiation
 * (JSON vs no-JS form fallback), validation mapping, and the response
 * contract. The service layer is stubbed — its behavior is covered in
 * waitlist.test.ts.
 */

const joinWaitlist = vi.fn()
const retryBrevoOutbox = vi.fn()
const confirmByToken = vi.fn()

vi.mock('@/services/waitlist', async importOriginal => {
	const actual = await importOriginal<typeof import('@/services/waitlist')>()
	return {
		...actual,
		joinWaitlist: (...args: unknown[]) => joinWaitlist(...args),
		retryBrevoOutbox: (...args: unknown[]) => retryBrevoOutbox(...args),
		confirmByToken: (...args: unknown[]) => confirmByToken(...args),
	}
})

vi.mock('@/lib/supabase', () => ({
	supabase: {
		from: vi.fn().mockReturnThis(),
		insert: vi.fn().mockResolvedValue({ error: null }),
	},
}))

import { POST } from '@/app/api/waitlist/route'
import { GET as CONFIRM_GET } from '@/app/api/waitlist/confirm/route'
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
			expect.objectContaining({ email: 'form@example.com', ref: 'instagram', utmSource: undefined }),
		)
	})

	it('keeps referral and utm attribution separate from the query string', async () => {
		const url = 'https://lekhan.app/api/waitlist?ref=linkedin&utm_source=campaign-x'
		const response = await POST(
			new Request(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email: 'attr@example.com' }),
			}) as never,
		)
		expect(response.status).toBe(200)
		expect(joinWaitlist).toHaveBeenCalledWith(expect.anything(), {
			email: 'attr@example.com',
			ref: 'linkedin',
			utmSource: 'campaign-x',
			useCase: undefined,
		})
	})

	it('lets body values override query attribution defaults', async () => {
		const response = await POST(
			new Request('https://lekhan.app/api/waitlist?ref=linkedin', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email: 'override@example.com', ref: 'instagram', utm_source: 'bio' }),
			}) as never,
		)
		expect(response.status).toBe(200)
		expect(joinWaitlist).toHaveBeenCalledWith(expect.anything(), {
			email: 'override@example.com',
			ref: 'instagram',
			utmSource: 'bio',
			useCase: undefined,
		})
	})

	it('parses separate ref and utm fields from no-JS form posts', async () => {
		const response = await POST(
			formRequest({ email: 'formattr@example.com', ref: 'x', utm_source: 'thread' }) as never,
		)
		expect(response.status).toBe(303)
		expect(joinWaitlist).toHaveBeenCalledWith(expect.anything(), {
			email: 'formattr@example.com',
			ref: 'x',
			utmSource: 'thread',
			useCase: undefined,
		})
	})

	it('rate-limits bursts from one ip with 429', async () => {
		const request = jsonRequest({ email: 'burst@example.com' }) as never
		for (let i = 0; i < 10; i++) await POST(request)
		const response = await POST(request)
		expect(response.status).toBe(429)
	})
})

describe('GET /api/waitlist/confirm', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('renders a confirmation page with the spot number on success', async () => {
		confirmByToken.mockResolvedValue({ position: 37, email: 'a@example.com', alreadyConfirmed: false })
		const request = new Request('https://lekhan.app/api/waitlist/confirm?token=tok-1') as never
		const response = await CONFIRM_GET(request)
		expect(response.status).toBe(200)
		const html = await response.text()
		expect(html).toContain('№ 37 of 500')
		expect(html).toContain('a@example.com')
		expect(confirmByToken).toHaveBeenCalledWith(expect.anything(), 'tok-1')
	})

	it('renders a friendly already-confirmed page without leaking anything', async () => {
		confirmByToken.mockResolvedValue({ alreadyConfirmed: true })
		const request = new Request('https://lekhan.app/api/waitlist/confirm?token=tok-used') as never
		const response = await CONFIRM_GET(request)
		expect(response.status).toBe(200)
		expect(await response.text()).toContain('Already confirmed')
	})
})
