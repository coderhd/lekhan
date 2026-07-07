import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../../app/api/ai/route'

// Mock the global fetch
global.fetch = vi.fn()

// Mock Supabase client
vi.mock('@supabase/supabase-js', () => ({
	createClient: vi.fn(() => ({
		auth: {
			getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user', email: 'test@example.com' } }, error: null }),
		},
	})),
}))

describe('API Route: /api/ai', () => {
	it('should fail if no authorization header is provided', async () => {
		const req = new NextRequest('http://localhost:3000/api/ai', {
			method: 'POST',
			body: JSON.stringify({ action: 'chat', prompt: 'test' }),
		})
		
		const response = await POST(req)
		expect(response.status).toBe(401)
		
		const data = await response.json()
		expect(data.error).toBe('Missing authorization header')
	})

	it('should return translation if action is translate', async () => {
		const mockTranslateResponse = { translated_text: 'नमस्ते' }
		;(global.fetch as any).mockResolvedValueOnce({
			ok: true,
			json: async () => mockTranslateResponse,
		})

		const req = new NextRequest('http://localhost:3000/api/ai', {
			method: 'POST',
			headers: {
				'Authorization': 'Bearer fake-token',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ action: 'translate', text: 'Hello', targetLanguage: 'hi-IN' }),
		})
		
		const response = await POST(req)
		expect(response.status).toBe(200)
		
		const data = await response.json()
		expect(data.translatedText).toBe('नमस्ते')
	})

	it('should return error if Sarvam API fails', async () => {
		;(global.fetch as any).mockResolvedValueOnce({
			ok: false,
			statusText: 'Bad Request',
			text: async () => 'Invalid payload',
		})

		const req = new NextRequest('http://localhost:3000/api/ai', {
			method: 'POST',
			headers: {
				'Authorization': 'Bearer fake-token',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ action: 'chat', prompt: 'Hello' }),
		})
		
		const response = await POST(req)
		expect(response.status).toBe(500)
		
		const data = await response.json()
		expect(data.error).toContain('Sarvam LLM Chat error')
	})
})
