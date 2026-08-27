const crypto = require('node:crypto')

/**
 * Server-side snapshot encryption-at-rest (ADR 0001).
 * CommonJS module for the y-websocket sync server.
 *
 * Algorithm: AES-256-GCM with 96-bit (12-byte) random IV and 128-bit (16-byte) auth tag.
 * Binary format: [MAGIC (8B)][IV (12B)][TAG (16B)][CIPHERTEXT (NB)]
 */

const MAGIC_HEADER = Buffer.from([
	0x4c, 0x4b, 0x5f, 0x45, 0x4e, 0x43, 0x5f, 0x31,
]) // ASCII: 'LK_ENC_V1'

const IV_LENGTH = 12
const TAG_LENGTH = 16
const HEADER_LENGTH = MAGIC_HEADER.length + IV_LENGTH + TAG_LENGTH // 8 + 12 + 16 = 36 bytes

const DEFAULT_DEV_SECRET = 'lekhan_dev_fallback_secret_key_2026_unencrypted_rest'

function deriveKeyFromSecret(secret) {
	return crypto.createHash('sha256').update(secret, 'utf8').digest()
}

function getPrimaryKey() {
	const secret =
		process.env.LEKHAN_ENCRYPTION_KEY ||
		process.env.SUPABASE_SECRET_KEY ||
		process.env.SUPABASE_SERVICE_ROLE_KEY ||
		DEFAULT_DEV_SECRET

	return deriveKeyFromSecret(secret)
}

function getPreviousKeys() {
	const prevKeysEnv = process.env.LEKHAN_ENCRYPTION_PREVIOUS_KEYS
	if (!prevKeysEnv) return []

	return prevKeysEnv
		.split(',')
		.map(k => k.trim())
		.filter(Boolean)
		.map(deriveKeyFromSecret)
}

function isEncryptedSnapshot(data) {
	if (!data || data.length < MAGIC_HEADER.length) {
		return false
	}
	const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
	return buf.subarray(0, MAGIC_HEADER.length).equals(MAGIC_HEADER)
}

function encryptSnapshot(plaintext) {
	const plainBuffer = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext)
	const key = getPrimaryKey()
	const iv = crypto.randomBytes(IV_LENGTH)

	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
	const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()])
	const tag = cipher.getAuthTag()

	return Buffer.concat([MAGIC_HEADER, iv, tag, ciphertext])
}

function decryptSnapshot(data) {
	const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)

	if (!isEncryptedSnapshot(buf)) {
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
	let lastError = null

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

module.exports = {
	MAGIC_HEADER,
	deriveKeyFromSecret,
	isEncryptedSnapshot,
	encryptSnapshot,
	decryptSnapshot,
}
