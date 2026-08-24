import { describe, it, expect } from 'vitest'
import { isEditorPathname } from '@/lib/routes'

/**
 * The editor renders edge-to-edge with its own chrome: global header/footer
 * must hide and analytics must not fire (document-ID leakage). The editor
 * lived at /doc/* before the p2 cutover and now lives at /page/[id] —
 * both must count as editor routes (#85 bug found during screenshot QA).
 */
describe('isEditorPathname', () => {
	it('matches the current editor route /page/[id]', () => {
		expect(isEditorPathname('/page/e9d681f0-4db6')).toBe(true)
		expect(isEditorPathname('/page')).toBe(true)
	})

	it('matches the legacy editor route /doc/*', () => {
		expect(isEditorPathname('/doc')).toBe(true)
		expect(isEditorPathname('/doc/old-id')).toBe(true)
	})

	it('does not match lookalike prefixes', () => {
		expect(isEditorPathname('/pagefoo')).toBe(false)
		expect(isEditorPathname('/docs')).toBe(false)
		expect(isEditorPathname('/doctor')).toBe(false)
	})

	it('leaves marketing and app routes alone', () => {
		expect(isEditorPathname('/')).toBe(false)
		expect(isEditorPathname('/early')).toBe(false)
		expect(isEditorPathname('/settings')).toBe(false)
		expect(isEditorPathname('/login')).toBe(false)
	})

	it('handles null/undefined (SSR safety)', () => {
		expect(isEditorPathname(null)).toBe(false)
		expect(isEditorPathname(undefined)).toBe(false)
	})
})
