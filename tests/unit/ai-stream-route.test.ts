import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../../app/api/ai/stream/route'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

describe('POST /api/ai/stream', () => {
	beforeEach(() => {
		mockFetch.mockReset()
	})

	it('should route request to OpenAI with standard /chat/completions', async () => {
		mockFetch.mockResolvedValueOnce(new Response(new ReadableStream(), { status: 200 }))
		
		const req = new Request('http://localhost/api/ai/stream', {
			method: 'POST',
			body: JSON.stringify({
				provider: 'openai',
				model: 'gpt-4o',
				apiKey: 'test-key',
				messages: [{ role: 'user', content: 'hello' }]
			})
		})

		const res = await POST(req)
		
		expect(mockFetch).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', expect.objectContaining({
			method: 'POST',
			headers: expect.objectContaining({
				'Authorization': 'Bearer test-key',
				'Content-Type': 'application/json'
			}),
			body: expect.stringContaining('"stream":true')
		}))
		expect(res.status).toBe(200)
	})

	it('should route request to Anthropic with custom headers and endpoint', async () => {
		mockFetch.mockResolvedValueOnce(new Response(new ReadableStream(), { status: 200 }))
		
		const req = new Request('http://localhost/api/ai/stream', {
			method: 'POST',
			body: JSON.stringify({
				provider: 'anthropic',
				model: 'claude-3-5-sonnet',
				apiKey: 'test-key',
				messages: [{ role: 'user', content: 'hello' }]
			})
		})

		const res = await POST(req)
		
		expect(mockFetch).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({
			method: 'POST',
			headers: expect.objectContaining({
				'x-api-key': 'test-key',
				'anthropic-version': '2023-06-01',
				'Content-Type': 'application/json'
			}),
			body: expect.stringContaining('"stream":true')
		}))
		expect(res.status).toBe(200)
	})

	it('should route request to Gemini with SSE format', async () => {
		mockFetch.mockResolvedValueOnce(new Response(new ReadableStream(), { status: 200 }))
		
		const req = new Request('http://localhost/api/ai/stream', {
			method: 'POST',
			body: JSON.stringify({
				provider: 'gemini',
				model: 'gemini-1.5-pro',
				apiKey: 'test-key',
				messages: [{ role: 'user', content: 'hello' }]
			})
		})

		const res = await POST(req)
		
		expect(mockFetch).toHaveBeenCalledWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:streamGenerateContent?alt=sse', expect.objectContaining({
			method: 'POST',
			headers: expect.objectContaining({
				'Content-Type': 'application/json',
				'x-goog-api-key': 'test-key'
			})
		}))
		expect(res.status).toBe(200)
	})

	it('should return error on 429', async () => {
		mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Rate limit' }), { status: 429 }))
		
		const req = new Request('http://localhost/api/ai/stream', {
			method: 'POST',
			body: JSON.stringify({
				provider: 'openai',
				model: 'gpt-4o',
				apiKey: 'test-key',
				messages: [{ role: 'user', content: 'hello' }]
			})
		})

		const res = await POST(req)
		
		expect(res.status).toBe(429)
	})
})
