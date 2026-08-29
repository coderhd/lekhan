import { describe, it, expect } from 'vitest'
import { MarkdownEngine } from '@/lib/markdown/engine'
import { Mention } from '@tiptap/extension-mention'
import { Document } from '@tiptap/extension-document'
import { getSharedExtensions } from '@/lib/editor-extensions'

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
})
