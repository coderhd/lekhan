import { DEFAULT_MODEL_CATALOG as RAW_CATALOG, filterModels as rawFilterModels, getModelById as rawGetModelById, getDefaultAIRegistryState as rawGetDefaultAIRegistryState } from './catalog'
import { AIProviderType, ModelCard, CostTier, ModelCategory, AIRegistryState } from './types'
import { HardwareProfile, HardwareTier, getHardwareRecommendation } from './hardware'

// ---------------------------------------------------------------------------
// Central provider contract — single source of truth for every seam
// ---------------------------------------------------------------------------

export const TRUSTED_PROVIDER_BASE_URLS: Record<string, string> = {
	openai: 'https://api.openai.com/v1',
	openrouter: 'https://openrouter.ai/api/v1',
	groq: 'https://api.groq.com/openai/v1',
	deepseek: 'https://api.deepseek.com/v1',
	qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
	zai: 'https://api.z.ai/v1',
	sarvam: 'https://api.sarvam.ai/v1',
	anthropic: 'https://api.anthropic.com',
	gemini: 'https://generativelanguage.googleapis.com',
}

export const LOCAL_PROVIDERS: ReadonlySet<AIProviderType> = new Set(['ollama', 'lmstudio'] as AIProviderType[])

export function isLocalProvider(provider: AIProviderType): boolean {
	return provider === 'ollama' || provider === 'lmstudio'
}

// ---------------------------------------------------------------------------
// URL validation — shared across vault probing and /api/ai/stream custom URLs
// ---------------------------------------------------------------------------

export function isValidCustomUrl(rawUrl: string, opts?: { allowLocalHttp?: boolean }): boolean {
	const allowLocalHttp = opts?.allowLocalHttp ?? true
	try {
		const parsed = new URL(rawUrl)
		if (parsed.protocol === 'https:') {
			const hostname = parsed.hostname.toLowerCase()
			if (
				hostname === 'localhost' ||
				hostname === '127.0.0.1' ||
				hostname === '169.254.169.254' ||
				hostname.startsWith('10.') ||
				hostname.startsWith('192.168.') ||
				hostname.startsWith('172.16.') ||
				hostname.endsWith('.internal')
			) {
				return false
			}
			return true
		}
		if (allowLocalHttp && parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
			return true
		}
		return false
	} catch {
		return false
	}
}

export function isValidLocalBaseUrl(rawUrl: string): boolean {
	try {
		const parsed = new URL(rawUrl)
		const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
		if (parsed.protocol !== 'https:' && !isLocal) return false
		return true
	} catch {
		return false
	}
}

// ---------------------------------------------------------------------------
// Header mapping — one place, all providers
// ---------------------------------------------------------------------------

export function headersForProvider(provider: AIProviderType, apiKey: string): Record<string, string> {
	if (!apiKey) return {}
	if (provider === 'anthropic') return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
	if (provider === 'gemini') return { 'x-goog-api-key': apiKey }
	if (provider === 'sarvam') return { 'api-subscription-key': apiKey }
	return { Authorization: `Bearer ${apiKey}` }
}

export function probeHeadersFor(provider: AIProviderType, apiKey: string): Record<string, string> {
	return { 'Content-Type': 'application/json', ...headersForProvider(provider, apiKey) }
}

// ---------------------------------------------------------------------------
// Endpoint resolution — the deep behaviour
// ---------------------------------------------------------------------------

export function resolveBaseUrl(provider: AIProviderType, customBaseUrl?: string): string {
	if (customBaseUrl) {
		let base = customBaseUrl
		if (base.endsWith('/')) base = base.slice(0, -1)
		return base
	}
	if (isLocalProvider(provider)) {
		if (provider === 'ollama') return 'http://localhost:11434'
		if (provider === 'lmstudio') return 'http://localhost:1234'
	}
	if (provider === 'custom') return TRUSTED_PROVIDER_BASE_URLS.openai
	return TRUSTED_PROVIDER_BASE_URLS[provider] || TRUSTED_PROVIDER_BASE_URLS.openai
}

