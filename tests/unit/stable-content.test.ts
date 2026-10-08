import { describe, it, expect } from 'vitest'
import { canonicalJson, stableHash } from '@/lib/stable-content'

describe('stableHash', () => {
	it('is deterministic and distinguishes inputs', () => {
		expect(stableHash('abc')).toBe(stableHash('abc'))
		expect(stableHash('abc')).not.toBe(stableHash('abd'))
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
