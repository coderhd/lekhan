import { describe, it, expect } from 'vitest'
import { canonicalJson, stableHash } from '@/lib/stable-content'

describe('stableHash', () => {
	it('is deterministic and distinguishes inputs', () => {
		expect(stableHash('abc')).toBe(stableHash('abc'))
		expect(stableHash('abc')).not.toBe(stableHash('abd'))
	})

	it('is SHA-256 so import identity is collision-resistant', () => {
		// A 32-bit FNV-1a digest aliased distinct page metadata after ~65k
		// candidates, letting a changed vault reuse the retry's clientImportId and
		// replay the stale batch (external review on PR #132). 256 bits keep
		// accidental collisions out of reach at vault scale.
		expect(stableHash('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
		expect(stableHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
		// Multi-block input (padding, length encoding across blocks) and UTF-8.
		expect(stableHash('a'.repeat(1000)))
			.toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3')
		expect(stableHash('héllo ☃'))
			.toBe('c3a3e84b30327c8e3f04a788d8b68da3fd94c22353c5a30e3fe6ca7ebde3ab3f')
		expect(stableHash('abc')).toMatch(/^[0-9a-f]{64}$/)
	})
})

describe('canonicalJson', () => {
	it('sorts object keys recursively but preserves array order', () => {
		expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
		expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
	})

	it('serializes Date values like JSON.stringify (ISO), not as empty objects', () => {
		// `gray-matter` parses YAML timestamps into `Date`, which has no
		// enumerable own keys. Collapsing dates to `{}` would hide a
		// timestamp-only edit from the retry fingerprint (external review, #132).
		const d = new Date('2026-01-01T00:00:00Z')
		expect(canonicalJson(d)).toBe(JSON.stringify(d.toISOString()))
		expect(canonicalJson({ updated: d })).toBe(`{"updated":${JSON.stringify(d.toISOString())}}`)
		expect(canonicalJson(new Date('2026-01-01T00:00:00Z')))
			.not.toBe(canonicalJson(new Date('2026-06-01T00:00:00Z')))
	})

	it('handles nested dates inside arrays and objects', () => {
		const a = canonicalJson({ meta: { dates: [new Date('2026-01-01T00:00:00Z')] } })
		const b = canonicalJson({ meta: { dates: [new Date('2026-06-01T00:00:00Z')] } })
		expect(a).not.toBe(b)
	})

	it('omits undefined-valued keys, mirroring JSON.stringify', () => {
		expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}')
	})
})
