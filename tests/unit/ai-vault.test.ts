import { describe, it, expect, beforeAll, afterEach, vi } from "vitest"
import { encryptAIRegistry, decryptAIRegistry, syncVaultToSupabase, loadVaultFromSupabase, testProviderKey } from '../../lib/ai/vault'
import { generateEncryptionKey } from '../../lib/crypto'
import { AIRegistryState } from '../../lib/ai/types'
import crypto from 'crypto'

// Polyfill WebCrypto for Node environment if necessary
if (typeof window === 'undefined') {
	global.window = { crypto: crypto.webcrypto as any } as any;
	global.performance = { now: () => Date.now() } as any;
} else if (!window.crypto) {
	window.crypto = crypto.webcrypto as any;
}

const mockRegistryState: AIRegistryState = {
	activeProviderId: 'ollama',
	activeModelId: 'llama3',
	fallbackModelIds: [],
	providers: {
		ollama: {
			id: 'ollama',
			provider: 'ollama',
			name: 'Ollama',
			enabled: true,
			defaultModel: 'llama3',
			availableModels: ['llama3'],
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		}
	}
}

describe('AI Vault', () => {
	let testKey: CryptoKey

	beforeAll(async () => {
		testKey = await generateEncryptionKey()
	})

	describe('Registry Encryption', () => {
		it('should encrypt and decrypt AIRegistryState with fidelity', async () => {
			const encrypted = await encryptAIRegistry(mockRegistryState, testKey)
			expect(encrypted).toBeInstanceOf(Uint8Array)

			const decrypted = await decryptAIRegistry(encrypted, testKey)
			expect(decrypted).toEqual(mockRegistryState)
		})

		it('should fail decryption with wrong key', async () => {
			const wrongKey = await generateEncryptionKey()
			const encrypted = await encryptAIRegistry(mockRegistryState, testKey)

			await expect(decryptAIRegistry(encrypted, wrongKey)).rejects.toThrow()
		})
		
		it('should fail decryption with corrupted ciphertext', async () => {
			const encrypted = await encryptAIRegistry(mockRegistryState, testKey)
			encrypted[15] ^= 0xff // Corrupt a byte
			await expect(decryptAIRegistry(encrypted, testKey)).rejects.toThrow()
		})
	})

	describe('Supabase Sync', () => {
		it('should sync vault to Supabase successfully', async () => {
			const mockUpdate = vi.fn().mockReturnThis()
			const mockEq = vi.fn().mockResolvedValue({ error: null })
			const mockSupabase = {
				from: vi.fn().mockReturnValue({ update: mockUpdate, eq: mockEq })
			}

			const payload = new Uint8Array([1, 2, 3])
			await syncVaultToSupabase(mockSupabase, 'user-1', payload)

			expect(mockSupabase.from).toHaveBeenCalledWith('profiles')
			expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
				encrypted_ai_keys: Buffer.from(payload).toString('base64')
			}))
			expect(mockEq).toHaveBeenCalledWith('id', 'user-1')
		})

		it('should throw error when sync fails', async () => {
			const mockUpdate = vi.fn().mockReturnThis()
			const mockEq = vi.fn().mockResolvedValue({ error: new Error('DB Error') })
			const mockSupabase = {
				from: vi.fn().mockReturnValue({ update: mockUpdate, eq: mockEq })
			}

			const payload = new Uint8Array([1, 2, 3])
			await expect(syncVaultToSupabase(mockSupabase, 'user-1', payload)).rejects.toThrow('DB Error')
		})

		it('should load vault from Supabase', async () => {
			const encrypted = await encryptAIRegistry(mockRegistryState, testKey)
			const base64Str = Buffer.from(encrypted).toString('base64')

			const mockEq = vi.fn().mockReturnThis()
			const mockMaybeSingle = vi.fn().mockResolvedValue({ data: { encrypted_ai_keys: base64Str }, error: null })
			const mockSupabase = {
				from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnThis(), eq: mockEq, maybeSingle: mockMaybeSingle })
			}

			const result = await loadVaultFromSupabase(mockSupabase, 'user-1', testKey)
			expect(result).toEqual(mockRegistryState)
		})

		it('should return null when no data in Supabase', async () => {
			const mockEq = vi.fn().mockReturnThis()
			const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
			const mockSupabase = {
				from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnThis(), eq: mockEq, maybeSingle: mockMaybeSingle })
			}

			const result = await loadVaultFromSupabase(mockSupabase, 'user-1', testKey)
			expect(result).toBeNull()
		})
	})

	describe('testProviderKey', () => {
		const originalFetch = global.fetch

		afterEach(() => {
			global.fetch = originalFetch
		})

		it('should return success on 200 OK', async () => {
			global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
			
			const result = await testProviderKey('ollama', 'test-key', 'http://localhost:11434')
			
			expect(result.success).toBe(true)
			expect(typeof result.latencyMs).toBe('number')
			expect(result.error).toBeUndefined()
		})

		it('should return failure on 401 Unauthorized', async () => {
			global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' })
			
			const result = await testProviderKey('openai', 'wrong-key')
			
			expect(result.success).toBe(false)
			expect(typeof result.latencyMs).toBe('number')
			expect(result.error).toContain('401')
		})

		it('should return failure on network error', async () => {
			global.fetch = vi.fn().mockRejectedValue(new Error('Network Error'))
			
			const result = await testProviderKey('openai', 'test-key')
			
			expect(result.success).toBe(false)
			expect(typeof result.latencyMs).toBe('number')
			expect(result.error).toContain('Network Error')
		})
	})
})
