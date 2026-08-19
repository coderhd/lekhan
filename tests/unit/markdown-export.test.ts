import { describe, it, expect } from 'vitest'
import {
	slugifyTitle,
	markdownExportFilename,
	resolveTags,
	buildMarkdownExport,
} from '@/lib/markdown-export'
import { parseFrontmatter } from '@/lib/markdown-io'

describe('slugifyTitle', () => {
	it('lowercases and hyphenates spaces', () => {
		expect(slugifyTitle('My Awesome Page')).toBe('my-awesome-page')
	})

	it('strips punctuation and collapses separators', () => {
		expect(slugifyTitle('Hello, World!')).toBe('hello-world')
		expect(slugifyTitle('Version 2.0 — release')).toBe('version-2-0-release')
	})

	it('trims leading and trailing separators', () => {
		expect(slugifyTitle('  Leading/Trailing  ')).toBe('leading-trailing')
		expect(slugifyTitle('-dashes-')).toBe('dashes')
	})

	it('returns an empty string for empty or separator-only input', () => {
		expect(slugifyTitle('')).toBe('')
		expect(slugifyTitle('   ')).toBe('')
		expect(slugifyTitle('!!!')).toBe('')
	})
})

describe('markdownExportFilename', () => {
	it('appends the .md extension to a slugified title', () => {
		expect(markdownExportFilename('My Page')).toBe('my-page.md')
	})

	it('slugs the title before naming the file', () => {
		expect(markdownExportFilename('Meeting Notes: 2026!')).toBe('meeting-notes-2026.md')
	})

	it('falls back to untitled.md for an empty title', () => {
		expect(markdownExportFilename('')).toBe('untitled.md')
		expect(markdownExportFilename('   ')).toBe('untitled.md')
	})
})

describe('resolveTags', () => {
	it('prefers page_tags over the properties mirror', () => {
		expect(resolveTags(['real'], { tags: ['mirror'] })).toEqual(['real'])
	})

	it('falls back to properties.tags when page_tags is empty', () => {
		expect(resolveTags([], { tags: ['fallback'] })).toEqual(['fallback'])
		expect(resolveTags([], { tags: ['a', 'b'] })).toEqual(['a', 'b'])
	})

	it('returns empty when neither source yields string tags', () => {
		expect(resolveTags([], {})).toEqual([])
		expect(resolveTags([], { tags: 42 })).toEqual([])
		expect(resolveTags([], { tags: ['ok', 7] })).toEqual(['ok'])
	})
})

describe('buildMarkdownExport', () => {
	const base = {
		title: 'My Page',
		properties: { author: 'Harsh', count: 3 },
		pageTags: ['notes', 'work'],
		body: '# Heading\n\nSome **bold** text.\n',
	}

	it('produces a file starting with YAML frontmatter', () => {
		const file = buildMarkdownExport(base)
		expect(file).toMatch(/^---\n/)
	})

	it('writes title, properties, and tags into the frontmatter', () => {
		const file = buildMarkdownExport(base)
		expect(file).toContain('title: My Page')
		expect(file).toContain('author: Harsh')
		expect(file).toContain('count: 3')
		expect(file).toContain('tags:')
		expect(file).toContain('notes')
		expect(file).toContain('work')
	})

	it('appends the serialized body after the frontmatter', () => {
		const file = buildMarkdownExport(base)
		expect(file).toContain('# Heading\n\nSome **bold** text.')
		expect(file.indexOf('# Heading')).toBeGreaterThan(file.indexOf('---\n'))
	})

	it('falls back to properties.tags when page_tags is empty', () => {
		const file = buildMarkdownExport({ ...base, pageTags: [], properties: { tags: ['from-props'] } })
		expect(file).toContain('from-props')
		expect(file).not.toContain('author:')
	})

	it('never leaks reserved keys from properties', () => {
		const file = buildMarkdownExport({
			...base,
			pageTags: [],
			properties: { title: 'fake', tags: ['fake'], author: 'Harsh' },
		})
		expect(file).not.toContain('title: fake')
		// the tags mirror serializes once, as the canonical tags: key
		expect(file.match(/^tags:/m)).toHaveLength(1)
		const { data } = parseFrontmatter(file)
		expect(data.title).toBe('My Page')
		expect(data.tags).toEqual(['fake'])
		expect(data.properties).toEqual({ author: 'Harsh' })
	})

	it('exports frontmatter only for an empty body', () => {
		const file = buildMarkdownExport({ ...base, body: '' })
		expect(file).toMatch(/^---\n/)
		expect(file).not.toContain('# Heading')
	})

	it('round-trips through parseFrontmatter', () => {
		const file = buildMarkdownExport(base)
		const { data, body } = parseFrontmatter(file)
		expect(data.title).toBe('My Page')
		expect(data.tags).toEqual(['notes', 'work'])
		expect(data.properties).toEqual({ author: 'Harsh', count: 3 })
		expect(body.trim()).toBe('# Heading\n\nSome **bold** text.')
	})
})
