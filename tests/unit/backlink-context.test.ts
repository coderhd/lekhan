import { describe, it, expect } from 'vitest'
import { BACKLINK_CONTEXT_LENGTH, buildBacklinkContext } from '@/lib/backlinks/context'

describe('buildBacklinkContext', () => {
	it('returns the whole body when it already fits the 120-char window', () => {
		const body = 'A short note that links to [[Alpha]].'
		expect(buildBacklinkContext(body, 'Alpha')).toBe(body)
		expect(BACKLINK_CONTEXT_LENGTH).toBe(120)
	})

	it('returns undefined when there is no body to snippet', () => {
		expect(buildBacklinkContext('', 'Alpha')).toBeUndefined()
		expect(buildBacklinkContext('   \n\t ', 'Alpha')).toBeUndefined()
		expect(buildBacklinkContext(null, 'Alpha')).toBeUndefined()
		expect(buildBacklinkContext(undefined, 'Alpha')).toBeUndefined()
	})

	it('centres a <=120-char snippet on the wikilink match and marks both clipped edges', () => {
		const body = `${'before '.repeat(40)}[[Alpha]]${' after '.repeat(40)}`
		const context = buildBacklinkContext(body, 'Alpha')

		expect(context).toBeDefined()
		expect(context!.length).toBeLessThanOrEqual(BACKLINK_CONTEXT_LENGTH)
		expect(context).toContain('[[Alpha]]')
		expect(context!.startsWith('…')).toBe(true)
		expect(context!.endsWith('…')).toBe(true)
	})

	it('matches a plain title mention when the body has no wikilink brackets', () => {
		const body = `${'filler '.repeat(30)}Alpha is mentioned here${' tail'.repeat(30)}`
		const context = buildBacklinkContext(body, 'Alpha')

		expect(context).toContain('Alpha')
		expect(context!.length).toBeLessThanOrEqual(BACKLINK_CONTEXT_LENGTH)
	})

	it('does not prepend an ellipsis when the match sits at the start', () => {
		const body = `[[Alpha]] ${'after '.repeat(40)}`
		const context = buildBacklinkContext(body, 'Alpha')

		expect(context!.startsWith('[[Alpha]]')).toBe(true)
		expect(context!.endsWith('…')).toBe(true)
	})

	it('does not append an ellipsis when the match sits at the end', () => {
		const body = `${'before '.repeat(40)}[[Alpha]]`
		const context = buildBacklinkContext(body, 'Alpha')

		expect(context!.startsWith('…')).toBe(true)
		expect(context!.endsWith('[[Alpha]]')).toBe(true)
	})

	it('collapses newlines and runs of whitespace into a single line', () => {
		const body = 'first line\n\nsecond   line\twith   [[Alpha]]'
		expect(buildBacklinkContext(body, 'Alpha')).toBe('first line second line with [[Alpha]]')
	})

	it('is case-insensitive when locating the match', () => {
		const body = `${'pad '.repeat(40)}targetword${' pad'.repeat(40)}`
		const context = buildBacklinkContext(body, 'TargetWord')
		expect(context).toContain('targetword')
	})
})
