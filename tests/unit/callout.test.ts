import { describe, it, expect } from 'vitest'
import { parseMarkdown, serializeMarkdown } from '@/lib/markdown-io'
import { buildStandaloneHtml } from '@/lib/markdown-export'
import { CALLOUT_TYPES, Callout, MARKER_INPUT_RE } from '@/lib/callout'
import { InputRule, Editor } from '@tiptap/core'
import { Document } from '@tiptap/extension-document'
import { StarterKit } from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'

/** Doc-level round-trip: parse → serialize → parse yields the same doc. */
function expectDocRoundTrip(md: string) {
	const first = parseMarkdown(md)
	const serialized = serializeMarkdown(first)
	const second = parseMarkdown(serialized)
	expect(second).toEqual(first)
}

describe('callout parse/serialize round-trip', () => {
	it('round-trips a simple callout with type and title', () => {
		const md = '> [!note] My title\n> Body line one\n'
		const doc = parseMarkdown(md)
		const callout = doc.content?.[0]
		expect(callout?.type).toBe('callout')
		expect(callout?.attrs).toMatchObject({ type: 'note', title: 'My title', collapsed: false })
		expectDocRoundTrip(md)
	})

	it('serializes an empty-title callout losslessly', () => {
		const md = '> [!tip]\n> just a body\n'
		expect(serializeMarkdown(parseMarkdown(md))).toBe(md)
	})

	it('round-trips the collapsed flag both directions', () => {
		const md = '> [!warning]- Collapsed note\n> hidden body\n'
		const doc = parseMarkdown(md)
		expect(doc.content?.[0]?.attrs).toMatchObject({ type: 'warning', collapsed: true })
		expect(serializeMarkdown(doc)).toBe(md)
	})

	it('preserves unknown callout types verbatim', () => {
		const md = '> [!custom] My custom\n> body\n'
		const doc = parseMarkdown(md)
		expect(doc.content?.[0]?.attrs).toMatchObject({ type: 'custom', title: 'My custom' })
		expect(serializeMarkdown(doc)).toBe(md)
	})

	it('keeps inline marks inside the callout body', () => {
		const md = '> [!note] Title\n> **bold** and *italic* and `code`\n'
		expect(serializeMarkdown(parseMarkdown(md))).toBe(md)
	})

	it('preserves a blank line between body paragraphs', () => {
		const md = '> [!note] T\n> p1\n>\n> p2\n'
		expect(serializeMarkdown(parseMarkdown(md))).toBe(md)
	})

	it('round-trips a marker-only first line (no inline body on it)', () => {
		const md = '> [!note] Title\n>\n> body\n'
		const doc = parseMarkdown(md)
		expect(doc.content?.[0]?.attrs).toMatchObject({ type: 'note', title: 'Title', collapsed: false })
		expect(doc.content?.[0]?.content?.[0]?.type).toBe('paragraph')
		expectDocRoundTrip(md)
	})

	it('round-trips a callout containing a list', () => {
		const md = '> [!note] T\n> - item one\n> - item two\n'
		const doc = parseMarkdown(md)
		expect(doc.content?.[0]?.content?.some((n) => n.type === 'bulletList')).toBe(true)
		expectDocRoundTrip(md)
	})

	it('round-trips a callout containing a code fence', () => {
		const md = '> [!tip] T\n> ```ts\n> const x = 1\n> ```\n'
		const doc = parseMarkdown(md)
		expect(doc.content?.[0]?.content?.some((n) => n.type === 'codeBlock')).toBe(true)
		expectDocRoundTrip(md)
	})

	it('leaves a plain blockquote untouched (regression)', () => {
		const md = '> A blockquote line\n>\n> Second paragraph\n'
		const doc = parseMarkdown(md)
		expect(doc.content?.[0]?.type).toBe('blockquote')
		expect(serializeMarkdown(doc)).toBe(md)
	})

	it('normalizes an uppercase marker to lowercase type', () => {
		const doc = parseMarkdown('> [!NOTE] Loud\n> body\n')
		expect(doc.content?.[0]?.attrs).toMatchObject({ type: 'note' })
	})
})

describe('CALLOUT_TYPES', () => {
	it('defines the canonical known set', () => {
		expect(CALLOUT_TYPES).toEqual(['note', 'warning', 'info', 'tip', 'success', 'danger', 'question'])
	})
})

describe('callout export HTML', () => {
	it('wraps the callout in styled standalone HTML', () => {
		const html = buildStandaloneHtml('<div class="callout callout-note">…</div>', 'Page')
		expect(html).toContain('<style>')
		expect(html).toContain('.callout')
	})
})

describe('callout input rule', () => {
	it('converts "> [!note] " typed text into a callout', async () => {
		const editor = new Editor({
			extensions: [
				Document,
				StarterKit.configure({ document: false }),
				Markdown.configure({ html: true }),
				Callout.extend({
					addInputRules() {
						return [
							new InputRule({
								find: MARKER_INPUT_RE,
								handler: ({ range, chain, match }) => {
									const type = match?.[1]?.trim().toLowerCase() || 'note'
									const collapsed = Boolean(match?.[2])
									const title = (match?.[3] ?? '').trim()
									chain().focus().deleteRange(range).insertContent({
										type: 'callout',
										attrs: { type, title, collapsed },
										content: [{ type: 'paragraph' }],
									}).run()
								},
							}),
						]
					},
				}),
			],
		})
		editor.commands.insertContent({ type: 'text', text: '> [!note] ' }, { applyInputRules: true })
		await new Promise((resolve) => setTimeout(resolve, 0))
		const json = editor.getJSON()
		expect(JSON.stringify(json)).toContain('"type":"callout"')
		expect(json.content?.[0]?.attrs).toMatchObject({ type: 'note', title: '', collapsed: false })
		editor.destroy()
	})
})
