import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/ai/route'

vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({
		auth: {
			getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1', email: 'test@example.com' } }, error: null }),
		},
	})),
}))

describe('API Route: /api/ai key validation', () => {
	it('validates a Sarvam API key successfully when key starts with sk_', async () => {
		const req = new NextRequest('http://localhost/api/ai', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer mock-token',
			},
			body: JSON.stringify({ action: 'validate-key', key: 'sk_test_valid_key' }),
		})

		const res = await POST(req)
		const data = await res.json()
		expect(res.status).toBe(200)
		expect(data.valid).toBe(true)
	})

	it('returns 400 for key missing sk_ prefix', async () => {
		const req = new NextRequest('http://localhost/api/ai', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer mock-token',
			},
			body: JSON.stringify({ action: 'validate-key', key: 'invalid_prefix' }),
		})

		const res = await POST(req)
		const data = await res.json()
		expect(res.status).toBe(400)
		expect(data.valid).toBe(false)
	})
})