export function resolveTestEndpoint(provider: AIProviderType, baseUrl?: string): string {
	const resolvedBase = resolveBaseUrl(provider, baseUrl)
	if (provider === 'ollama') {
		let u = resolvedBase
		if (u.endsWith('/')) u = u.slice(0, -1)
		return `${u}/api/version`
	}
	if (provider === 'anthropic') return baseUrl || 'https://api.anthropic.com/v1/models'
	if (provider === 'gemini') return baseUrl || 'https://generativelanguage.googleapis.com/v1beta/models'
	if (provider === 'sarvam') return baseUrl || 'https://api.sarvam.ai/v1/models'
	let base = resolvedBase
	if (base.endsWith('/')) base = base.slice(0, -1)
	if (base.endsWith('/v1')) return `${base}/models`
	return `${base}/v1/models`
}

export interface ResolvedChatRequest {
	url: string
	headers: Record<string, string>
	body: unknown
	isLocalDirect: boolean
}

export function resolveChatRequest(args: {
	provider: AIProviderType
	model: string
	messages: Array<{ role: string; content: string }>
	apiKey?: string
	baseUrl?: string
	temperature?: number
	maxTokens?: number
	systemPrompt?: string
}): ResolvedChatRequest {
	const { provider, model, messages, apiKey, baseUrl, temperature, maxTokens, systemPrompt } = args
	const fullMessages = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages

	if (provider === 'ollama') {
		const url = `${resolveBaseUrl(provider, baseUrl)}/api/chat`
		const headers: Record<string, string> = { 'Content-Type': 'application/json' }
		const body = { model, messages: fullMessages, stream: true }
		return { url, headers, body, isLocalDirect: true }
	}
	if (provider === 'lmstudio') {
		const base = resolveBaseUrl(provider, baseUrl)
		const url = `${base.endsWith('/') ? base.slice(0, -1) : base}/v1/chat/completions`
		const headers: Record<string, string> = { 'Content-Type': 'application/json' }
		const body = { model, messages: fullMessages, stream: true }
		return { url, headers, body, isLocalDirect: true }
	}

	const url = '/api/ai/stream'
	const headers: Record<string, string> = { 'Content-Type': 'application/json' }
	if (apiKey) headers['x-ai-api-key'] = apiKey
	const body: Record<string, unknown> = { provider, model, apiKey, baseUrl, messages: fullMessages }
	if (temperature !== undefined) body.temperature = temperature
	if (maxTokens !== undefined) body.maxTokens = maxTokens
	return { url, headers, body, isLocalDirect: false }
}

export interface UpstreamRequest {
	upstreamUrl: string
	upstreamHeaders: Record<string, string>
	upstreamBody: unknown
}

