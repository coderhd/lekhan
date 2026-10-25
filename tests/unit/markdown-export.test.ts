import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
	slugifyTitle,
	exportFilename,
	resolveTags,
	buildMarkdownExport,
	serializeExportBodyMarkdown,
	serializeExportBodyHtml,
	buildStandaloneHtml,
} from '@/lib/markdown-export'
import { MarkdownEngine } from '@/lib/markdown/engine'
import { CALLOUT_TYPES } from '@/lib/callout'

let engine: MarkdownEngine

function stylesheetOf(html: string): string {
	return html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? ''
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

beforeEach(() => {
	engine = new MarkdownEngine()
})

afterEach(() => {
	engine.destroy()
})

describe('slugifyTitle', () => {
	it('lowercases and hyphenates spaces', () => {
		expect(slugifyTitle('My Awesome Page')).toBe('my-awesome-page')
	})

	it('strips punctuation and collapses separators', () => {
		expect(slugifyTitle('Hello, World!')).toBe('hello-world')
		expect(slugifyTitle('Version 2.0 — release')).toBe('version-2-0-release')
	})

	it('keeps non-Latin letters and digits', () => {
		expect(slugifyTitle('मेरी नोट्स')).toBe('मेरी-नोट्स')
		expect(slugifyTitle('日本語のページ')).toBe('日本語のページ')
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

describe('exportFilename', () => {
	it('appends the extension to a slugified title', () => {
		expect(exportFilename('My Page', 'md')).toBe('my-page.md')
		expect(exportFilename('My Page', 'html')).toBe('my-page.html')
	})

	it('slugs the title before naming the file', () => {
		expect(exportFilename('Meeting Notes: 2026!', 'md')).toBe('meeting-notes-2026.md')
		expect(exportFilename('Meeting Notes: 2026!', 'html')).toBe('meeting-notes-2026.html')
		expect(exportFilename('मेरी नोट्स', 'html')).toBe('मेरी-नोट्स.html')
	})

	it('falls back to untitled for an empty title', () => {
		expect(exportFilename('', 'html')).toBe('untitled.html')
		expect(exportFilename('   ', 'html')).toBe('untitled.html')
		expect(exportFilename('', 'md')).toBe('untitled.md')
	})
})

describe('resolveTags', () => {
	it('prefers page_tags over the properties mirror', () => {
		expect(resolveTags(['real'], { tags: ['mirror'] })).toEqual(['real'])
	})

	it('ignores blank page_tags and falls back to the properties mirror', () => {
		expect(resolveTags([''], { tags: ['fallback'] })).toEqual(['fallback'])
		expect(resolveTags(['   '], { tags: ['fallback'] })).toEqual(['fallback'])
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

describe('serializeExportBodyMarkdown', () => {
	it('strips the auto-filled empty leading heading', () => {
		const body = serializeExportBodyMarkdown({
			type: 'doc',
			content: [{ type: 'heading', attrs: { level: 1 }, content: [] }],
		})
		expect(body).toBe('')
	})

	it('strips an empty leading heading but keeps following blocks', () => {
		const body = serializeExportBodyMarkdown({
			type: 'doc',
			content: [
				{ type: 'heading', attrs: { level: 1 }, content: [] },
				{ type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] },
			],
		})
		expect(body).toBe('Body text\n')
	})

	it('keeps a non-empty leading heading', () => {
		const body = serializeExportBodyMarkdown({
			type: 'doc',
			content: [
				{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'My Notes' }] },
				{ type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] },
			],
		})
		expect(body).toBe('# My Notes\n\nBody text\n')
	})

	it('passes through docs without a heading', () => {
		const body = serializeExportBodyMarkdown({
			type: 'doc',
			content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] }],
		})
		expect(body).toBe('Body text\n')
	})

	it('strips a trailing empty heading (live-schema fill artifact) alongside the leading one', () => {
		const body = serializeExportBodyMarkdown({
			type: 'doc',
			content: [
				{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'My Notes' }] },
				{ type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] },
				{ type: 'heading', attrs: { level: 1 }, content: [] },
			],
		})
		expect(body).toBe('# My Notes\n\nBody text\n')
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
		const { data } = engine.parseFrontmatter(file)
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
		const { data, body } = engine.parseFrontmatter(file)
		expect(data.title).toBe('My Page')
		expect(data.tags).toEqual(['notes', 'work'])
		expect(data.properties).toEqual({ author: 'Harsh', count: 3 })
		expect(body.trim()).toBe('# Heading\n\nSome **bold** text.')
	})
})

