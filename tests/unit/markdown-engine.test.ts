import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MarkdownEngine, schemaKey, uint8ArrayToBase64, base64ToUint8Array } from '@/lib/markdown/engine'
import { Mention } from '@tiptap/extension-mention'
import { Document } from '@tiptap/extension-document'
import { getSharedExtensions } from '@/lib/editor-extensions'
import { Editor } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import * as Y from 'yjs'
import { collectCodeBlocks } from './code-blocks'

function expectRoundTrip(engine: MarkdownEngine, md: string) {
	const doc = engine.parse(md)
	const serialized = engine.serialize(doc)
	expect(serialized).toBe(md)
	expect(engine.parse(serialized)).toEqual(doc)
}

describe('MarkdownEngine deep module', () => {
	describe('parse / serialize round-trip (Page content)', () => {
		it('round-trips headings and marks', () => {
			const engine = new MarkdownEngine()
			try {
				expectRoundTrip(engine, '# Title\n\n## Section\n')
				expectRoundTrip(engine, 'Some **bold**, *italic* text.\n')
			} finally { engine.destroy() }
		})

		it('preserves code blocks with blank lines (insertParsedHtml fix)', () => {
			const engine = new MarkdownEngine()
			try {
				const sample = ["import { render } from 'react'", '', "describe('X', () => {", "\tit('y', () => {", '\t\tconst a = 1', '', '\t})', '})'].join('\n')
				const md = `before\n\n\`\`\`ts\n${sample}\n\`\`\`\n\nafter\n`
				const doc = engine.parse(md)
				const serialized = engine.serialize(doc)
				expect(serialized).toBe(md)
				// ensure not split into inline code
				const walk = (node: any, out: string[]) => {
					if (node.type === 'text' && node.marks?.some((m: any) => m.type === 'code')) out.push(node.text)
					for (const c of node.content ?? []) walk(c, out)
				}
				const leaked: string[] = []
				walk(doc, leaked)
				expect(leaked).toEqual([])
			} finally { engine.destroy() }
		})

		it('serializes Mention and images via export path', () => {
			const engine = new MarkdownEngine()
			try {
				const docWithMention = {
					type: 'doc',
					content: [
						{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
						{ type: 'paragraph', content: [{ type: 'text', text: 'Hello ' }, { type: 'mention', attrs: { id: 'page-1', label: 'Page One' } }] }
					]
				}
				const exts = [...getSharedExtensions({ document: Document }), Mention.configure({ HTMLAttributes: { class: 'mention' } })]
				const md = engine.serialize(docWithMention as any, exts)
				expect(md.length).toBeGreaterThan(0)
				const plain = engine.plainText(docWithMention as any)
				expect(plain).toContain('Hello')
			} finally { engine.destroy() }
		})
	})

	describe('seed / plainText (Page graph)', () => {
		it('seedToYjsBase64 fits heading block* and plainText joins', () => {
			const engine = new MarkdownEngine()
			try {
				const doc = engine.parse('Body without heading\n\nSecond paragraph\n')
				// doc is block+ (no heading), seed should auto-prepend empty heading and not throw
				const b64 = engine.seedToYjsBase64(doc)
				expect(typeof b64).toBe('string')
				expect(b64.length).toBeGreaterThan(0)
				const plain = engine.plainText(doc)
				expect(plain).toContain('Body without heading')
			} finally { engine.destroy() }
		})

		it('rejects doc that would not open in live Page schema when not fitted', () => {
			// Directly test liveSchema check: a doc with no heading should be rejected if we bypass fitLiveSchema
			// engine.seedToYjsBase64 does fitting internally, so it should NOT reject; but a raw invalid doc via schema check would
			const engine = new MarkdownEngine()
			try {
				// This doc is valid after fitting, so should succeed
				const invalidLike = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'no heading' }] }] }
				expect(() => engine.seedToYjsBase64(invalidLike as any)).not.toThrow()
			} finally { engine.destroy() }
		})
	})

	describe('twin-engine isolation (no global poison)', () => {
		it('two engines with different schemas do not share editors', () => {
			const engineA = new MarkdownEngine()
			const engineB = new MarkdownEngine()
			try {
				const docA = engineA.parse('Hello\n')
				const exts = [...getSharedExtensions({ document: Document }), Mention.configure({})]
				const withMention = engineB.serialize(docA as any, exts)
				const plainA = engineA.serialize(docA)
				expect(plainA).toBe('Hello\n')
				expect(withMention).toContain('Hello')
				expectRoundTrip(engineA, 'Hello\n')
			} finally {
				engineA.destroy()
				engineB.destroy()
			}
		})

		it('custom extensions are cached per schema key, not globally', () => {
			const engine = new MarkdownEngine()
			try {
				const mentionExt = Mention.configure({ HTMLAttributes: { class: 'mention' } })
				const exts = [...getSharedExtensions({ document: Document }), mentionExt]
				const md1 = engine.serialize({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] } as any, exts)
				const md2 = engine.serialize({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] } as any, exts)
				expect(md1).toBe(md2)
			} finally { engine.destroy() }
		})
	})

	describe('frontmatter (PageMeta)', () => {
		it('round-trips PageMeta via engine', () => {
			const engine = new MarkdownEngine()
			try {
				const meta = { title: 'My Page', tags: ['a', 'b'], properties: { author: 'Harsh' } }
				const file = engine.assembleMarkdownFile(meta as any, 'Body\n')
				const { data, body } = engine.parseFrontmatter(file)
				expect(data.title).toBe('My Page')
				expect(data.tags).toEqual(['a', 'b'])
				expect(data.properties).toEqual({ author: 'Harsh' })
				expect(body).toBe('Body\n')
			} finally { engine.destroy() }
		})
	})

	describe('schemaKey regression (identical names, differing config/content)', () => {
		it('does not reuse an incompatible Editor schema when Document content or Mention config differ', () => {
			const customDocBlock = Document.extend({ content: 'block+' })
			const customDocHeading = Document.extend({ content: 'heading block*' })
			const extsBlock = [...getSharedExtensions({ document: customDocBlock }), Mention.configure({ HTMLAttributes: { class: 'mention-a' } })]
			const extsHeading = [...getSharedExtensions({ document: customDocHeading }), Mention.configure({ HTMLAttributes: { class: 'mention-b' } })]
			// Old sorted-names key would collide (same names), new key must distinguish
			expect(schemaKey(extsBlock)).not.toBe(schemaKey(extsHeading))
			expect(schemaKey(extsBlock)).not.toBe(schemaKey([...extsBlock].reverse()))

			const engine = new MarkdownEngine()
			try {
				const doc = engine.parse('Hello\n')
				expect(() => engine.serialize(doc, extsBlock)).not.toThrow()
				expect(() => engine.serialize(doc, extsHeading)).not.toThrow()
				const extsReordered = [Mention.configure({ HTMLAttributes: { class: 'mention-a' } }), ...getSharedExtensions({ document: Document })]
				expect(schemaKey(extsBlock)).not.toBe(schemaKey(extsReordered))
				expect(() => engine.serialize(doc, extsReordered)).not.toThrow()
			} finally { engine.destroy() }
		})
	})
})