export function buildUpstreamRequest(args: {
	provider: AIProviderType
	model: string
	messages: Array<{ role: string; content: string }>
	apiKey?: string
	baseUrl?: string
	temperature?: number
	maxTokens?: number
}): UpstreamRequest {
	const { provider, model, messages, apiKey = '', baseUrl, temperature, maxTokens } = args
	let upstreamUrl = ''
	const upstreamHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
	let upstreamBody: Record<string, unknown> = { model, messages, stream: true }

	if (temperature !== undefined) upstreamBody.temperature = temperature
	if (maxTokens !== undefined) upstreamBody.max_tokens = maxTokens

	if (provider === 'anthropic') {
		upstreamUrl = 'https://api.anthropic.com/v1/messages'
		upstreamHeaders['x-api-key'] = apiKey
		upstreamHeaders['anthropic-version'] = '2023-06-01'
		upstreamBody.max_tokens = maxTokens || 4096
	} else if (provider === 'gemini') {
		upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`
		upstreamHeaders['x-goog-api-key'] = apiKey
		const genConfig: Record<string, unknown> = {}
		if (temperature !== undefined) genConfig.temperature = temperature
		if (maxTokens !== undefined) genConfig.maxOutputTokens = maxTokens
		// Extract system messages into systemInstruction per Gemini docs
		const systemParts = messages.filter(m => m.role === 'system').map(m => ({ text: m.content }))
		const nonSystem = messages.filter(m => m.role !== 'system')
		upstreamBody = {
			contents: nonSystem.map((m: { role: string; content: string }) => ({
				role: m.role === 'assistant' ? 'model' : 'user',
				parts: [{ text: m.content }],
			})),
			...(systemParts.length > 0 ? { systemInstruction: { parts: systemParts } } : {}),
			...(Object.keys(genConfig).length > 0 ? { generationConfig: genConfig } : {}),
		}
	} else if (provider === 'sarvam') {
		upstreamUrl = 'https://api.sarvam.ai/v1/chat/completions'
		upstreamHeaders['api-subscription-key'] = apiKey
	} else if (provider === 'custom') {
		let base = baseUrl || ''
		if (base.endsWith('/')) base = base.slice(0, -1)
		upstreamUrl = `${base}/chat/completions`
		if (apiKey) upstreamHeaders.Authorization = `Bearer ${apiKey}`
	} else {
		const base = TRUSTED_PROVIDER_BASE_URLS[provider] || TRUSTED_PROVIDER_BASE_URLS.openai
		upstreamUrl = `${base}/chat/completions`
		if (apiKey) upstreamHeaders.Authorization = `Bearer ${apiKey}`
	}

	return { upstreamUrl, upstreamHeaders, upstreamBody }
}

// ---------------------------------------------------------------------------
// Test connection — unified probe
// ---------------------------------------------------------------------------

export async function testProviderConnection(
	provider: AIProviderType,
	apiKey: string,
	baseUrl?: string
): Promise<{ success: boolean; latencyMs: number; error?: string }> {
	const start = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()

	try {
		if (baseUrl) {
			try {
				const parsed = new URL(baseUrl)
				const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
				if (parsed.protocol !== 'https:' && !isLocal) {
					return { success: false, latencyMs: 0, error: 'Insecure remote HTTP URL rejected' }
				}
			} catch {
				return { success: false, latencyMs: 0, error: 'Invalid baseUrl format' }
			}
		}

		const url = resolveTestEndpoint(provider, baseUrl)
		const headers = probeHeadersFor(provider, apiKey)

		const res = await fetch(url, { headers })
		const latencyMs = Math.round((typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - start)
		if (res.ok) return { success: true, latencyMs }
		return { success: false, latencyMs, error: `${res.status} ${res.statusText}` }
	} catch (err: unknown) {
		const latencyMs = Math.round((typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - start)
		const msg = err instanceof Error ? err.message : String(err)
		return { success: false, latencyMs, error: msg }
	}
}

// ---------------------------------------------------------------------------
// Catalog — derived descriptions, unified filtering, hardware compatibility
// ---------------------------------------------------------------------------

function providerLabel(provider: AIProviderType): string {
	const map: Record<string, string> = {
		gemini: 'Google',
		groq: 'Groq',
		openrouter: 'OpenRouter',
		zai: 'Z.AI',
		ollama: 'Ollama',
		openai: 'OpenAI',
		anthropic: 'Anthropic',
		deepseek: 'DeepSeek',
		qwen: 'Qwen',
		sarvam: 'Sarvam',
		lmstudio: 'LM Studio',
		custom: 'Custom',
	}
	return map[provider] || provider
}

export function formatModelDescription(model: ModelCard): string {
	const ctx = model.contextWindow >= 1_000_000 ? `${model.contextWindow / 1_000_000}M` : `${Math.round(model.contextWindow / 1000)}k`
	return `${providerLabel(model.provider)}, ${ctx} context, ${model.costTier}, ${model.hardwareTier}, ${model.speedTokPerSec} tok/s, ${model.category}`
}

export const DEFAULT_MODEL_CATALOG: ModelCard[] = RAW_CATALOG.map(m => ({
	...m,
	description: formatModelDescription(m),
}))

export function filterModels(
	catalog: ModelCard[],
	filters: { costTier?: CostTier; hardwareTier?: HardwareTier; category?: ModelCategory; provider?: AIProviderType; searchQuery?: string }
): ModelCard[] {
	return rawFilterModels(catalog, filters)
}

export function getModelById(modelId: string, customCatalog?: ModelCard[]): ModelCard | undefined {
	const all = customCatalog ? [...DEFAULT_MODEL_CATALOG, ...customCatalog] : DEFAULT_MODEL_CATALOG
	return all.find(m => m.id === modelId) || rawGetModelById(modelId, customCatalog)
}

export function getDefaultAIRegistryState(): AIRegistryState {
	return rawGetDefaultAIRegistryState()
}

export function listModels(filters: {
	costTier?: CostTier
	hardwareTier?: HardwareTier
	category?: ModelCategory
	provider?: AIProviderType
	searchQuery?: string
}): ModelCard[] {
	return filterModels(DEFAULT_MODEL_CATALOG, filters)
}

export function isModelCompatible(model: ModelCard, hardware: HardwareProfile | null | undefined): boolean {
	if (!hardware) return true
	if (model.costTier !== 'local') return true
	if (model.hardwareTier === 'light') return true
	if (model.hardwareTier === 'medium') return hardware.tier === 'medium' || hardware.tier === 'heavy'
	if (model.hardwareTier === 'heavy') return hardware.tier === 'heavy'
	return true
}

export function badgeForModel(
	model: ModelCard,
	hardware: HardwareProfile | null | undefined
): { badgeText: string; badgeVariant: 'default' | 'secondary' | 'destructive' | 'outline' } | null {
	if (!hardware || model.costTier !== 'local') return null
	const rec = getHardwareRecommendation(hardware)
	return { badgeText: rec.badgeText, badgeVariant: rec.badgeVariant }
}

// ---------------------------------------------------------------------------
// Vault Storage seam — injected adapter (InMemory only; Supabase vault lives in lib/ai/vault.ts)
// ---------------------------------------------------------------------------

export interface VaultStorage {
	load(userId: string): Promise<AIRegistryState | null>
	save(userId: string, state: AIRegistryState): Promise<void>
}

export class InMemoryVaultStorage implements VaultStorage {
	private store = new Map<string, AIRegistryState>()
	async load(userId: string): Promise<AIRegistryState | null> {
		return this.store.get(userId) ?? null
	}
	async save(userId: string, state: AIRegistryState): Promise<void> {
		this.store.set(userId, structuredClone(state))
	}
	clear() { this.store.clear() }
}

// ---------------------------------------------------------------------------
// Deep factory — the module's small interface
// ---------------------------------------------------------------------------

export interface ProviderRegistry {
	readonly catalog: ModelCard[]
	listModels(filters: Parameters<typeof filterModels>[1]): ModelCard[]
	getModelById(id: string, custom?: ModelCard[]): ModelCard | undefined
	getDefaultState(): AIRegistryState
	formatDescription(model: ModelCard): string
	isCompatible(model: ModelCard, hardware: HardwareProfile | null | undefined): boolean
	isLocal(provider: AIProviderType): boolean
	resolveBaseUrl(provider: AIProviderType, customBaseUrl?: string): string
	headersFor(provider: AIProviderType, apiKey: string): Record<string, string>
	resolveTestEndpoint(provider: AIProviderType, baseUrl?: string): string
	resolveChatRequest(args: Parameters<typeof resolveChatRequest>[0]): ResolvedChatRequest
	buildUpstreamRequest(args: Parameters<typeof buildUpstreamRequest>[0]): UpstreamRequest
	testConnection(provider: AIProviderType, apiKey: string, baseUrl?: string): Promise<{ success: boolean; latencyMs: number; error?: string }>
	isValidCustomUrl(url: string): boolean
	vault?: VaultStorage
}

export function createProviderRegistry(opts?: { vaultStorage?: VaultStorage; catalog?: ModelCard[] }): ProviderRegistry {
	const catalog = opts?.catalog ?? DEFAULT_MODEL_CATALOG
	return {
		catalog,
		listModels: (filters) => filterModels(catalog, filters),
		getModelById: (id, custom) => {
			const all = custom ? [...catalog, ...custom] : catalog
			return all.find(m => m.id === id) || rawGetModelById(id, custom)
		},
		getDefaultState: () => getDefaultAIRegistryState(),
		formatDescription: formatModelDescription,
		isCompatible: isModelCompatible,
		isLocal: isLocalProvider,
		resolveBaseUrl,
		headersFor: headersForProvider,
		resolveTestEndpoint,
		resolveChatRequest,
		buildUpstreamRequest,
		testConnection: testProviderConnection,
		isValidCustomUrl: (url: string) => isValidCustomUrl(url),
		vault: opts?.vaultStorage,
	}
}

export const providerRegistry = createProviderRegistry()
