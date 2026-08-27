const STORAGE_KEY = 'lekhan_sarvam_api_key'
const LEGACY_STORAGE_KEY = 'lekhan_custom_api_key'
const SALT = 'lekhan_byok_salt_v1'

async function getDerivedKey(): Promise<CryptoKey> {
	const encoder = new TextEncoder()
	const keyMaterial = await window.crypto.subtle.importKey(
		'raw',
		encoder.encode(SALT),
		{ name: 'PBKDF2' },
		false,
		['deriveKey']
	)

	return window.crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			salt: encoder.encode('lekhan_static_salt_2026'),
			iterations: 100000,
			hash: 'SHA-256',
		},
		keyMaterial,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	)
}

export async function encryptApiKey(plainText: string): Promise<string> {
	if (!plainText) return ''
	if (typeof window === 'undefined' || !window.crypto?.subtle) {
		return plainText
	}

	try {
		const key = await getDerivedKey()
		const iv = window.crypto.getRandomValues(new Uint8Array(12))
		const encoder = new TextEncoder()

		const encryptedBuffer = await window.crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv },
			key,
			encoder.encode(plainText)
		)

		const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('')
		const encryptedHex = Array.from(new Uint8Array(encryptedBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')

		return `${ivHex}:${encryptedHex}`
	} catch (err) {
		console.error('Encryption failed:', err)
		return plainText
	}
}

export async function decryptApiKey(cipherText: string): Promise<string> {
	if (!cipherText) return ''
	if (!cipherText.includes(':')) return cipherText // fallback for legacy unencrypted
	if (typeof window === 'undefined' || !window.crypto?.subtle) {
		return cipherText
	}

	try {
		const [ivHex, encryptedHex] = cipherText.split(':')
		const iv = new Uint8Array(ivHex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || [])
		const encryptedBuffer = new Uint8Array(encryptedHex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || [])

		const key = await getDerivedKey()
		const decryptedBuffer = await window.crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv },
			key,
			encryptedBuffer
		)

		const decoder = new TextDecoder()
		return decoder.decode(decryptedBuffer)
	} catch (err) {
		console.error('Decryption failed:', err)
		return ''
	}
}

export async function saveEncryptedApiKey(plainKey: string): Promise<void> {
	if (typeof window === 'undefined') {
		throw new Error('Secure storage is unavailable in this context.')
	}
	const trimmed = plainKey.trim()
	const encrypted = await encryptApiKey(trimmed)
	if (!encrypted || encrypted === trimmed) {
		// WebCrypto unavailable: refuse to persist the plaintext fallback —
		// the UI promises AES-256-GCM and must keep that promise or save nothing.
		throw new Error('Secure encryption is not available in this browser. The key was not saved.')
	}
	localStorage.setItem(STORAGE_KEY, encrypted)
	localStorage.removeItem(LEGACY_STORAGE_KEY)
}

export async function getDecryptedApiKey(): Promise<string> {
	if (typeof window === 'undefined') return ''
	const cipherText = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || ''
	if (!cipherText) return ''
	return decryptApiKey(cipherText)
}

export function clearApiKey(): void {
	if (typeof window === 'undefined') return
	localStorage.removeItem(STORAGE_KEY)
	localStorage.removeItem(LEGACY_STORAGE_KEY)
}

export async function generateEncryptionKey(): Promise<CryptoKey> {
	return window.crypto.subtle.generateKey(
		{ name: 'AES-GCM', length: 256 },
		true,
		['encrypt', 'decrypt']
	)
}

export async function getOrCreateUserVaultKey(userId?: string): Promise<CryptoKey> {
	if (typeof window === 'undefined' || !window.crypto?.subtle) {
		throw new Error('WebCrypto unavailable')
	}
	const storageKeyName = userId ? `lekhan_vault_key_${userId}` : 'lekhan_vault_key_default'
	const existingRaw = localStorage.getItem(storageKeyName)
	if (existingRaw) {
		try {
			const rawBytes = new Uint8Array(existingRaw.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || [])
			return await window.crypto.subtle.importKey(
				'raw',
				rawBytes,
				{ name: 'AES-GCM', length: 256 },
				true,
				['encrypt', 'decrypt']
			)
		} catch (err) {
			console.error('Failed to import stored vault key:', err)
		}
	}
	const newKey = await generateEncryptionKey()
	const exported = await window.crypto.subtle.exportKey('raw', newKey)
	const hex = Array.from(new Uint8Array(exported)).map(b => b.toString(16).padStart(2, '0')).join('')
	localStorage.setItem(storageKeyName, hex)
	return newKey
}

export async function encryptDocumentState(data: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
	const iv = window.crypto.getRandomValues(new Uint8Array(12))
	const encrypted = await window.crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		data as BufferSource
	)
	const result = new Uint8Array(iv.length + encrypted.byteLength)
	result.set(iv, 0)
	result.set(new Uint8Array(encrypted), iv.length)
	return result
}

export async function decryptDocumentState(payload: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
	const iv = payload.slice(0, 12)
	const ciphertext = payload.slice(12)
	const decrypted = await window.crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv },
		key,
		ciphertext as BufferSource
	)
	return new Uint8Array(decrypted)
}