describe('serializeExportBodyMarkdown (markdown body)', () => {
	it('produces the markdown body the .md export assembles', () => {
		const doc = engine.parse('# Heading\n\nSome **bold** and [a link](https://example.com).')
		const file = buildMarkdownExport({ title: 'My Page', properties: {}, pageTags: [], body: serializeExportBodyMarkdown(doc) })
		expect(file).toMatch(/^---\n/)
		expect(file).toContain('# Heading')
		expect(file).toContain('**bold**')
	})

	it('preserves editor-representable inline HTML (mark-rendered spans)', () => {
		const doc = engine.parse('A <span style="color: red">colored</span> word.')
		expect(serializeExportBodyMarkdown(doc)).toContain('<span style="color: red;">colored</span>')
	})

	it('keeps a mention node as inline HTML instead of dropping the body', () => {
		const md = serializeExportBodyMarkdown({
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'Assigned to ' },
						{ type: 'mention', attrs: { id: 'user-1', label: 'Alice' } },
					],
				},
			],
		})
		expect(md).toContain('@Alice')
		expect(md).toContain('mention')
	})
})

describe('serializeExportBodyHtml', () => {
	it('serializes the doc to HTML, stripping the auto-filled empty leading heading', () => {
		const html = serializeExportBodyHtml({
			type: 'doc',
			content: [
				{ type: 'heading', attrs: { level: 1 }, content: [] },
				{ type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] },
			],
		})
		expect(html).toContain('<p>Body text</p>')
		expect(html).not.toContain('<h1>')
	})

	it('keeps a non-empty leading heading', () => {
		const html = serializeExportBodyHtml({
			type: 'doc',
			content: [
				{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'My Notes' }] },
				{ type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] },
			],
		})
		expect(html).toContain('<h1>My Notes</h1>')
		expect(html).toContain('<p>Body text</p>')
	})

	it('serializes a mention node without throwing', () => {
		const html = serializeExportBodyHtml({
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'Assigned to ' },
						{ type: 'mention', attrs: { id: 'user-1', label: 'Alice' } },
						{ type: 'text', text: '.' },
					],
				},
			],
		})
		expect(html).toContain('@Alice')
		expect(html).toContain('mention')
	})

	it('renders editor marks as HTML elements', () => {
		const html = serializeExportBodyHtml({
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'Some ', marks: [{ type: 'bold' }] },
						{ type: 'text', text: 'bold' },
						{ type: 'text', text: ' text.', marks: [{ type: 'bold' }] },
					],
				},
			],
		})
		expect(html).toContain('<strong>Some </strong>bold<strong> text.</strong>')
	})
})

