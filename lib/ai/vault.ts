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

export async function syncVaultToSupabase(supabaseClient: any, userId: string, encryptedPayload: Uint8Array): Promise<void> {
	// Need to handle Buffer / base64 for browser compatibility.
	// We'll use standard btoa or Buffer if in node.
	let base64Str: string
	if (typeof Buffer !== 'undefined') {
		base64Str = Buffer.from(encryptedPayload).toString('base64')
	} else {
		base64Str = btoa(String.fromCharCode.apply(null, Array.from(encryptedPayload)))
	}

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

	const base64Str = data.encrypted_ai_keys
	let payload: Uint8Array
	if (typeof Buffer !== 'undefined') {
		payload = new Uint8Array(Buffer.from(base64Str, 'base64'))
	} else {
		const binary_string = atob(base64Str)
		const len = binary_string.length
		payload = new Uint8Array(len)
		for (let i = 0; i < len; i++) {
			payload[i] = binary_string.charCodeAt(i)
		}
	}

	return decryptAIRegistry(payload, key)
}

export async function testProviderKey(provider: AIProviderType, apiKey: string, baseUrl?: string): Promise<{ success: boolean; latencyMs: number; error?: string }> {
	const startTime = performance.now()
	
	try {
		let url = baseUrl || ''
		let headers: Record<string, string> = {
			'Authorization': `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		}
		
		if (provider === 'ollama') {
			url = `${baseUrl || 'http://localhost:11434'}`
			if (url.endsWith('/')) url = url.slice(0, -1)
			url += '/api/version'
			headers = {}
		} else if (provider === 'openai') {
			url = 'https://api.openai.com/v1/models'
		} else {
			if (!url) {
				url = 'https://api.openai.com/v1/models'
			} else {
				if (url.endsWith('/')) url = url.slice(0, -1)
				if (url.endsWith('/v1')) url += '/models'
			}
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
