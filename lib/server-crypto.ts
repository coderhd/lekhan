import crypto from 'node:crypto'

/**
 * Server-side snapshot encryption-at-rest (ADR 0001).
 *
 * Algorithm: AES-256-GCM with 96-bit (12-byte) random IV and 128-bit (16-byte) auth tag.
 * Binary format: [MAGIC (8B)][IV (12B)][TAG (16B)][CIPHERTEXT (NB)]
 */

export const MAGIC_HEADER = Buffer.from([
	0x4c, 0x4b, 0x5f, 0x45, 0x4e, 0x43, 0x5f, 0x31,
]) // ASCII: 'LK_ENC_V1'

const IV_LENGTH = 12
const TAG_LENGTH = 16
const HEADER_LENGTH = MAGIC_HEADER.length + IV_LENGTH + TAG_LENGTH // 8 + 12 + 16 = 36 bytes

const DEFAULT_DEV_SECRET = 'lekhan_dev_fallback_secret_key_2026_unencrypted_rest'

/**
 * Derive a 32-byte (256-bit) encryption key from any secret string.
 */
export function deriveKeyFromSecret(secret: string): Buffer {
	return crypto.createHash('sha256').update(secret, 'utf8').digest()
}

/**
 * Resolve the current primary encryption key.
 */
function getPrimaryKey(): Buffer {
	const secret =
		process.env.LEKHAN_ENCRYPTION_KEY ||
		process.env.SUPABASE_SECRET_KEY ||
		process.env.SUPABASE_SERVICE_ROLE_KEY ||
		DEFAULT_DEV_SECRET

	return deriveKeyFromSecret(secret)
}

/**
 * Resolve previous encryption keys for rotation fallback.
 */
function getPreviousKeys(): Buffer[] {
	const prevKeysEnv = process.env.LEKHAN_ENCRYPTION_PREVIOUS_KEYS
	if (!prevKeysEnv) return []

	return prevKeysEnv
		.split(',')
		.map(k => k.trim())
		.filter(Boolean)
		.map(deriveKeyFromSecret)
}

/**
 * Check if a binary buffer begins with the LK_ENC_V1 magic header.
 */
export function isEncryptedSnapshot(data: Buffer | Uint8Array): boolean {
	if (!data || data.length < MAGIC_HEADER.length) {
		return false
	}
	const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
	return buf.subarray(0, MAGIC_HEADER.length).equals(MAGIC_HEADER)
}

/**
 * Encrypt a plaintext buffer (e.g. Yjs update binary) using AES-256-GCM.
 */
export function encryptSnapshot(plaintext: Buffer | Uint8Array): Buffer {
	const plainBuffer = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext)
	const key = getPrimaryKey()
	const iv = crypto.randomBytes(IV_LENGTH)

	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
	const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()])
	const tag = cipher.getAuthTag()

	return Buffer.concat([MAGIC_HEADER, iv, tag, ciphertext])
}

/**
 * Decrypt a snapshot buffer.
 *
 * If the snapshot is not encrypted (e.g. legacy blob), it returns the original buffer as-is.
 * If encrypted, attempts decryption with the primary key, falling back to any previous keys.
 */
export function decryptSnapshot(data: Buffer | Uint8Array): Buffer {
	const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)

	if (!isEncryptedSnapshot(buf)) {
		// Transparent passthrough for legacy unencrypted blobs
		return buf
	}

	if (buf.length < HEADER_LENGTH) {
		throw new Error('Corrupted encrypted snapshot: payload shorter than header length.')
	}

	const iv = buf.subarray(MAGIC_HEADER.length, MAGIC_HEADER.length + IV_LENGTH)
	const tag = buf.subarray(
		MAGIC_HEADER.length + IV_LENGTH,
		MAGIC_HEADER.length + IV_LENGTH + TAG_LENGTH
	)
	const ciphertext = buf.subarray(HEADER_LENGTH)

	const allKeys = [getPrimaryKey(), ...getPreviousKeys()]
	let lastError: unknown = null

	for (const key of allKeys) {
		try {
			const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
			decipher.setAuthTag(tag)
			const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
			return decrypted
		} catch (err) {
			lastError = err
		}
	}

	throw new Error(
		`Snapshot decryption failed: authentication tag verification failed across all configured keys. (${
			lastError instanceof Error ? lastError.message : String(lastError)
		})`
	)
}
