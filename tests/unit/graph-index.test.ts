import { describe, it, expect } from 'vitest'
import { extractLinks, extractTags, normalizeTitle } from '../../server/graph-index'

describe('extractLinks', () => {
	it('extracts plain wikilinks', () => {
		expect(extractLinks('See [[Project Alpha]] for details')).toEqual([
			{ title: 'Project Alpha', alias: null },
		])
	})

	it('extracts aliased wikilinks', () => {
		expect(extractLinks('Read [[long note|the note]] now')).toEqual([
			{ title: 'long note', alias: 'the note' },
		])
	})

	it('extracts multiple links and dedupes by title', () => {
		expect(extractLinks('[[A]] and [[A]] and [[B]]')).toEqual([
			{ title: 'A', alias: null },
			{ title: 'B', alias: null },
		])
	})

	it('ignores malformed or empty links', () => {
		expect(extractLinks('no links here')).toEqual([])
		expect(extractLinks('[[  ]]')).toEqual([])
	})

	it('returns empty array for non-string input', () => {
		expect(extractLinks(null as unknown as string)).toEqual([])
	})
})

describe('extractTags', () => {
	it('extracts hashtags at word boundaries', () => {
		expect(extractTags('meeting #work and #work again #ideas')).toEqual(['work', 'ideas'])
	})

	it('supports hierarchical tags', () => {
		expect(extractTags('tag #project/alpha here')).toEqual(['project/alpha'])
	})

	it('does not match mid-word hashes', () => {
		expect(extractTags('email me at a#b')).toEqual([])
	})

	it('returns empty array for non-string input', () => {
		expect(extractTags(null as unknown as string)).toEqual([])
	})
})

describe('normalizeTitle', () => {
	it('lowercases, trims and collapses whitespace', () => {
		expect(normalizeTitle('  Project   ALPHA ')).toBe('project alpha')
	})

	it('handles empty input', () => {
		expect(normalizeTitle('')).toBe('')
	})
})