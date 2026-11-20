import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
	encryptApiKey,
	decryptApiKey,
	saveEncryptedApiKey,
	getDecryptedApiKey,
	clearApiKey,
} from '@/lib/crypto'

describe('AES-256-GCM BYOK Crypto Utilities', () => {
	beforeEach(() => {
		localStorage.clear()
	})

	it('encrypts and decrypts a plain API key string', async () => {
		const plainKey = 'sk_test_sarvam_123456789'
		const encrypted = await encryptApiKey(plainKey)
		expect(encrypted).not.toEqual(plainKey)
		expect(encrypted).toContain(':')

		const decrypted = await decryptApiKey(encrypted)
		expect(decrypted).toEqual(plainKey)
	})

	it('saves and retrieves encrypted key from localStorage', async () => {
		const key = 'sk_sarvam_secret_key'
		await saveEncryptedApiKey(key)

		const rawInStorage = localStorage.getItem('lekhan_sarvam_api_key')
		expect(rawInStorage).not.toBeNull()
		expect(rawInStorage).not.toEqual(key)

		const decryptedKey = await getDecryptedApiKey()
		expect(decryptedKey).toEqual(key)
	})

	it('clears API key from localStorage', async () => {
		await saveEncryptedApiKey('sk_sarvam_secret')
		await clearApiKey()
		const keyAfterClear = await getDecryptedApiKey()
		expect(keyAfterClear).toEqual('')
	})

	it('preserves an encrypted replacement when revalidating an older key', async () => {
		const replacementKey = 'sk_replacement_key'
		await saveEncryptedApiKey(replacementKey)
		const stored = localStorage.getItem('lekhan_sarvam_api_key')
		await saveEncryptedApiKey('sk_older_key', { onlyIfLegacyPlaintext: true })
		expect(localStorage.getItem('lekhan_sarvam_api_key')).toBe(stored)
		expect(await getDecryptedApiKey()).toBe(replacementKey)
	})

	it('serializes disconnect, migration, and save on the same storage lock', async () => {
		const grants: (() => void)[] = []
		const request = vi.fn((_name: string, commit: () => void) => new Promise<void>((resolve) => {
			grants.push(() => {
				commit()
				resolve()
			})
		}))
		vi.stubGlobal('navigator', { locks: { request } })
		try {
			const key = 'sk_original_key'
			localStorage.setItem('lekhan_custom_api_key', key)
			const disconnect = clearApiKey()
			const migrate = saveEncryptedApiKey(key, { onlyIfLegacyPlaintext: true })
			await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
			expect(localStorage.getItem('lekhan_custom_api_key')).toBe(key)
			grants[0]()
			await disconnect
			grants[1]()
			await migrate
			expect(await getDecryptedApiKey()).toBe('')

			const replacement = saveEncryptedApiKey('sk_replacement_key')
			await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3))
			expect(await getDecryptedApiKey()).toBe('')
			grants[2]()
			await replacement
			expect(await getDecryptedApiKey()).toBe('sk_replacement_key')
			expect(new Set(request.mock.calls.map(([name]) => name)).size).toBe(1)
		} finally {
			vi.unstubAllGlobals()
		}
	})
})