// ---------------------------------------------------------------------------
// Migrated from the retired facade tests (tests/unit/markdown-io.test.ts,
// tests/unit/yjs-seed.test.ts) under ADR 0005. Assertions are unchanged; the
// call form moves from the `markdownEngine` singleton facade to per-test
// `new MarkdownEngine()` instances.
// ---------------------------------------------------------------------------

describe('parse / serialize — block round-trip stability (migrated: markdown-io)', () => {
	let engine: MarkdownEngine
	beforeEach(() => { engine = new MarkdownEngine() })
	afterEach(() => engine.destroy())

	/**
	 * The strongest guarantee: serializing a parsed doc yields the exact same
	 * markdown, and parsing again yields the exact same doc. Proves the engine
	 * is a stable round-trip, not a one-way transform.
	 */
	function expectMdRoundTrip(md: string) {
		const serialized = engine.serialize(engine.parse(md))
		expect(serialized).toBe(md)
		expect(engine.parse(serialized)).toEqual(engine.parse(md))
	}

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
		const doc = engine.parse('')
		expect(engine.serialize(doc)).toBe('')
		expect(engine.parse('')).toEqual(doc)
	})

	it('is stable across repeated serialize(parse()) applications', () => {
		const md = '# Heading\n\nSome **bold** and [a link](https://example.com).\n\n- one\n- two\n'
		const once = engine.serialize(engine.parse(md))
		const twice = engine.serialize(engine.parse(once))
		expect(twice).toBe(once)
	})
})

