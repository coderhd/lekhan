import { describe, it, expect, vi, afterEach } from 'vitest'
import {
	providerRegistry,
	headersForProvider,
	resolveBaseUrl,
	resolveTestEndpoint,
	buildUpstreamRequest,
	resolveChatRequest,
	isValidCustomUrl,
	formatModelDescription,
	listModels,
	isModelCompatible,
	InMemoryVaultStorage,
	createProviderRegistry,
	DEFAULT_MODEL_CATALOG,
} from '../../lib/ai/provider-registry'
import { getDefaultAIRegistryState } from '../../lib/ai/catalog'

describe('provider-registry deep module', () => {
	describe('headersForProvider — single header seam', () => {
		it('maps anthropic to x-api-key', () => {
			expect(headersForProvider('anthropic', 'k')).toEqual({ 'x-api-key': 'k', 'anthropic-version': '2023-06-01' })
		})
		it('maps gemini to x-goog-api-key', () => {
			expect(headersForProvider('gemini', 'k')).toEqual({ 'x-goog-api-key': 'k' })
		})
		it('maps sarvam to api-subscription-key', () => {
			expect(headersForProvider('sarvam', 'k')).toEqual({ 'api-subscription-key': 'k' })
		})
		it('maps openai variants to Bearer', () => {
			for (const p of ['openai', 'groq', 'openrouter', 'deepseek', 'qwen', 'zai'] as const) {
				expect(headersForProvider(p, 'k')).toEqual({ Authorization: 'Bearer k' })
			}
		})
		it('returns empty when no key', () => {
			expect(headersForProvider('openai', '')).toEqual({})
		})
	})

	describe('resolveBaseUrl — single baseUrl seam', () => {
		it('resolves ollama local default', () => {
			expect(resolveBaseUrl('ollama')).toBe('http://localhost:11434')
			expect(resolveBaseUrl('ollama', 'http://localhost:11434')).toBe('http://localhost:11434')
		})
		it('resolves trusted cloud bases', () => {
			expect(resolveBaseUrl('openai')).toBe('https://api.openai.com/v1')
			expect(resolveBaseUrl('groq')).toBe('https://api.groq.com/openai/v1')
			expect(resolveBaseUrl('openrouter')).toBe('https://openrouter.ai/api/v1')
		})
		it('honors custom baseUrl', () => {
			expect(resolveBaseUrl('openai', 'https://my.proxy/v1')).toBe('https://my.proxy/v1')
		})
	})

	describe('resolveTestEndpoint — mirrors vault probing seam', () => {
		it('ollama → /api/version', () => {
			expect(resolveTestEndpoint('ollama')).toBe('http://localhost:11434/api/version')
			expect(resolveTestEndpoint('ollama', 'http://localhost:11434/')).toBe('http://localhost:11434/api/version')
		})
		it('anthropic/gemini/sarvam have dedicated /v1/models', () => {
			expect(resolveTestEndpoint('anthropic')).toBe('https://api.anthropic.com/v1/models')
			expect(resolveTestEndpoint('gemini')).toBe('https://generativelanguage.googleapis.com/v1beta/models')
			expect(resolveTestEndpoint('sarvam')).toBe('https://api.sarvam.ai/v1/models')
		})
		it('generic OpenAI-compatible uses /v1/models', () => {
			expect(resolveTestEndpoint('openai')).toBe('https://api.openai.com/v1/models')
			expect(resolveTestEndpoint('groq')).toBe('https://api.groq.com/openai/v1/models')
			expect(resolveTestEndpoint('qwen')).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/models')
		})
		it('custom base ending with /v1 maps correctly', () => {
			expect(resolveTestEndpoint('openai', 'https://my.proxy/v1')).toBe('https://my.proxy/v1/models')
			expect(resolveTestEndpoint('openai', 'https://my.proxy/v1/')).toBe('https://my.proxy/v1/models')
			expect(resolveTestEndpoint('openai', 'https://my.proxy')).toBe('https://my.proxy/v1/models')
		})
	})

	describe('isValidCustomUrl — shared seam', () => {
		it('allows https', () => {
			expect(isValidCustomUrl('https://my.proxy/v1')).toBe(true)
		})
		it('blocks loopback/metadata over https', () => {
			expect(isValidCustomUrl('https://localhost/v1')).toBe(false)
			expect(isValidCustomUrl('https://169.254.169.254/v1')).toBe(false)
			expect(isValidCustomUrl('https://10.0.0.1/v1')).toBe(false)
		})
		it('allows localhost over http', () => {
			expect(isValidCustomUrl('http://localhost:11434')).toBe(true)
			expect(isValidCustomUrl('http://127.0.0.1:1234')).toBe(true)
		})
		it('blocks http to remote', () => {
			expect(isValidCustomUrl('http://my.proxy/v1')).toBe(false)
		})
	})

	describe('buildUpstreamRequest — single upstream seam for /api/ai/stream', () => {
		it('openai → chat/completions with Bearer', () => {
			const r = buildUpstreamRequest({ provider: 'openai', model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], apiKey: 'k' })
			expect(r.upstreamUrl).toBe('https://api.openai.com/v1/chat/completions')
			expect(r.upstreamHeaders.Authorization).toBe('Bearer k')
		})
		it('anthropic uses /v1/messages with x-api-key', () => {
			const r = buildUpstreamRequest({ provider: 'anthropic', model: 'claude', messages: [{ role: 'user', content: 'hi' }], apiKey: 'k' })
			expect(r.upstreamUrl).toBe('https://api.anthropic.com/v1/messages')
			expect(r.upstreamHeaders['x-api-key']).toBe('k')
			expect(r.upstreamHeaders['anthropic-version']).toBe('2023-06-01')
		})
		it('gemini uses streamGenerateContent with x-goog-api-key and contents shape', () => {
			const r = buildUpstreamRequest({ provider: 'gemini', model: 'gemini-1.5', messages: [{ role: 'user', content: 'hi' }], apiKey: 'k' })
			expect(r.upstreamUrl).toContain(':streamGenerateContent')
			expect(r.upstreamHeaders['x-goog-api-key']).toBe('k')
			expect((r.upstreamBody as Record<string, unknown>).contents).toBeDefined()
		})
		it('sarvam uses api-subscription-key', () => {
			const r = buildUpstreamRequest({ provider: 'sarvam', model: 'm', messages: [], apiKey: 'k' })
			expect(r.upstreamHeaders['api-subscription-key']).toBe('k')
			expect(r.upstreamUrl).toBe('https://api.sarvam.ai/v1/chat/completions')
		})
		it('custom uses provided baseUrl', () => {
			const r = buildUpstreamRequest({ provider: 'custom', model: 'm', messages: [], apiKey: 'k', baseUrl: 'https://my.proxy/v1' })
			expect(r.upstreamUrl).toBe('https://my.proxy/v1/chat/completions')
		})
	})

	describe('resolveChatRequest — client seam', () => {
		it('local ollama resolves to direct /api/chat', () => {
			const r = resolveChatRequest({ provider: 'ollama', model: 'llama3', messages: [{ role: 'user', content: 'hi' }] })
			expect(r.isLocalDirect).toBe(true)
			expect(r.url).toContain('/api/chat')
		})
		it('cloud openai resolves to proxied /api/ai/stream', () => {
			const r = resolveChatRequest({ provider: 'openai', model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], apiKey: 'k' })
			expect(r.isLocalDirect).toBe(false)
			expect(r.url).toBe('/api/ai/stream')
			expect(r.headers['x-ai-api-key']).toBe('k')
		})
	})

	describe('catalog — derived descriptions, single filter seam', () => {
		it('derives description from numeric fields, not manual string', () => {
			const m = DEFAULT_MODEL_CATALOG[0]
			expect(formatModelDescription(m)).toContain(`${m.speedTokPerSec} tok/s`)
			expect(formatModelDescription(m)).toContain(m.costTier)
			expect(formatModelDescription(m)).toContain(m.category)
		})
		it('listModels filters via registry', () => {
			const free = listModels({ costTier: 'free' })
			expect(free.every(m => m.costTier === 'free')).toBe(true)
			expect(free.length).toBeGreaterThan(0)
			const local = listModels({ costTier: 'local' })
			expect(local.every(m => m.costTier === 'local')).toBe(true)
		})
		it('searches across name and derived description', () => {
			const r = listModels({ searchQuery: 'gpt' })
			expect(r.length).toBeGreaterThan(0)
		})
	})

	describe('isModelCompatible — hardware compatibility predicate', () => {
		it('light hardware cannot run heavy local', () => {
			const heavy = DEFAULT_MODEL_CATALOG.find(m => m.hardwareTier === 'heavy' && m.costTier === 'local')
			if (heavy) {
				expect(isModelCompatible(heavy, { ramGb: 4, cpuCores: 2, hasWebGPU: false, tier: 'light', label: 'Light', recommendedMaxLocalModelSize: '1B' } as unknown as import('../../lib/ai/hardware').HardwareProfile)).toBe(false)
				expect(isModelCompatible(heavy, { ramGb: 16, cpuCores: 8, hasWebGPU: true, tier: 'heavy', label: 'Heavy', recommendedMaxLocalModelSize: '14B' } as unknown as import('../../lib/ai/hardware').HardwareProfile)).toBe(true)
			}
		})
		it('cloud models always compatible', () => {
			const cloud = DEFAULT_MODEL_CATALOG.find(m => m.costTier === 'free')!
			expect(isModelCompatible(cloud, { ramGb: 4, cpuCores: 2, hasWebGPU: false, tier: 'light', label: '', recommendedMaxLocalModelSize: '' } as unknown as import('../../lib/ai/hardware').HardwareProfile)).toBe(true)
		})
	})

	describe('VaultStorage adapter — two adapters at the seam', () => {
		it('InMemoryVaultStorage round-trips state', async () => {
			const store = new InMemoryVaultStorage()
			const state = getDefaultAIRegistryState()
			state.activeModelId = 'test-model'
			await store.save('u1', state)
			const loaded = await store.load('u1')
			expect(loaded?.activeModelId).toBe('test-model')
			expect(await store.load('missing')).toBeNull()
		})
		it('registry factory injects vault', () => {
			const mem = new InMemoryVaultStorage()
			const reg = createProviderRegistry({ vaultStorage: mem })
			expect(reg.vault).toBe(mem)
		})
	})

	describe('testConnection — uses shared probe seam', () => {
		const origFetch = global.fetch
		afterEach(() => { global.fetch = origFetch })
		it('success on 200', async () => {
			global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response)
			const r = await providerRegistry.testConnection('openai', 'k')
			expect(r.success).toBe(true)
		})
		it('failure on 401', async () => {
			global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' } as Response)
			const r = await providerRegistry.testConnection('openai', 'bad')
			expect(r.success).toBe(false)
			expect(r.error).toContain('401')
		})
		it('rejects insecure http remote baseUrl', async () => {
			const r = await providerRegistry.testConnection('openai', 'k', 'http://evil.com/v1')
			expect(r.success).toBe(false)
			expect(r.error).toMatch(/Insecure/)
		})
	})
})
