import { describe, it, expect, beforeEach } from 'vitest'
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
		clearApiKey()
		const keyAfterClear = await getDecryptedApiKey()
		expect(keyAfterClear).toEqual('')
	})
})
