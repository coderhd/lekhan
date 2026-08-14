import { describe, it, expect } from 'vitest'
import {
	parseMarkdown,
	serializeMarkdown,
	parseFrontmatter,
	buildFrontmatter,
	assembleMarkdownFile,
} from '@/lib/markdown-io'

/**
 * The strongest guarantee: serializing a parsed doc yields the exact same
 * markdown, and parsing again yields the exact same doc. Proves the engine
 * is a stable round-trip, not a one-way transform.
 */
function expectMdRoundTrip(md: string) {
	const serialized = serializeMarkdown(parseMarkdown(md))
	expect(serialized).toBe(md)
	expect(parseMarkdown(serialized)).toEqual(parseMarkdown(md))
}

describe('parseMarkdown / serializeMarkdown — block round-trip stability', () => {
	it('round-trips headings', () => {
		expectMdRoundTrip('# Title\n\n## Section\n\n### Subsection\n')
	})

	it('round-trips paragraphs and inline marks', () => {
		expectMdRoundTrip('Some **bold**, *italic*, ~~strike~~, and `inline code` text.\n')
	})

	it('round-trips a paragraph with inline code and code spanning', () => {
		expectMdRoundTrip('Run `npm run build` to verify.\n')
	})

	it('round-trips links with url and title', () => {
		expectMdRoundTrip('See the [docs](https://example.com) for details.\n')
	})

	it('round-trips hard breaks', () => {
		// Backslash-newline is the canonical hard-break serialization the
		// engine produces (two-trailing-space input normalizes to it).
		expectMdRoundTrip('line one\\\nline two\n')
	})

	it('round-trips horizontal rules', () => {
		expectMdRoundTrip('Above\n\n---\n\nBelow\n')
	})

	it('round-trips bullet lists', () => {
		expectMdRoundTrip('- item one\n- item two\n- item three\n')
	})

	it('round-trips ordered lists', () => {
		expectMdRoundTrip('1. first\n2. second\n3. third\n')
	})

	it('round-trips nested bullet lists', () => {
		expectMdRoundTrip('- parent\n  - child one\n  - child two\n- sibling\n')
	})

	it('round-trips task lists (checked and unchecked)', () => {
		expectMdRoundTrip('- [ ] todo item\n\n- [x] done item\n')
	})

	it('round-trips blockquotes', () => {
		expectMdRoundTrip('> A blockquote line\n>\n> Second paragraph\n')
	})

	it('round-trips fenced code blocks with a language', () => {
		expectMdRoundTrip('```ts\nconst x: number = 1\nconsole.log(x)\n```\n')
	})

	it('round-trips fenced code blocks without a language', () => {
		expectMdRoundTrip('```\nplain code\n```\n')
	})

	it('round-trips GFM tables', () => {
		expectMdRoundTrip('| Name | Role |\n| --- | --- |\n| Alice | Writer |\n| Bob | Editor |\n')
	})

	it('round-trips images', () => {
		expectMdRoundTrip('Here is a picture: ![alt text](https://example.com/image.png)\n')
	})

	it('round-trips an empty document', () => {
		const doc = parseMarkdown('')
		expect(serializeMarkdown(doc)).toBe('')
		expect(parseMarkdown('')).toEqual(doc)
	})

	it('is stable across repeated serialize(parse()) applications', () => {
		const md = '# Heading\n\nSome **bold** and [a link](https://example.com).\n\n- one\n- two\n'
		const once = serializeMarkdown(parseMarkdown(md))
		const twice = serializeMarkdown(parseMarkdown(once))
		expect(twice).toBe(once)
	})
})

describe('inline HTML preservation', () => {
	it('preserves raw inline HTML through serialization', () => {
		const md = 'A <span style="color: red">colored</span> word.\n'
		const serialized = serializeMarkdown(parseMarkdown(md))
		expect(serialized).toContain('<span')
		expect(serialized).toContain('colored</span>')
		// Stability: re-parsing the serialized output yields the same doc.
		expect(parseMarkdown(serialized)).toEqual(parseMarkdown(md))
	})
})

describe('serializeMarkdown on hand-built docs', () => {
	it('serializes a heading doc', () => {
		const md = serializeMarkdown({
			type: 'doc',
			content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Sub' }] }],
		})
		expect(md).toBe('## Sub\n')
	})
})

