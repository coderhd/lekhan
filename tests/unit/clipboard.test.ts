import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { MarkdownEngine } from '@/lib/markdown/engine'
import { serializeNotionHtml } from '@/lib/markdown/notion-html'
import { buildClipboardPayload, writeClipboardPayload } from '@/lib/markdown/clipboard'

// ---------------------------------------------------------------------------
// SIL-9 S3 — Clipboard copy-out. Seams: (2) Obsidian profile on the engine,
// (3) clipboard payload builder + Notion HTML serializer.
// ---------------------------------------------------------------------------

const CORPUS: Array<{ name: string; markdown: string }> = [
	{ name: 'heading', markdown: '# Title\n\n## Section\n' },
	{ name: 'inline marks', markdown: 'Some **bold**, *italic*, ~~strike~~, and `code` text.\n' },
	{ name: 'external link', markdown: 'See the [docs](https://example.com) for details.\n' },
	{ name: 'bullet list', markdown: '- item one\n- item two\n- item three\n' },
	{ name: 'ordered list', markdown: '1. first\n2. second\n3. third\n' },
	{ name: 'task list', markdown: '- [ ] todo item\n\n- [x] done item\n' },
	{ name: 'blockquote', markdown: '> A blockquote line\n>\n> Second paragraph\n' },
	{ name: 'code block', markdown: '```ts\nconst x: number = 1\nconsole.log(x)\n```\n' },
	{ name: 'table', markdown: '| Name | Role |\n| --- | --- |\n| Alice | Writer |\n| Bob | Editor |\n' },
	{ name: 'callout', markdown: '> [!note] A title\n> Body line one\n>\n> Body line two\n' },
	{ name: 'wikilink', markdown: 'See [[Alpha]] and [[Beta|the beta]].\n' },
	{ name: 'inline tags', markdown: 'Tagged #work and #ai here.\n' },
	{ name: 'image', markdown: 'Here is a picture: ![alt text](https://example.com/image.png)\n' },
	{ name: 'horizontal rule', markdown: 'Above\n\n---\n\nBelow\n' },
]

