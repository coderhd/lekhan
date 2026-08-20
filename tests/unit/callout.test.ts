import { describe, it, expect } from 'vitest'
import { parseMarkdown, serializeMarkdown } from '@/lib/markdown-io'
import { buildStandaloneHtml } from '@/lib/markdown-export'
import { CALLOUT_TYPES, Callout, BLOCKQUOTE_MARKER_RE, handleCalloutInputRule } from '@/lib/callout'
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

describe('callout input rule (Enter-trigger inside blockquote)', () => {
	// Faithful per-keystroke simulation through the editor view's
	// handleTextInput path (the exact path prosemirror-view uses for real
	// keystrokes), so the blockquote rule's eager `> ` match fires exactly as
	// it does for real typing. Unhandled chars are dispatched via the view's
	// default text-insertion path, NOT via commands.insertContent, which does
	// not exercise input rules (tiptap-markdown also re-parses its strings as
	// markdown).
	function typeInto(editor: Editor, text: string) {
		const view = editor.view as any
		for (const ch of text) {
			const deflt = () => {
				const { from, to } = view.state.selection
				view.dispatch(view.state.tr.insertText(ch, from, to))
			}
			const handled = view.someProp('handleTextInput', (fn: any) =>
				fn(view, view.state.selection.from, view.state.selection.to, ch, deflt))
			if (!handled) deflt()
		}
	}

	// Simulate the Enter keydown through handleKeyDown — the path that runs
	// the input-rule plugin's Enter trigger (text '\n'). When no rule
	// converts, the base keymap handles the split, as in the live editor.
	function pressEnter(editor: Editor) {
		const view = editor.view as any
		view.someProp('handleKeyDown', (fn: any) => fn(view, new KeyboardEvent('keydown', { key: 'Enter' })))
	}

	function makeEditor() {
		return new Editor({
			extensions: [
				Document,
				StarterKit.configure({ document: false }),
				Markdown.configure({ html: true }),
				Callout.extend({
					addInputRules() {
						return [new InputRule({ find: BLOCKQUOTE_MARKER_RE, handler: handleCalloutInputRule })]
					},
				}),
			],
		})
	}

	it('converts "> [!note] Title" + Enter into a callout', () => {
		const editor = makeEditor()
		typeInto(editor, '> [!note] Title')
		pressEnter(editor)
		const json = JSON.stringify(editor.getJSON())
		expect(json).toContain('"type":"callout"')
		expect(json).toContain('"title":"Title"')
		expect(json).toContain('"type":"note"')
		editor.destroy()
	})

	it('handles the collapsed "-" variant', () => {
		const editor = makeEditor()
		typeInto(editor, '> [!warning]- Danger')
		pressEnter(editor)
		const json = JSON.stringify(editor.getJSON())
		expect(json).toContain('"type":"callout"')
		expect(json).toContain('"type":"warning"')
		expect(json).toContain('"collapsed":true')
		expect(json).toContain('"title":"Danger"')
		editor.destroy()
	})

	it('leaves a plain blockquote ("> hello") as a blockquote', () => {
		const editor = makeEditor()
		typeInto(editor, '> hello')
		pressEnter(editor)
		const json = editor.getJSON()
		expect(json.content?.some((n) => n.type === 'blockquote')).toBe(true)
		expect(json.content?.some((n) => n.type === 'callout')).toBe(false)
		editor.destroy()
	})
})