describe('parseFrontmatter — frontmatter ↔ properties mapping', () => {
	it('extracts reserved title/tags and keeps the rest as properties', () => {
		const { data, body } = parseFrontmatter('---\ntitle: My Note\ntags: [work, ai]\nauthor: Harsh\n---\nBody text\n')
		expect(data.title).toBe('My Note')
		expect(data.tags).toEqual(['work', 'ai'])
		expect(data.properties).toEqual({ author: 'Harsh' })
		expect(body).toBe('Body text\n')
	})

	it('normalizes a single string tag into an array', () => {
		const { data } = parseFrontmatter('---\ntags: work\n---\nBody\n')
		expect(data.tags).toEqual(['work'])
	})

	it('round-trips primitives, arrays, and nested objects', () => {
		const file = '---\ncount: 3\nratio: 0.5\nactive: true\nlist:\n  - a\n  - b\nmeta:\n  priority: high\n  level: 2\n---\nBody\n'
		const { data } = parseFrontmatter(file)
		expect(data.properties).toEqual({ count: 3, ratio: 0.5, active: true, list: ['a', 'b'], meta: { priority: 'high', level: 2 } })
	})

	it('handles a markdown body with no frontmatter', () => {
		const { data, body } = parseFrontmatter('Just a body\n')
		expect(data.properties).toEqual({})
		expect(data.title).toBeUndefined()
		expect(data.tags).toBeUndefined()
		expect(body).toBe('Just a body\n')
	})

	it('handles an empty frontmatter block', () => {
		const { data, body } = parseFrontmatter('---\n---\nBody\n')
		expect(data.properties).toEqual({})
		expect(body).toBe('Body\n')
	})
})

describe('buildFrontmatter / assembleMarkdownFile', () => {
	it('builds YAML with reserved keys written once and properties spread', () => {
		const yaml = buildFrontmatter({
			title: 'My Note',
			tags: ['work', 'ai'],
			properties: { author: 'Harsh', count: 3 },
		})
		expect(yaml).toContain('title: My Note')
		expect(yaml).toContain('tags:')
		expect(yaml).toContain('- work')
		expect(yaml).toContain('author: Harsh')
		expect(yaml).toContain('count: 3')
	})

	it('returns null when there is no meta to serialize', () => {
		expect(buildFrontmatter({ properties: {} })).toBeNull()
	})

	it('lets reserved keys win over conflicting properties', () => {
		const yaml = buildFrontmatter({
			title: 'Real Title',
			tags: ['real'],
			properties: { title: 'fake', tags: ['fake'], other: 1 },
		})
		expect(yaml).toContain('title: Real Title')
		expect(yaml).not.toContain('title: fake')
		expect(yaml).not.toContain('tags: [fake]')
		expect(yaml).toContain('other: 1')
	})

	it('drops reserved keys that live only in properties', () => {
		const yaml = buildFrontmatter({
			properties: { title: 'fake', tags: ['fake'], other: 1 },
		})
		expect(yaml).not.toContain('title: fake')
		expect(yaml).not.toContain('tags:')
		expect(yaml).toContain('other: 1')
	})

	it('omits properties-only reserved keys from assembled files', () => {
		const file = assembleMarkdownFile({ properties: { title: 'fake', tags: ['fake'], other: 1 } }, 'Body\n')
		expect(file).not.toContain('title: fake')
		expect(file).not.toContain('tags:')
		expect(file).toContain('other: 1')
		expect(file).toContain('Body\n')
	})

	it('passes through the body when no meta keys exist', () => {
		expect(assembleMarkdownFile({ properties: {} }, 'Body text\n')).toBe('Body text\n')
	})

	it('assembleMarkdownFile round-trips with parseFrontmatter', () => {
		const meta = {
			title: 'My Note',
			tags: ['work', 'ai'],
			properties: { author: 'Harsh', count: 3, meta: { priority: 'high' } },
		}
		const body = '# Heading\n\nBody text\n'
		const file = assembleMarkdownFile(meta, body)
		expect(file).toContain('---\n')

		const { data, body: reparsedBody } = parseFrontmatter(file)
		expect(data).toEqual(meta)
		expect(reparsedBody).toBe(body)
	})
})

describe('end-to-end: a full markdown file round-trips', () => {
	it('frontmatter + markdown body survive the full engine', () => {
		const file = [
			'---',
			'title: My Note',
			'tags:',
			'  - work',
			'  - ai',
			'author: Harsh',
			'meta:',
			'  priority: high',
			'---',
			'',
			'# Heading',
			'',
			'Some **bold** and *italic* text with a [link](https://example.com).',
			'',
			'- item one',
			'- item two',
			'',
			'> a quote',
			'',
			'```ts',
			'const x = 1',
			'```',
			'',
		].join('\n')

		const { data, body } = parseFrontmatter(file)
		expect(data.title).toBe('My Note')
		expect(data.tags).toEqual(['work', 'ai'])
		expect(data.properties).toEqual({ author: 'Harsh', meta: { priority: 'high' } })

		const serializedBody = serializeMarkdown(parseMarkdown(body))
		const rebuilt = assembleMarkdownFile(data, serializedBody)

		const reparsed = parseFrontmatter(rebuilt)
		expect(reparsed.data).toEqual(data)
		expect(reparsed.body).toBe(serializedBody)

		const reparsedDoc = parseMarkdown(reparsed.body)
		expect(reparsedDoc).toEqual(parseMarkdown(serializedBody))
	})
})