describe('Obsidian profile — serializeObsidianBody round-trip (seam 2)', () => {
	let engine: MarkdownEngine
	beforeEach(() => { engine = new MarkdownEngine() })
	afterEach(() => engine.destroy())

	it('round-trips every construct in the corpus to the same IR', () => {
		for (const { name, markdown } of CORPUS) {
			const doc = engine.parse(markdown)
			const body = engine.serializeObsidianBody(doc)
			// IR identity: paste-out -> paste-in is the same document.
			expect(engine.parse(body), name).toEqual(doc)
		}
	})

	it('is idempotent across repeated serialize(parse())', () => {
		for (const { name, markdown } of CORPUS) {
			const first = engine.serializeObsidianBody(engine.parse(markdown))
			const second = engine.serializeObsidianBody(engine.parse(first))
			expect(second, name).toBe(first)
		}
	})

	it('preserves wikilinks, callout markers, and inline tags verbatim', () => {
		const doc = engine.parse('See [[Alpha]] and [[Beta|the beta]] #work.\n\n> [!warning] Careful\n> Body\n')
		const body = engine.serializeObsidianBody(doc)
		expect(body).toContain('[[Alpha]]')
		expect(body).toContain('[[Beta|the beta]]')
		expect(body).toContain('#work')
		expect(body).toMatch(/> \[!warning\](?:^|\s)/m)
	})

	it('strips the placeholder title heading from a live-shaped doc', () => {
		// Live docs open with a `heading block*` title; the profile carries the
		// title in frontmatter, not as a duplicated body heading.
		const doc = {
			type: 'doc',
			content: [
				{ type: 'heading', attrs: { level: 1 }, content: [] },
				{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
			],
		}
		expect(engine.serializeObsidianBody(doc as never)).toBe('Body\n')
	})

	it('assembles frontmatter from Page properties in serializeObsidianPage', () => {
		const doc = engine.parse('# Title\n\nBody with [[Link]].\n')
		const file = engine.serializeObsidianPage(doc, {
			title: 'My Page',
			tags: ['a', 'b'],
			properties: { author: 'Harsh', status: 'draft' },
		})
		const { data, body } = engine.parseFrontmatter(file)
		expect(data.title).toBe('My Page')
		expect(data.tags).toEqual(['a', 'b'])
		expect(data.properties).toEqual({ author: 'Harsh', status: 'draft' })
		expect(body).toContain('[[Link]]')
		expect(engine.parse(body)).toEqual(engine.parse('# Title\n\nBody with [[Link]].\n'))
	})

	it('omits frontmatter when the Page has no meta', () => {
		const doc = engine.parse('Just a body.\n')
		expect(engine.serializeObsidianPage(doc, { properties: {} })).toBe('Just a body.\n')
	})
})

describe('serializeNotionHtml — Notion paste constructs (seam 3)', () => {
	let engine: MarkdownEngine
	beforeEach(() => { engine = new MarkdownEngine() })
	afterEach(() => engine.destroy())

	const htmlFor = (markdown: string) => serializeNotionHtml(engine.parse(markdown))

	it('emits real heading elements', () => {
		const html = htmlFor('# One\n\n## Two\n\n### Three\n')
		expect(html).toContain('<h1>One</h1>')
		expect(html).toContain('<h2>Two</h2>')
		expect(html).toContain('<h3>Three</h3>')
	})

	it('emits inline marks', () => {
		const html = htmlFor('**bold** *italic* ~~strike~~ `code`\n')
		expect(html).toContain('<strong>bold</strong>')
		expect(html).toContain('<em>italic</em>')
		expect(html).toContain('<s>strike</s>')
		expect(html).toContain('<code>code</code>')
	})

	it('emits genuine anchor links for real URLs', () => {
		const html = htmlFor('See [docs](https://example.com) now.\n')
		expect(html).toContain('<a href="https://example.com">docs</a>')
	})

	it('emits lists and task-list checkboxes', () => {
		const bullets = htmlFor('- one\n- two\n')
		expect(bullets).toBe('<ul><li><p>one</p></li><li><p>two</p></li></ul>')
		const tasks = htmlFor('- [ ] todo\n- [x] done\n')
		expect(tasks).toContain('<input type="checkbox" disabled>')
		expect(tasks).toContain('<input type="checkbox" disabled checked>')
	})

	it('emits callouts as blockquotes with a bold title', () => {
		const html = htmlFor('> [!warning] Careful\n> Body\n')
		expect(html).toContain('<blockquote')
		expect(html).toContain('callout-warning')
		expect(html).toContain('<strong>Careful</strong>')
		expect(html).toContain('Body')
	})

	it('emits tables', () => {
		const html = htmlFor('| Name | Role |\n| --- | --- |\n| Alice | Writer |\n')
		expect(html).toContain('<table>')
		expect(html).toContain('<tbody>')
		expect(html).toContain('<th>')
		expect(html).toContain('<td>')
	})

	it('emits code blocks with a language class', () => {
		const html = htmlFor('```ts\nconst x = 1\n```\n')
		expect(html).toContain('<pre><code class="language-ts">const x = 1</code></pre>')
	})

	it('escapes HTML in text and attributes', () => {
		const html = serializeNotionHtml({
			type: 'doc',
			content: [{ type: 'paragraph', content: [{ type: 'text', text: '<script> & "quotes"' }] }],
		})
		expect(html).toBe('<p>&lt;script&gt; &amp; &quot;quotes&quot;</p>')
	})

	it('leaves wikilinks as literal text', () => {
		expect(htmlFor('See [[Alpha|the alpha]].\n')).toContain('[[Alpha|the alpha]]')
	})
})

describe('buildClipboardPayload — dual dialect payload (seam 3)', () => {
	let engine: MarkdownEngine
	beforeEach(() => { engine = new MarkdownEngine() })
	afterEach(() => engine.destroy())

	it('whole-Page copy carries frontmatter in text/plain and body in html', () => {
		const doc = engine.parse('# Title\n\nBody with [[Link]] and #tag.\n')
		const payload = buildClipboardPayload(
			doc,
			{ title: 'My Page', tags: ['work'], properties: { author: 'Harsh' } },
			{ wholePage: true },
		)
		expect(payload.text).toContain('title: My Page')
		expect(payload.text).toContain('tags:')
		expect(payload.text).toContain('[[Link]]')
		expect(payload.text).toContain('#tag')
		expect(payload.html).toContain('<h1>Title</h1>')
		expect(payload.html).toContain('[[Link]]')
	})

	it('partial selection omits frontmatter', () => {
		const doc = {
			type: 'doc',
			content: [{ type: 'paragraph', content: [{ type: 'text', text: 'just a selection' }] }],
		}
		const payload = buildClipboardPayload(doc as never, { title: 'My Page' }, { wholePage: false })
		expect(payload.text).not.toContain('---')
		expect(payload.text).toBe('just a selection\n')
		expect(payload.html).toBe('<p>just a selection</p>')
	})

	it('wraps leaked inline nodes in a paragraph', () => {
		const doc = {
			type: 'doc',
			content: [
				{ type: 'text', text: 'leaked inline' },
				{ type: 'paragraph', content: [{ type: 'text', text: 'block' }] },
			],
		}
		const payload = buildClipboardPayload(doc as never, {}, { wholePage: false })
		expect(payload.html).toBe('<p>leaked inline</p><p>block</p>')
		expect(payload.text).toBe('leaked inline\n\nblock\n')
	})
})

describe('writeClipboardPayload', () => {
	it('writes both MIME types', () => {
		const store: Record<string, string> = {}
		const event = {
			clipboardData: { setData: (type: string, value: string) => { store[type] = value } },
		} as unknown as ClipboardEvent
		expect(writeClipboardPayload(event, { text: 'md', html: '<p>md</p>' })).toBe(true)
		expect(store['text/plain']).toBe('md')
		expect(store['text/html']).toBe('<p>md</p>')
	})

	it('returns false without clipboardData', () => {
		const event = { clipboardData: null } as unknown as ClipboardEvent
		expect(writeClipboardPayload(event, { text: 'md', html: '<p>md</p>' })).toBe(false)
	})
})

describe('committed clipboard fixture — Obsidian Page copy-out', () => {
	let engine: MarkdownEngine
	beforeEach(() => { engine = new MarkdownEngine() })
	afterEach(() => engine.destroy())

	it('round-trips the recorded Obsidian Dialect page to the same IR', () => {
		const file = readFileSync(
			path.join(process.cwd(), 'tests/fixtures/clipboard/obsidian-page-copy.md'),
			'utf8',
		)
		const { data, body } = engine.parseFrontmatter(file)
		expect(data.title).toBe('Dual-Dialect Interop Bridge')
		expect(data.tags).toEqual(['interop', 'obsidian'])
		expect(data.properties).toEqual({ author: 'Harsh', status: 'draft' })

		const doc = engine.parse(body)
		const serialized = engine.serializeObsidianBody(doc)
		// Paste-out -> paste-in is IR-identity.
		expect(engine.parse(serialized)).toEqual(doc)
		// Obsidian-native constructs survive.
		expect(serialized).toContain('[[Obsidian]]')
		expect(serialized).toContain('[[Notion|Notion app]]')
		expect(serialized).toContain('#interop')
		expect(serialized).toContain('> [!note]')
		// Notion HTML carries the same page.
		const html = serializeNotionHtml(doc)
		expect(html).toContain('<h1>Dual-Dialect Interop Bridge</h1>')
		expect(html).toContain('<a href="https://example.com">link</a>')
		expect(html).toContain('<table>')
	})
})
