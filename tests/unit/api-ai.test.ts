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

	it('should return transliterated text if action is transliterate', async () => {
		const mockTransliterateResponse = { transliterated_text: 'namaste' }
		;(global.fetch as any).mockResolvedValueOnce({
			ok: true,
			json: async () => mockTransliterateResponse,
		})

		const req = new NextRequest('http://localhost:3000/api/ai', {
			method: 'POST',
			headers: {
				'Authorization': 'Bearer fake-token',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				action: 'transliterate',
				text: 'नमस्ते',
				sourceLanguage: 'hi-IN',
				targetLanguage: 'en-IN',
			}),
		})

		const response = await POST(req)
		expect(response.status).toBe(200)

		const data = await response.json()
		expect(data.transliteratedText).toBe('namaste')
	})

	it('should return error if transliterate params are missing', async () => {
		const req = new NextRequest('http://localhost:3000/api/ai', {
			method: 'POST',
			headers: {
				'Authorization': 'Bearer fake-token',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ action: 'transliterate', text: 'नमस्ते' }),
		})

		const response = await POST(req)
		expect(response.status).toBe(400)
		const data = await response.json()
		expect(data.error).toContain('Missing')
	})

	it('should return detected language if action is detect-language', async () => {
		const mockDetectResponse = {
			language_code: 'hi-IN',
			script_code: 'Devanagari',
		}
		;(global.fetch as any).mockResolvedValueOnce({
			ok: true,
			json: async () => mockDetectResponse,
		})

		const req = new NextRequest('http://localhost:3000/api/ai', {
			method: 'POST',
			headers: {
				'Authorization': 'Bearer fake-token',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ action: 'detect-language', text: 'नमस्ते दुनिया' }),
		})

		const response = await POST(req)
		expect(response.status).toBe(200)
		const data = await response.json()
		expect(data.languageCode).toBe('hi-IN')
		expect(data.languageName).toBe('Hindi')
		expect(data.script).toBe('Devanagari')
	})

	it('should return error if detect-language text is missing', async () => {
		const req = new NextRequest('http://localhost:3000/api/ai', {
			method: 'POST',
			headers: {
				'Authorization': 'Bearer fake-token',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ action: 'detect-language' }),
		})

		const response = await POST(req)
		expect(response.status).toBe(400)
		const data = await response.json()
		expect(data.error).toContain('Missing text')
	})
})
