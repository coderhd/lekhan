import { encryptDocumentState, decryptDocumentState } from '../crypto'
import { AIRegistryState, AIProviderType } from './types'

export async function encryptAIRegistry(state: AIRegistryState, key: CryptoKey): Promise<Uint8Array> {
	const json = JSON.stringify(state)
	const bytes = new TextEncoder().encode(json)
	return encryptDocumentState(bytes, key)
}

export async function decryptAIRegistry(payload: Uint8Array, key: CryptoKey): Promise<AIRegistryState> {
	const decryptedBytes = await decryptDocumentState(payload, key)
	const json = new TextDecoder().decode(decryptedBytes)
	return JSON.parse(json) as AIRegistryState
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
	if (typeof Buffer !== 'undefined') {
		return Buffer.from(bytes).toString('base64')
	}
	let binary = ''
	const chunkSize = 8192
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.subarray(i, i + chunkSize)
		binary += String.fromCharCode.apply(null, Array.from(chunk))
	}
	return btoa(binary)
}

function base64ToUint8Array(base64: string): Uint8Array {
	if (typeof Buffer !== 'undefined') {
		return new Uint8Array(Buffer.from(base64, 'base64'))
	}
	const binary = atob(base64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i)
	}
	return bytes
}

export async function syncVaultToSupabase(supabaseClient: any, userId: string, encryptedPayload: Uint8Array): Promise<void> {
	const base64Str = uint8ArrayToBase64(encryptedPayload)

	const { error } = await supabaseClient
		.from('profiles')
		.update({ encrypted_ai_keys: base64Str, updated_at: new Date().toISOString() })
		.eq('id', userId)
		
	if (error) {
		throw new Error(error.message || 'Failed to sync vault to Supabase')
	}
}

export async function loadVaultFromSupabase(supabaseClient: any, userId: string, key: CryptoKey): Promise<AIRegistryState | null> {
	const { data, error } = await supabaseClient
		.from('profiles')
		.select('encrypted_ai_keys')
		.eq('id', userId)
		.maybeSingle()

	if (error || !data || !data.encrypted_ai_keys) {
		return null
	}

	const payload = base64ToUint8Array(data.encrypted_ai_keys)
	return decryptAIRegistry(payload, key)
}

export async function testProviderKey(provider: AIProviderType, apiKey: string, baseUrl?: string): Promise<{ success: boolean; latencyMs: number; error?: string }> {
	const startTime = performance.now()
	
	try {
		let url = ''
		const headers: Record<string, string> = {
			'Content-Type': 'application/json'
		}
		
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

		if (provider === 'ollama') {
			url = `${baseUrl || 'http://localhost:11434'}`
			if (url.endsWith('/')) url = url.slice(0, -1)
			url += '/api/version'
		} else if (provider === 'anthropic') {
			url = baseUrl || 'https://api.anthropic.com/v1/models'
			headers['x-api-key'] = apiKey
			headers['anthropic-version'] = '2023-06-01'
		} else if (provider === 'gemini') {
			url = baseUrl || 'https://generativelanguage.googleapis.com/v1beta/models'
			headers['x-goog-api-key'] = apiKey
		} else if (provider === 'sarvam') {
			url = baseUrl || 'https://api.sarvam.ai/v1/models'
			headers['api-subscription-key'] = apiKey
		} else {
			if (!baseUrl) {
				if (provider === 'openrouter') url = 'https://openrouter.ai/api/v1/models'
				else if (provider === 'groq') url = 'https://api.groq.com/openai/v1/models'
				else if (provider === 'deepseek') url = 'https://api.deepseek.com/v1/models'
				else if (provider === 'qwen') url = 'https://dashscope.aliyuncs.com/compatible-mode/v1/models'
				else url = 'https://api.openai.com/v1/models'
			} else {
				let base = baseUrl
				if (base.endsWith('/')) base = base.slice(0, -1)
				if (base.endsWith('/v1')) url = `${base}/models`
				else url = `${base}/v1/models`
			}
			headers['Authorization'] = `Bearer ${apiKey}`
		}

		const res = await fetch(url, { headers })
		const latencyMs = Math.round(performance.now() - startTime)

		if (res.ok) {
			return { success: true, latencyMs }
		} else {
			return { success: false, latencyMs, error: `${res.status} ${res.statusText}` }
		}
	} catch (err: any) {
		const latencyMs = Math.round(performance.now() - startTime)
		return { success: false, latencyMs, error: err.message || String(err) }
	}
}