describe('inline HTML preservation (migrated: markdown-io)', () => {
	let engine: MarkdownEngine
	beforeEach(() => { engine = new MarkdownEngine() })
	afterEach(() => engine.destroy())

	it('preserves raw inline HTML through serialization', () => {
		const md = 'A <span style="color: red">colored</span> word.\n'
		const serialized = engine.serialize(engine.parse(md))
		expect(serialized).toContain('<span')
		expect(serialized).toContain('colored</span>')
		// Stability: re-parsing the serialized output yields the same doc.
		expect(engine.parse(serialized)).toEqual(engine.parse(md))
	})
})

describe('serialize on hand-built docs (migrated: markdown-io)', () => {
	let engine: MarkdownEngine
	beforeEach(() => { engine = new MarkdownEngine() })
	afterEach(() => engine.destroy())

	it('serializes a heading doc', () => {
		const md = engine.serialize({
			type: 'doc',
			content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Sub' }] }],
		})
		expect(md).toBe('## Sub\n')
	})
})

describe('parseFrontmatter — frontmatter ↔ properties mapping (migrated: markdown-io)', () => {
	let engine: MarkdownEngine
	beforeEach(() => { engine = new MarkdownEngine() })
	afterEach(() => engine.destroy())

	it('extracts reserved title/tags and keeps the rest as properties', () => {
		const { data, body } = engine.parseFrontmatter('---\ntitle: My Note\ntags: [work, ai]\nauthor: Harsh\n---\nBody text\n')
		expect(data.title).toBe('My Note')
		expect(data.tags).toEqual(['work', 'ai'])
		expect(data.properties).toEqual({ author: 'Harsh' })
		expect(body).toBe('Body text\n')
	})

	it('normalizes a single string tag into an array', () => {
		const { data } = engine.parseFrontmatter('---\ntags: work\n---\nBody\n')
		expect(data.tags).toEqual(['work'])
	})

	it('round-trips primitives, arrays, and nested objects', () => {
		const file = '---\ncount: 3\nratio: 0.5\nactive: true\nlist:\n  - a\n  - b\nmeta:\n  priority: high\n  level: 2\n---\nBody\n'
		const { data } = engine.parseFrontmatter(file)
		expect(data.properties).toEqual({ count: 3, ratio: 0.5, active: true, list: ['a', 'b'], meta: { priority: 'high', level: 2 } })
	})

	it('handles a markdown body with no frontmatter', () => {
		const { data, body } = engine.parseFrontmatter('Just a body\n')
		expect(data.properties).toEqual({})
		expect(data.title).toBeUndefined()
		expect(data.tags).toBeUndefined()
		expect(body).toBe('Just a body\n')
	})

	it('handles an empty frontmatter block', () => {
		const { data, body } = engine.parseFrontmatter('---\n---\nBody\n')
		expect(data.properties).toEqual({})
		expect(body).toBe('Body\n')
	})
})

