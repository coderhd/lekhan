import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { Document } from '@tiptap/extension-document'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { createLowlight, common } from 'lowlight'
import { Markdown } from 'tiptap-markdown'
import { decideMarkdownPaste } from '@/lib/markdown-paste'

const CustomDocument = Document.extend({
	content: 'heading block*',
})

describe('decideMarkdownPaste', () => {
	it('parses pasted markdown as rich content even when the clipboard HTML wraps it in a <pre>', () => {
		const plain = '# Welcome\n\n## Subheading\n\n- item one\n- item two'
		const html = "<meta charset='utf-8'><span><div><pre># Welcome\n\n## Subheading\n\n- item one\n- item two</pre></div></span>"

		// Regression: the <pre>-wrapped HTML used to force a single code block,
		// so markdown was never parsed.
		expect(decideMarkdownPaste(plain, html)).toBe('markdown')
	})

	it('parses markdown that contains a fenced code block instead of becoming a code block', () => {
		const plain = 'Intro text\n\n```js\nconst a = 1\n```\n\nTrailer'
		const html = '<meta charset=\'utf-8\'><div><pre>' + plain + '</pre></div>'

		expect(decideMarkdownPaste(plain, html)).toBe('markdown')
	})

	it('treats a genuine code paste with no markdown indicators from an editor as a code block', () => {
		const plain = 'const x = 1\nfunction foo() { return x }'
		const html = "<meta charset='utf-8'><pre style=\"color:#d4d4d4\">const x = 1\nfunction foo() { return x }</pre>"

		expect(decideMarkdownPaste(plain, html)).toBe('codeBlock')
	})

	it('returns markdown when HTML is absent but plain text has markdown indicators', () => {
		expect(decideMarkdownPaste('**bold** text and a [link](https://example.com)', undefined)).toBe('markdown')
	})

	it('falls back to a code block only when text is not markdown but HTML indicates code', () => {
		expect(decideMarkdownPaste('Just a plain line copied.', '<pre>Just a plain line copied.</pre>')).toBe('codeBlock')
	})

	it('returns default when there is no plain text', () => {
		expect(decideMarkdownPaste('', '<pre>hi</pre>')).toBe('default')
		expect(decideMarkdownPaste(undefined, undefined)).toBe('default')
	})

	it('classifies pipe-operator code with <pre> HTML as a code block, not a markdown table', () => {
		const plain = 'const permissions = read | write | execute'
		const html = "<meta charset='utf-8'><div><pre>" + plain + '</pre></div>'

		expect(decideMarkdownPaste(plain, html)).toBe('codeBlock')
	})

	it('classifies a valid GFM table with a delimiter row as markdown', () => {
		const plain = '| Name | Role |\n| --- | --- |\n| Alice | Writer |'
		const html = "<meta charset='utf-8'><div><pre>" + plain + '</pre></div>'

		expect(decideMarkdownPaste(plain, html)).toBe('markdown')
	})

	it('classifies ATX headings indented up to three spaces as markdown, not a code block', () => {
		expect(decideMarkdownPaste('   # Indented heading', undefined)).toBe('markdown')
		expect(decideMarkdownPaste('  ## Two-space heading', '<pre>  ## Two-space heading</pre>')).toBe('markdown')
	})
})

describe('pasting markdown into a live editor', () => {
	function buildEditor() {
		const lowlight = createLowlight(common)
		return new Editor({
			extensions: [
				CustomDocument,
				StarterKit.configure({ document: false, codeBlock: false, link: false, underline: false, undoRedo: false }),
				CodeBlockLowlight.configure({ lowlight }),
				Markdown.configure({
					html: true,
					transformPastedText: true,
					transformCopiedText: true,
				}),
			],
		})
	}

	it('renders a <pre>-wrapped markdown paste as rich blocks, not a single code block', () => {
		const editor = buildEditor()
		const plain = '# Welcome\n\nIntro paragraph\n\n- item one\n- item two'
		const html = "<meta charset='utf-8'><div><pre># Welcome\n\nIntro paragraph\n\n- item one\n- item two</pre></div>"

		const kind = decideMarkdownPaste(plain, html)
		expect(kind).toBe('markdown')

		const parsedHtml = (editor as any).storage.markdown.parser.parse(plain)
		editor.commands.setContent(parsedHtml)

		const out = editor.getHTML()
		expect(out).toContain('<h1>Welcome</h1>')
		expect(out).toContain('<ul')
		expect(out).toContain('<li><p>item one</p></li>')
		expect(out).not.toContain('<pre><code>')
		editor.destroy()
	})

	it('still inserts genuine non-markdown code from an editor as a code block', () => {
		const editor = buildEditor()
		const plain = 'const x = 1\nfunction foo() { return x }'
		const html = '<pre style="color:#d4d4d4">const x = 1\nfunction foo() { return x }</pre>'

		const kind = decideMarkdownPaste(plain, html)
		expect(kind).toBe('codeBlock')

		if (kind === 'codeBlock') {
			editor.commands.insertContent({
				type: 'codeBlock',
				content: [{ type: 'text', text: plain }],
			})
		}

		const out = editor.getHTML()
		expect(out).toContain('<pre><code>')
		expect(out).toContain('const x = 1')
		expect(out).not.toContain('<ul')
		editor.destroy()
	})

	it('inserts pipe-operator code with <pre> HTML as a code block, not a markdown table', () => {
		const editor = buildEditor()
		const plain = 'const permissions = read | write | execute'
		const html = "<meta charset='utf-8'><div><pre>" + plain + '</pre></div>'

		const kind = decideMarkdownPaste(plain, html)
		expect(kind).toBe('codeBlock')

		if (kind === 'codeBlock') {
			editor.commands.insertContent({
				type: 'codeBlock',
				content: [{ type: 'text', text: plain }],
			})
		}

		const out = editor.getHTML()
		expect(out).toContain('<pre><code>')
		expect(out).toContain('const permissions = read | write | execute')
		expect(out).not.toContain('<table')
		editor.destroy()
	})
})