import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AIClient } from '../../lib/ai/client'

const mockFetch = vi.fn()
globalThis.fetch = mockFetch

function createMockStream(chunks: string[] = ['data: {"text":"hello"}\n\n']) {
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(new TextEncoder().encode(chunk))
			}
			controller.close()
		}
	})
}

describe('AIClient.streamChat', () => {
	beforeEach(() => {
		mockFetch.mockReset()
	})

	it('should directly fetch for local providers', async () => {
		mockFetch.mockResolvedValueOnce(new Response(createMockStream(), { status: 200 }))
		
		const client = new AIClient()
		const onChunk = vi.fn()
		const onDone = vi.fn()
		const onError = vi.fn()
		const onFallback = vi.fn()

		await client.streamChat({
			prompt: 'hello',
			systemPrompt: 'sys',
			providerConfig: { id: 'p1', provider: 'ollama', name: 'Local', enabled: true, defaultModel: 'llama3', availableModels: ['llama3'], createdAt: '', updatedAt: '', baseUrl: 'http://localhost:11434' },
			fallbackConfigs: [],
			onChunk,
			onDone,
			onError,
			onFallback
		})
		
		expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/chat', expect.any(Object))
	})

	it('should fallback on 429 for cloud providers', async () => {
		// First call returns 429
		mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Rate limit' }), { status: 429 }))
		// Second call returns 200
		mockFetch.mockResolvedValueOnce(new Response(createMockStream(), { status: 200 }))
		
		const client = new AIClient()
		const onChunk = vi.fn()
		const onDone = vi.fn()
		const onError = vi.fn()
		const onFallback = vi.fn()

		await client.streamChat({
			prompt: 'hello',
			systemPrompt: 'sys',
			providerConfig: { id: 'p1', provider: 'openai', name: 'OpenAI', enabled: true, defaultModel: 'gpt-4o', availableModels: ['gpt-4o'], createdAt: '', updatedAt: '', apiKey: 'key1' },
			fallbackConfigs: [
				{ id: 'p2', provider: 'anthropic', name: 'Anthropic', enabled: true, defaultModel: 'claude', availableModels: ['claude'], createdAt: '', updatedAt: '', apiKey: 'key2' }
			],
			onChunk,
			onDone,
			onError,
			onFallback
		})
		
		expect(mockFetch).toHaveBeenCalledTimes(2)
		expect(onFallback).toHaveBeenCalledWith(
			expect.objectContaining({ provider: 'anthropic' }),
			expect.any(String)
		)
	})
})