describe('buildStandaloneHtml stylesheet', () => {
	it('ships a self-contained stylesheet with no external resources', () => {
		const out = buildStandaloneHtml('<p>Hello</p>', 'Offline Page')
		const style = stylesheetOf(out)

		expect(style).not.toBe('')
		expect(out).not.toMatch(/<link\b/i)
		expect(out).not.toMatch(/<script\b/i)
		expect(style).not.toMatch(/@import|@font-face/i)
		expect(style).not.toMatch(/url\(\s*(?!['"]?data:)/i)
		expect(style).not.toContain('http://')
		expect(style).not.toContain('https://')
	})

	it('parses as valid CSS with no empty style rules', () => {
		const style = stylesheetOf(buildStandaloneHtml('', 'CSS'))
		const el = document.createElement('style')
		el.textContent = style
		document.head.appendChild(el)

		try {
			const sheet = el.sheet
			expect(sheet).not.toBeNull()
			const rules = Array.from(sheet?.cssRules ?? [])
			expect(rules.length).toBeGreaterThan(0)
			const emptyRules = rules.filter(
				(rule) => 'selectorText' in rule && (rule as CSSStyleRule).style.length === 0,
			)
			expect(emptyRules).toHaveLength(0)
		} finally {
			el.remove()
		}
	})

	it('defines a rule for every block node the editor can export', () => {
		const style = stylesheetOf(buildStandaloneHtml('', 'Blocks'))
		const selectors = [
			'h1',
			'h2',
			'h3',
			'h4',
			'h5',
			'h6',
			'p',
			'ul',
			'ol',
			'blockquote',
			'ul[data-type="taskList"]',
			'input[type="checkbox"]',
			'pre',
			'code',
			'table',
			'th',
			'td',
			'hr',
			'img',
			'a',
		]

		for (const selector of selectors) {
			expect(style, `missing CSS rule for ${selector}`).toMatch(
				new RegExp(`${escapeRegExp(selector)}\\s*(?:,|\\{)`),
			)
		}
	})

	it('styles every callout type and the collapsed state', () => {
		const style = stylesheetOf(buildStandaloneHtml('', 'Callouts'))

		expect(style).toMatch(/\.callout\s*\{[^}]*--callout-accent/)
		expect(style).toMatch(/\.callout-title\s*\{/)
		for (const type of CALLOUT_TYPES) {
			expect(style, `missing accent for ${type}`).toMatch(
				new RegExp(`\\.callout-${escapeRegExp(type)}\\s*(?:,|\\{)`),
			)
		}
		expect(style).toMatch(
			/\.callout\[data-callout-collapsed="true"\]\s+\.callout-content\s*\{\s*display:\s*none/,
		)
	})

	it('gives an untitled callout a visible type title, even when collapsed', () => {
		const doc = engine.parse('> [!warning]-\n> hidden body\n')
		const body = serializeExportBodyHtml(doc)
		const out = buildStandaloneHtml(body, 'Untitled callout')
		const style = stylesheetOf(out)

		expect(body).toContain('<div class="callout-title">Warning</div>')
		expect(body).toContain('data-callout-collapsed="true"')
		expect(body).not.toContain('callout-title"></div>')
		// A printed page cannot expand a collapsed callout.
		expect(style).toContain('.callout[data-callout-collapsed="true"] .callout-content { display: block; }')
	})

	it('gives an unknown callout type a readable fallback title', () => {
		const body = serializeExportBodyHtml(engine.parse('> [!custom]\n> body\n'))
		expect(body).toContain('<div class="callout-title">Custom</div>')
	})

	it('exports a callout whose title attr is null', () => {
		const body = serializeExportBodyHtml({
			type: 'doc',
			content: [
				{
					type: 'callout',
					attrs: { type: 'warning', title: null, collapsed: false },
					content: [{ type: 'paragraph', content: [{ type: 'text', text: 'body' }] }],
				},
			],
		})
		expect(body).toContain('<div class="callout-title">Warning</div>')
	})

	it('exports a custom callout type that collides with an inherited object key', () => {
		for (const type of ['constructor', 'toString', 'hasOwnProperty']) {
			const body = serializeExportBodyHtml({
				type: 'doc',
				content: [
					{
						type: 'callout',
						attrs: { type, title: '', collapsed: false },
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'body' }] }],
					},
				],
			})
			expect(body, `export failed for ${type}`).toMatch(
				new RegExp(`<div class="callout-title">${type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()}</div>`),
			)
		}
	})

	it('keeps wide tables in an internal scroll container at narrow widths', () => {
		const style = stylesheetOf(buildStandaloneHtml('', 'Tables'))

		// The wrapper scrolls; the table itself stays a table so `thead`/`tbody`
		// share one column grid instead of laying out as separate tables.
		expect(style).toMatch(/\.table-scroll\s*\{[^}]*overflow-x:\s*auto/)
		expect(style).toMatch(/table\s*\{[^}]*border-collapse:\s*collapse/)
		expect(style).not.toMatch(/table\s*\{[^}]*display:\s*block/)
		expect(style).not.toMatch(/table\s+>\s*thead[^{]*\{[^}]*display:\s*table/)
	})

	it('wraps serialized tables in the scroll container', () => {
		const body = serializeExportBodyHtml(
			engine.parse('| Column | Value |\n| --- | --- |\n| A | 1 |\n'),
		)

		expect(body).toMatch(/<div class="table-scroll"><table[\s\S]*<\/table><\/div>/)
		expect(body.match(/<table\b/g)).toHaveLength(1)
	})

	it('limits task-item flex layout to direct children of a task list', () => {
		const style = stylesheetOf(buildStandaloneHtml('', 'Tasks'))

		expect(style).toMatch(/ul\[data-type="taskList"\]\s*>\s*li\s*\{[^}]*display:\s*flex/)
		expect(style).not.toMatch(/ul\[data-type="taskList"\]\s+li\s*\{/)
	})

	it('disables exported task checkboxes and labels their state', () => {
		const body = serializeExportBodyHtml(engine.parse('- [ ] open task\n- [x] done task\n'))
		const inputs = body.match(/<input type="checkbox"[^>]*>/g) ?? []

		expect(inputs).toHaveLength(2)
		expect(inputs[0]).toContain('disabled')
		expect(inputs[0]).toContain('aria-label="Not completed"')
		expect(inputs[1]).toContain('disabled')
		expect(inputs[1]).toContain('aria-label="Completed"')
	})

	it('styles a fully serialized page: headings, tasks, code, quote, callout, table and rule', () => {
		const markdown = [
			'# Export title',
			'',
			'A paragraph with **bold** text and `inline code`.',
			'',
			'- bullet one',
			'- bullet two',
			'',
			'1. first step',
			'2. second step',
			'',
			'- [ ] open task',
			'- [x] done task',
			'',
			'```ts',
			'const answer = 42',
			'```',
			'',
			'> A quoted line',
			'',
			'> [!tip] Helpful title',
			'> Callout body',
			'',
			'| Column | Value |',
			'| --- | --- |',
			'| A | 1 |',
			'',
			'---',
		].join('\n')

		const body = serializeExportBodyHtml(engine.parse(markdown))
		const out = buildStandaloneHtml(body, 'Export title')

		expect(body).toContain('<h1>Export title</h1>')
		expect(body).toContain('<p>A paragraph with <strong>bold</strong> text and <code>inline code</code>.</p>')
		expect(body).toMatch(/<ul[ >]/)
		expect(body).toMatch(/<ol[ >]/)
		expect(body).toContain('data-type="taskList"')
		expect(body).toContain('data-checked="true"')
		expect(body).toMatch(/<input type="checkbox"[^>]*disabled/)
		expect(body).toContain('<pre>')
		expect(body).toContain('<blockquote>')
		expect(body).toContain('callout callout-tip')
		expect(body).toContain('callout-title')
		expect(body).toMatch(/<table[ >]/)
		expect(body).toContain('<hr>')
		expect(out).toContain('<style>')
	})
})

describe('buildStandaloneHtml', () => {
	it('wraps editor HTML in a minimal standalone document', () => {
		const out = buildStandaloneHtml('<p>Hello</p>', 'My Page')
		expect(out).toMatch(/^<!doctype html>/i)
		expect(out).toContain('<title>My Page</title>')
		expect(out).toContain('<meta charset="utf-8">')
		expect(out).toContain('<p>Hello</p>')
	})

	it('escapes the title', () => {
		const out = buildStandaloneHtml('', 'A <b> & "Title"')
		expect(out).toContain('<title>A &lt;b&gt; &amp; &quot;Title&quot;</title>')
	})

	it('exports a callout doc with its styling', () => {
		const doc = engine.parse('> [!note] Title\n> Body line one\n')
		const body = serializeExportBodyHtml(doc)
		const out = buildStandaloneHtml(body, 'Callout Page')
		expect(out).toContain('data-callout')
		expect(out).toContain('callout callout-note')
		expect(out).toContain('.callout')
	})

	it('hides the body of a collapsed callout in the standalone CSS', () => {
		const doc = engine.parse('> [!note]- Title\n> hidden\n')
		const body = serializeExportBodyHtml(doc)
		const out = buildStandaloneHtml(body, 'Callout Page')
		expect(out).toContain('.callout[data-callout-collapsed="true"] .callout-content')
		expect(out).toContain('display: none')
	})
})