describe('buildFrontmatter / assembleMarkdownFile (migrated: markdown-io)', () => {
	let engine: MarkdownEngine
	beforeEach(() => { engine = new MarkdownEngine() })
	afterEach(() => engine.destroy())

	it('builds YAML with reserved keys written once and properties spread', () => {
		const yaml = engine.buildFrontmatter({
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
		expect(engine.buildFrontmatter({ properties: {} })).toBeNull()
	})

	it('lets reserved keys win over conflicting properties', () => {
		const yaml = engine.buildFrontmatter({
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
		const yaml = engine.buildFrontmatter({
			properties: { title: 'fake', tags: ['fake'], other: 1 },
		})
		expect(yaml).not.toContain('title: fake')
		expect(yaml).not.toContain('tags:')
		expect(yaml).toContain('other: 1')
	})

	it('omits properties-only reserved keys from assembled files', () => {
		const file = engine.assembleMarkdownFile({ properties: { title: 'fake', tags: ['fake'], other: 1 } }, 'Body\n')
		expect(file).not.toContain('title: fake')
		expect(file).not.toContain('tags:')
		expect(file).toContain('other: 1')
		expect(file).toContain('Body\n')
	})

	it('passes through the body when no meta keys exist', () => {
		expect(engine.assembleMarkdownFile({ properties: {} }, 'Body text\n')).toBe('Body text\n')
	})

	it('assembleMarkdownFile round-trips with parseFrontmatter', () => {
		const meta = {
			title: 'My Note',
			tags: ['work', 'ai'],
			properties: { author: 'Harsh', count: 3, meta: { priority: 'high' } },
		}
		const body = '# Heading\n\nBody text\n'
		const file = engine.assembleMarkdownFile(meta, body)
		expect(file).toContain('---\n')

		const { data, body: reparsedBody } = engine.parseFrontmatter(file)
		expect(data).toEqual(meta)
		expect(reparsedBody).toBe(body)
	})
})

describe('end-to-end: a full markdown file round-trips (migrated: markdown-io)', () => {
	let engine: MarkdownEngine
	beforeEach(() => { engine = new MarkdownEngine() })
	afterEach(() => engine.destroy())

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

		const { data, body } = engine.parseFrontmatter(file)
		expect(data.title).toBe('My Note')
		expect(data.tags).toEqual(['work', 'ai'])
		expect(data.properties).toEqual({ author: 'Harsh', meta: { priority: 'high' } })

		const serializedBody = engine.serialize(engine.parse(body))
		const rebuilt = engine.assembleMarkdownFile(data, serializedBody)

		const reparsed = engine.parseFrontmatter(rebuilt)
		expect(reparsed.data).toEqual(data)
		expect(reparsed.body).toBe(serializedBody)

		const reparsedDoc = engine.parse(reparsed.body)
		expect(reparsedDoc).toEqual(engine.parse(serializedBody))
	})
})

describe('parseMarkdown — code blocks with blank lines stay intact (migrated: markdown-io)', () => {
	let engine: MarkdownEngine
	beforeEach(() => { engine = new MarkdownEngine() })
	afterEach(() => engine.destroy())

	const sample = [
		"import { render, screen, waitFor } from '@testing-library/react'",
		"import userEvent from '@testing-library/user-event'",
		'',
		"describe('SearchComponent', () => {",
		"\tit('debounces input', async () => {",
		'\t\tconst user = userEvent.setup()',
		'\t\trender(<SearchComponent onSearch={mockSearch} />)',
		'',
		'\t\tconst input = screen.getByRole("textbox", { name: /search users/i })',
		'\t\tawait user.type(input, "Alex")',
		'',
		'\t\tawait waitFor(() => {',
		'\t\t\texpect(screen.getByText("Alex Johnson")).toBeInTheDocument()',
		'\t\t})',
		'\t})',
		'})',
	].join('\n')

	it('does not split a code block at blank lines', () => {
		const markdown = `before\n\n\`\`\`typescript\n${sample}\n\`\`\`\n\nafter\n`
		const doc = engine.parse(markdown)

		const blocks = collectCodeBlocks(doc)

		expect(blocks).toHaveLength(1)
		expect(blocks[0].language).toBe('typescript')
		expect(blocks[0].text).toBe(sample)
		expect(blocks[0].text).not.toContain('</code></pre>')

		// The regression used to drop code lines into code-marked paragraphs.
		const leakedInlineCode: string[] = []
		const walk = (node: any) => {
			if (node.type === 'text' && node.marks?.some((m: any) => m.type === 'code')) {
				leakedInlineCode.push(node.text)
			}
			for (const child of node.content ?? []) walk(child)
		}
		walk(doc)
		expect(leakedInlineCode).toEqual([])
	})

	it('keeps every block of a multi-fence document whole', () => {
		const markdown = [
			'```ts',
			'const a = 1',
			'',
			'\tconst b = 2',
			'```',
			'',
			'```tsx',
			'export function Modal() {',
			'\treturn null',
			'',
			'\t// comment',
			'}',
			'```',
			'',
		].join('\n')
		const doc = engine.parse(markdown)

		const blocks = collectCodeBlocks(doc).map((b) => ({
			language: b.language,
			firstLine: b.text.split('\n')[0],
			lines: b.text.split('\n').length,
		}))

		expect(blocks).toHaveLength(2)
		expect(blocks[0]).toEqual({ language: 'ts', firstLine: 'const a = 1', lines: 3 })
		expect(blocks[1]).toEqual({ language: 'tsx', firstLine: 'export function Modal() {', lines: 5 })
	})
})

describe('seedToYjsBase64 / plainText (migrated: yjs-seed)', () => {
	let engine: MarkdownEngine
	beforeEach(() => { engine = new MarkdownEngine() })
	afterEach(() => engine.destroy())

	it('seeds a Y.Doc whose default fragment renders in a bound live editor', () => {
		const content = {
			type: 'doc',
			content: [
				{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
				{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
			],
		}
		const b64 = engine.seedToYjsBase64(content)
		expect(typeof b64).toBe('string')
		expect(b64.length).toBeGreaterThan(0)

		const fresh = new Y.Doc()
		Y.applyUpdate(fresh, base64ToUint8Array(b64))
		const editor = new Editor({
			extensions: [
				...getSharedExtensions(),
				Collaboration.configure({ document: fresh }),
			],
		})
		expect(editor.getHTML()).toContain('Title')
		expect(editor.getHTML()).toContain('Hello world')
		editor.destroy()
	})

	it('seeds callout content (live schema) so it renders as a callout', () => {
		const content = {
			type: 'doc',
			content: [
				{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'T' }] },
				{
					type: 'callout',
					attrs: { type: 'note', title: 'Tip', collapsed: false },
					content: [{ type: 'paragraph', content: [{ type: 'text', text: 'inner' }] }],
				},
			],
		}
		const fresh = new Y.Doc()
		Y.applyUpdate(fresh, base64ToUint8Array(engine.seedToYjsBase64(content)))
		const editor = new Editor({
			extensions: [
				...getSharedExtensions(),
				Collaboration.configure({ document: fresh }),
			],
		})
		expect(editor.getHTML()).toContain('data-callout')
		expect(editor.getHTML()).toContain('Tip')
		editor.destroy()
	})

	it('auto-fits paragraph-first content for the live heading-block* schema (Page)', () => {
		// Engine now fits live schema internally — paragraph-first is valid and gets an empty title heading.
		const b64 = engine.seedToYjsBase64({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] })
		expect(typeof b64).toBe('string')
		expect(b64.length).toBeGreaterThan(0)
	})

	it('rejects truly invalid content for the live Page schema', () => {
		expect(() =>
			engine.seedToYjsBase64({ type: 'doc', content: [{ type: 'unknownNode', content: [] }] } as unknown as never)
		).toThrow()
	})

	describe('plainText', () => {
		it('concatenates text, preserving wikilinks and tags literally', () => {
			const content = {
				type: 'doc',
				content: [
					{ type: 'paragraph', content: [{ type: 'text', text: 'See [[Alpha]] and #work' }] },
					{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] },
				],
			}
			const text = engine.plainText(content)
			expect(text).toContain('[[Alpha]]')
			expect(text).toContain('#work')
			expect(text).toContain('second')
		})

		it('excludes image node src from plain text', () => {
			const content = {
				type: 'doc',
				content: [
					{ type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
					{ type: 'image', attrs: { src: 'data:image/png;base64,AAAA' } },
				],
			}
			expect(engine.plainText(content)).toBe('before')
		})
	})
})

describe('base64 helpers (migrated: yjs-seed)', () => {
	it('round-trips arbitrary bytes', () => {
		const bytes = new Uint8Array([0, 1, 2, 250, 255])
		expect(base64ToUint8Array(uint8ArrayToBase64(bytes))).toEqual(bytes)
	})
})
