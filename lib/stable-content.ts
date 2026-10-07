/**
 * Deterministic content-identity helpers for the import fingerprint (#87).
 *
 * These are non-cryptographic: they exist so a retry of the SAME vault yields
 * the SAME identity, and a materially different vault yields a different one.
 * They are never used for security.
 */

/**
 * FNV-1a, 32-bit. Cheap, stable across runs/platforms, no dependencies — used
 * only to compare import-session content.
 */
export function stableHash (input: string): string {
	let hash = 0x811c9dc5
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i)
		hash = Math.imul(hash, 0x01000193)
	}
	return (hash >>> 0).toString(16)
}

/**
 * `JSON.stringify` with object keys sorted recursively (array order is
 * preserved — it is semantically meaningful). This makes a ProseMirror/JSON
 * document hash its *content* rather than its property insertion order, so two
 * ingestions of the same source produce the same string.
 */
export function canonicalJson (value: unknown): string {
	if (value === null || typeof value !== 'object') {
		const serialized = JSON.stringify(value)
		return serialized === undefined ? 'null' : serialized
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalJson).join(',')}]`
	}
	const record = value as Record<string, unknown>
	const keys = Object.keys(record).sort()
	return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}
