import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import {
	encryptSnapshot,
	decryptSnapshot,
	isEncryptedSnapshot,
	MAGIC_HEADER,
	deriveKeyFromSecret,
} from '@/lib/server-crypto'

describe('server-side snapshot crypto (AES-256-GCM)', () => {
	const originalKey = process.env.LEKHAN_ENCRYPTION_KEY
	const originalPrevKeys = process.env.LEKHAN_ENCRYPTION_PREVIOUS_KEYS
	const originalSecret = process.env.SUPABASE_SECRET_KEY

	beforeEach(() => {
		process.env.LEKHAN_ENCRYPTION_KEY = 'test-primary-encryption-key-32b!!'
		delete process.env.LEKHAN_ENCRYPTION_PREVIOUS_KEYS
		delete process.env.SUPABASE_SECRET_KEY
	})

	afterAll(() => {
		process.env.LEKHAN_ENCRYPTION_KEY = originalKey
		process.env.LEKHAN_ENCRYPTION_PREVIOUS_KEYS = originalPrevKeys
		process.env.SUPABASE_SECRET_KEY = originalSecret
	})

	it('encrypts plaintext buffer with LK_ENC_V1 magic header', () => {
		const plaintext = Buffer.from('hello yjs binary state')
		const encrypted = encryptSnapshot(plaintext)

		expect(isEncryptedSnapshot(encrypted)).toBe(true)
		expect(encrypted.subarray(0, 8)).toEqual(MAGIC_HEADER)
		expect(encrypted.length).toBe(plaintext.length + 8 + 12 + 16)
	})

	it('decrypts encrypted snapshot back to exact original plaintext', () => {
		const originalData = Buffer.from([0x01, 0x02, 0x03, 0x04, 0xff, 0xfe, 0x00])
		const encrypted = encryptSnapshot(originalData)
		const decrypted = decryptSnapshot(encrypted)

		expect(decrypted).toEqual(originalData)
	})

	it('handles empty buffers correctly', () => {
		const empty = Buffer.alloc(0)
		const encrypted = encryptSnapshot(empty)
		const decrypted = decryptSnapshot(encrypted)

		expect(decrypted).toEqual(empty)
	})

	it('passes through legacy unencrypted buffers transparently', () => {
		const legacyYjsState = Buffer.from([0x00, 0x01, 0x79, 0x6a, 0x73, 0x20, 0x75, 0x70])
		expect(isEncryptedSnapshot(legacyYjsState)).toBe(false)

		const decrypted = decryptSnapshot(legacyYjsState)
		expect(decrypted).toEqual(legacyYjsState)
	})

	it('throws on tampered ciphertext or modified auth tag', () => {
		const plaintext = Buffer.from('sensitive document notes')
		const encrypted = encryptSnapshot(plaintext)

		// Tamper with a byte in ciphertext
		const tampered = Buffer.from(encrypted)
		tampered[tampered.length - 1] ^= 0x01

		expect(() => decryptSnapshot(tampered)).toThrow(/Decryption failed|Authentication failed/i)
	})

	it('supports key rotation via LEKHAN_ENCRYPTION_PREVIOUS_KEYS', () => {
		const oldKey = 'old-secret-encryption-key-32bytes'
		const newKey = 'new-secret-encryption-key-32bytes'

		// 1. Encrypt with old key
		process.env.LEKHAN_ENCRYPTION_KEY = oldKey
		const plaintext = Buffer.from('data before key rotation')
		const encryptedWithOldKey = encryptSnapshot(plaintext)

		// 2. Rotate key: set new primary key, put old key in previous keys
		process.env.LEKHAN_ENCRYPTION_KEY = newKey
		process.env.LEKHAN_ENCRYPTION_PREVIOUS_KEYS = oldKey

		// 3. Reading old snapshot should succeed via fallback key
		const decrypted = decryptSnapshot(encryptedWithOldKey)
		expect(decrypted).toEqual(plaintext)

		// 4. New snapshot should use new key
		const encryptedWithNewKey = encryptSnapshot(plaintext)
		expect(decryptSnapshot(encryptedWithNewKey)).toEqual(plaintext)

		// 5. If previous key is removed, old snapshot fails to decrypt
		delete process.env.LEKHAN_ENCRYPTION_PREVIOUS_KEYS
		expect(() => decryptSnapshot(encryptedWithOldKey)).toThrow(/Decryption failed|Authentication failed/i)
	})

	it('derives a consistent 32-byte key from any secret string', () => {
		const key1 = deriveKeyFromSecret('my-secret-passphrase')
		const key2 = deriveKeyFromSecret('my-secret-passphrase')
		const key3 = deriveKeyFromSecret('different-secret')

		expect(key1).toHaveLength(32)
		expect(key1).toEqual(key2)
		expect(key1).not.toEqual(key3)
	})
})
