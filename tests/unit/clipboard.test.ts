import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { MarkdownEngine, restoreWikilinks } from '@/lib/markdown/engine'
import { serializeNotionHtml, sanitizeUrl } from '@/lib/markdown/notion-html'
import {
	buildClipboardPayload,
	copyClipboardPayloadToSystem,
	writeClipboardPayload,
} from '@/lib/markdown/clipboard'
import { classifyClipboardPaste } from '@/lib/markdown-paste'
import { splitObsidianFrontmatter } from '@/lib/obsidian-clipboard'

// ---------------------------------------------------------------------------
// SIL-9 S3 — Clipboard copy-out. Seams: (2) Obsidian profile on the engine,
// (3) clipboard payload builder + Notion HTML serializer.
// ---------------------------------------------------------------------------

const CORPUS: Array<{ name: string; markdown: string }> = [
	{ name: 'heading', markdown: '# Title\n\n## Section\n' },
	{ name: 'inline marks', markdown: 'Some **bold**, *italic*, ~~strike~~, and `code` text.\n' },
	{ name: 'underline', markdown: 'Some <u>underlined</u> text.\n' },
	{ name: 'external link', markdown: 'See the [docs](https://example.com) for details.\n' },
	{ name: 'bullet list', markdown: '- item one\n- item two\n- item three\n' },
	{ name: 'ordered list', markdown: '1. first\n2. second\n3. third\n' },
	{ name: 'task list', markdown: '- [ ] todo item\n\n- [x] done item\n' },
	{ name: 'blockquote', markdown: '> A blockquote line\n>\n> Second paragraph\n' },
	{ name: 'code block', markdown: '```ts\nconst x: number = 1\nconsole.log(x)\n```\n' },
	{ name: 'table', markdown: '| Name | Role |\n| --- | --- |\n| Alice | Writer |\n| Bob | Editor |\n' },
	{ name: 'table with alias wikilink', markdown: '| Page | Note |\n| --- | --- |\n| [[Beta\\|the beta]] | x |\n' },
	{ name: 'inline code with brackets', markdown: 'Use `arr[[i]]` syntax.\n' },
	{ name: 'fenced code with bracket runs', markdown: '```js\nconst re = /\\[\\[([^\\]]+)\\]\\]/g\nx = arr[[i]]\n```\n' },
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
		expect(html).toContain('<thead>')
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

describe('buildClipboardPayload — paste-target tuning (SIL-68 finding)', () => {
	let engine: MarkdownEngine
	beforeEach(() => { engine = new MarkdownEngine() })
	afterEach(() => engine.destroy())

	it('obsidian target omits the HTML payload so Obsidian pastes the markdown natively', () => {
		const doc = engine.parse('# Title\n\nBody with [[Link]].\n')
		const payload = buildClipboardPayload(doc, { title: 'My Page', tags: ['work'] }, { wholePage: true, target: 'obsidian' })
		expect(payload.text).toContain('title: My Page')
		expect(payload.text).toContain('[[Link]]')
		expect(payload.html).toBe('')
	})

	it('notion target carries the rich HTML payload', () => {
		const doc = engine.parse('# Title\n\nBody.\n')
		const payload = buildClipboardPayload(doc, {}, { wholePage: true, target: 'notion' })
		expect(payload.text).toContain('# Title')
		expect(payload.html).toContain('<h1>Title</h1>')
	})

	it('defaults to both representations (legacy behaviour)', () => {
		const doc = engine.parse('# Title\n\nBody.\n')
		expect(buildClipboardPayload(doc, {}, { wholePage: true }).html).not.toBe('')
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

	it('omits text/html for a plain-only (Obsidian) payload', () => {
		const store: Record<string, string> = {}
		const event = {
			clipboardData: { setData: (type: string, value: string) => { store[type] = value } },
		} as unknown as ClipboardEvent
		expect(writeClipboardPayload(event, { text: 'md', html: '' })).toBe(true)
		expect(store['text/plain']).toBe('md')
		expect(store['text/html']).toBeUndefined()
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

	const fixtureDir = () => path.join(process.cwd(), 'tests/fixtures/clipboard')
	const readFixture = (name: string) => readFileSync(path.join(fixtureDir(), name), 'utf8')

	it('round-trips the recorded Obsidian Dialect page to the same IR', () => {
		const file = readFixture('obsidian-page-copy.md')
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

	it('committed text/html capture is the Notion-facing serialization of the page', () => {
		const { body } = engine.parseFrontmatter(readFixture('obsidian-page-copy.md'))
		const doc = engine.parse(body)
		// The committed capture is the regression anchor for the Notion payload;
		// regenerate with buildClipboardPayload if the serializer legitimately changes.
		expect(serializeNotionHtml(doc).trim()).toBe(readFixture('obsidian-page-copy.html').trim())
	})

	it('committed combined capture carries both MIME types and round-trips paste-out -> paste-in', () => {
		const capture = JSON.parse(readFixture('obsidian-page-copy.clipboard.json')) as {
			'text/plain': string
			'text/html': string
		}
		// Both dialects are present, so the paste target picks what it understands.
		expect(capture['text/plain']).toContain('[[Notion|Notion app]]')
		expect(capture['text/plain']).toContain('> [!note]')
		expect(capture['text/html']).toContain('<h1>Dual-Dialect Interop Bridge</h1>')
		expect(capture['text/html']).toContain('<a href="https://example.com">link</a>')

		const { data, body } = engine.parseFrontmatter(capture['text/plain'])
		expect(data.title).toBe('Dual-Dialect Interop Bridge')
		const doc = engine.parse(body)
		expect(engine.parse(engine.serializeObsidianBody(doc))).toEqual(doc)
	})
})

// ---------------------------------------------------------------------------
// Round-trip guarantee — paste-out through the REAL S1 paste-in routing
// (SIL-57: classifyClipboardPaste -> splitObsidianFrontmatter -> markdown
// parser), not just engine.parse of the serialized body. This is the
// acceptance criterion as written: paste-out -> paste-in is IR identity.
// ---------------------------------------------------------------------------

describe('round-trip guarantee through S1 paste-in routing', () => {
	let engine: MarkdownEngine
	beforeEach(() => { engine = new MarkdownEngine() })
	afterEach(() => engine.destroy())

	const meta = { title: 'Page title', tags: ['work', 'ai'], properties: { status: 'draft' } }

	it('a whole-Page Obsidian copy routes to obsidian-markdown and reproduces the IR', () => {
		for (const { name, markdown } of CORPUS) {
			const doc = engine.parse(markdown)
			const payload = buildClipboardPayload(doc, meta, { wholePage: true, target: 'obsidian' })

			// Obsidian target is plain-only, so the Obsidian dialect actually reaches
			// Obsidian (the SIL-68 finding) and the classifier sees no HTML to prefer.
			expect(payload.html, name).toBe('')
			expect(classifyClipboardPaste(payload.text, undefined), name).toBe('obsidian-markdown')

			const { properties, tags, body } = splitObsidianFrontmatter(payload.text)
			expect(tags, name).toEqual(['work', 'ai'])
			expect(properties, name).toEqual({ status: 'draft', tags: ['work', 'ai'] })

			// IR identity: paste-out -> paste-in is the same document.
			expect(engine.parse(body), name).toEqual(doc)
		}
	})

	it('a Notion-target copy still round-trips into Lekhan without loss', () => {
		for (const { name, markdown } of CORPUS) {
			const doc = engine.parse(markdown)
			const payload = buildClipboardPayload(doc, meta, { wholePage: true, target: 'notion' })
			expect(payload.html, name).not.toBe('')

			// The plain-text half is the Obsidian dialect, so S1 routes Obsidian
			// signals ahead of the Notion HTML and no body content is lost.
			expect(classifyClipboardPaste(payload.text, payload.html), name).toBe('obsidian-markdown')
			const { body } = splitObsidianFrontmatter(payload.text)
			expect(engine.parse(body), name).toEqual(doc)
		}
	})

	it('a partial-selection copy carries no frontmatter and still reproduces the IR', () => {
		for (const { name, markdown } of CORPUS) {
			const doc = engine.parse(markdown)
			const payload = buildClipboardPayload(doc, meta, { wholePage: false, target: 'obsidian' })
			expect(payload.text.startsWith('---'), name).toBe(false)
			expect(engine.parse(payload.text), name).toEqual(doc)
		}
	})

	it('a Page with wikilinks, callouts, frontmatter and tags survives the full loop', () => {
		const markdown = [
			'# Bridge',
			'',
			'Links to [[Alpha]] and [[Beta|the beta]].',
			'',
			'> [!warning] Careful',
			'> Read [[Alpha]] first.',
			'',
			'Tagged #work here.',
		].join('\n')
		const doc = engine.parse(markdown)
		const payload = buildClipboardPayload(doc, meta, { wholePage: true, target: 'obsidian' })
		const { body } = splitObsidianFrontmatter(payload.text)
		const roundTripped = engine.parse(body)

		expect(roundTripped).toEqual(doc)
		expect(body).toContain('[[Alpha]]')
		expect(body).toContain('[[Beta|the beta]]')
		expect(body).toMatch(/> \[!warning\](?:^|\s)/m)
	})
})

// ---------------------------------------------------------------------------
// Clean-room review regressions (docs/reviews/pr-59-review.md)
// ---------------------------------------------------------------------------

describe('review #1 — live-shaped Page doc strips the placeholder heading once', () => {
	let engine: MarkdownEngine
	beforeEach(() => { engine = new MarkdownEngine() })
	afterEach(() => engine.destroy())

	const liveShaped = {
		type: 'doc',
		content: [
			{ type: 'heading', attrs: { level: 1 }, content: [] },
			{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
		],
	} as never

	it('does not prepend an empty heading block to the Notion HTML', () => {
		const payload = buildClipboardPayload(liveShaped, { title: 'My Page', tags: ['x'] }, {
			wholePage: true,
			target: 'notion',
		})
		expect(payload.html).not.toContain('<h1></h1>')
		expect(payload.html).toBe('<p>Body</p>')
		expect(payload.text).not.toMatch(/^#\s/m)
		expect(payload.text).toContain('title: My Page')
	})

	it('does not prepend an empty heading to the Obsidian markdown', () => {
		const payload = buildClipboardPayload(liveShaped, { title: 'My Page' }, {
			wholePage: true,
			target: 'obsidian',
		})
		expect(payload.text.endsWith('Body\n')).toBe(true)
	})
})

describe('review #2/#6 — restoreWikilinks is table- and code-aware', () => {
	let engine: MarkdownEngine
	beforeEach(() => { engine = new MarkdownEngine() })
	afterEach(() => engine.destroy())

	it('keeps the alias pipe escaped inside a table row', () => {
		const doc = engine.parse('| Page | Note |\n| --- | --- |\n| [[Beta\\|the beta]] | x |\n')
		const body = engine.serializeObsidianBody(doc)
		expect(body).toContain('[[Beta\\|the beta]]')
		expect(engine.parse(body)).toEqual(doc)
	})

	it('never rewrites bracketed source code', () => {
		const inline = engine.parse('Use `arr[[i]]` syntax.\n')
		expect(engine.serializeObsidianBody(inline)).toContain('`arr[[i]]`')

		const fenced = engine.parse('```js\nconst re = /\\[\\[([^\\]]+)\\]\\]/g\nx = arr[[i]]\n```\n')
		const body = engine.serializeObsidianBody(fenced)
		expect(body).toContain('arr[[i]]')
		expect(engine.parse(body)).toEqual(fenced)
	})

	it('still restores a plain wikilink and its alias in prose', () => {
		const doc = engine.parse('See [[Alpha]] and [[Beta|the beta]].\n')
		const body = engine.serializeObsidianBody(doc)
		expect(body).toContain('[[Alpha]]')
		expect(body).toContain('[[Beta|the beta]]')
		expect(engine.parse(body)).toEqual(doc)
	})
})

describe('review #9 — Notion HTML only emits safe URL schemes', () => {
	let engine: MarkdownEngine
	beforeEach(() => { engine = new MarkdownEngine() })
	afterEach(() => engine.destroy())

	it('allows http(s), mailto, obsidian and relative URLs', () => {
		expect(sanitizeUrl('https://example.com', 'link')).toBe('https://example.com')
		expect(sanitizeUrl('mailto:a@b.test', 'link')).toBe('mailto:a@b.test')
		expect(sanitizeUrl('obsidian://open?vault=x', 'link')).toBe('obsidian://open?vault=x')
		expect(sanitizeUrl('/page/abc', 'link')).toBe('/page/abc')
		expect(sanitizeUrl('#anchor', 'link')).toBe('#anchor')
	})

	it('drops scriptable link and image URLs but keeps the text', () => {
		expect(sanitizeUrl('javascript:alert(1)', 'link')).toBe('')
		expect(sanitizeUrl('data:text/html,<script>', 'link')).toBe('')
		expect(sanitizeUrl('javascript:alert(1)', 'image')).toBe('')
		expect(sanitizeUrl('data:image/png;base64,AAA', 'image')).toBe('data:image/png;base64,AAA')

		const doc = {
			type: 'doc',
			content: [{
				type: 'paragraph',
				content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }],
			}],
		} as never
		const html = serializeNotionHtml(doc)
		expect(html).not.toContain('javascript:')
		expect(html).toContain('click')
	})
})

describe('review #12 — empty title is omitted from frontmatter', () => {
	let engine: MarkdownEngine
	beforeEach(() => { engine = new MarkdownEngine() })
	afterEach(() => engine.destroy())

	it('does not emit an empty title key', () => {
		const doc = engine.parse('Body\n')
		const text = engine.serializeObsidianPage(doc, { title: '   ', properties: {} })
		expect(text).not.toContain('title:')
		expect(text.startsWith('---')).toBe(false)
	})
})

describe('review #5 — highlight contract (HTML-in-markdown on the plain-text side)', () => {
	let engine: MarkdownEngine
	beforeEach(() => { engine = new MarkdownEngine() })
	afterEach(() => engine.destroy())

	const highlighted = {
		type: 'doc',
		content: [{
			type: 'paragraph',
			content: [{ type: 'text', text: 'plain ', marks: [{ type: 'highlight' }] }, { type: 'text', text: 'marked', marks: [{ type: 'highlight' }] }],
		}],
	} as never

	it('renders <mark> in the Notion HTML', () => {
		expect(serializeNotionHtml(highlighted)).toContain('<mark>')
	})

	it('emits <mark> HTML in the Obsidian markdown (valid in Obsidian)', () => {
		// Spec §5 wording: highlight has no Obsidian `==…==` equivalent on the
		// serializer path, so the plain-text side carries HTML — which Obsidian
		// renders — and is documented as such rather than promised as `==`.
		expect(engine.serializeObsidianBody(highlighted)).toContain('<mark>')
	})
})

describe('review #8 — plain-text fallback when the rich clipboard write fails', () => {
	afterEach(() => { vi.unstubAllGlobals() })

	it('falls back to writeText when the rich write is rejected', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined)
		const write = vi.fn().mockRejectedValue(new Error('denied'))
		vi.stubGlobal('navigator', { clipboard: { write, writeText } })
		vi.stubGlobal('ClipboardItem', class { constructor(public items: unknown) {} })

		const ok = await copyClipboardPayloadToSystem({ text: 'plain md', html: '<p>rich</p>' })
		expect(ok).toBe(true)
		expect(write).toHaveBeenCalledTimes(1)
		expect(writeText).toHaveBeenCalledWith('plain md')
	})

	it('uses writeText directly for a plain-only payload', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined)
		const write = vi.fn()
		vi.stubGlobal('navigator', { clipboard: { write, writeText } })

		const ok = await copyClipboardPayloadToSystem({ text: 'plain md', html: '' })
		expect(ok).toBe(true)
		expect(write).not.toHaveBeenCalled()
		expect(writeText).toHaveBeenCalledWith('plain md')
	})
})

describe('round 2 review nits — URL scheme bypass, blockquoted tables, long fences', () => {
	let engine: MarkdownEngine
	beforeEach(() => { engine = new MarkdownEngine() })
	afterEach(() => engine.destroy())

	it('rejects a scheme split by tab/newline control characters', () => {
		expect(sanitizeUrl('java\tscript:alert(1)', 'link')).toBe('')
		expect(sanitizeUrl('java\nscript:alert(1)', 'link')).toBe('')
		expect(sanitizeUrl('vbscript:msgbox(1)', 'link')).toBe('')
		// A genuine URL is still passed through untouched.
		expect(sanitizeUrl('https://example.com/a?b=1', 'link')).toBe('https://example.com/a?b=1')
	})

	it('keeps the alias pipe escaped in a blockquoted table row', () => {
		const md = '> | Page | Note |\n> | --- | --- |\n> | [[Beta\\|the beta]] | x |\n'
		const doc = engine.parse(md)
		const body = engine.serializeObsidianBody(doc)
		expect(body).toContain('[[Beta\\|the beta]]')
		expect(engine.parse(body)).toEqual(doc)
	})

	it('does not treat a shorter fence inside a longer fence as the close', () => {
		// Unit-level: the serializer has a pre-existing limitation emitting a
		// fence run that contains backticks, so assert the restore pass itself —
		// code between a 4-backtick open and its close is never rewritten, and a
		// 3-backtick line inside does not end the block.
		const md = '````md\n\\[\\[Inside\\]\\]\n```\n\\[\\[StillInside\\]\\]\n````\n\\[\\[Outside\\]\\]\n'
		expect(restoreWikilinks(md)).toBe(
			'````md\n\\[\\[Inside\\]\\]\n```\n\\[\\[StillInside\\]\\]\n````\n[[Outside]]\n',
		)
	})
})
