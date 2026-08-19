import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/react'
import { decideMarkdownPaste } from '@/lib/markdown-paste'
import { insertParsedHtml } from '@/lib/insert-parsed-html'
import { getSharedExtensions } from '@/lib/editor-extensions'

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

	it('classifies mismatched table rows inside <pre> HTML as a code block', () => {
		const plain = '| Name | Role | Country |\n| --- | --- |\n| Alice | Writer |'
		const html = "<meta charset='utf-8'><div><pre>" + plain + '</pre></div>'

		expect(decideMarkdownPaste(plain, html)).toBe('codeBlock')
	})

	it('classifies ATX headings indented up to three spaces as markdown, not a code block', () => {
		expect(decideMarkdownPaste('   # Indented heading', undefined)).toBe('markdown')
		expect(decideMarkdownPaste('  ## Two-space heading', '<pre>  ## Two-space heading</pre>')).toBe('markdown')
	})
})

describe('pasting markdown into a live editor', () => {
	function buildEditor() {
		return new Editor({
			extensions: [
				...getSharedExtensions(),
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

	it('does not split a pasted fenced code block at blank lines', () => {
		const editor = buildEditor()
		const code = [
			"import { render, screen } from '@testing-library/react'",
			'',
			"describe('SearchComponent', () => {",
			"\tit('debounces input', async () => {",
			'\t\tconst user = userEvent.setup()',
			'',
			'\t\tconst input = screen.getByRole("textbox")',
			'\t})',
			'})',
		].join('\n')
		const plain = `Intro\n\n\`\`\`typescript\n${code}\n\`\`\`\n\nOutro`

		const kind = decideMarkdownPaste(plain, undefined)
		expect(kind).toBe('markdown')

		// Mirrors the editor-workspace handlePaste flow: markdown -> HTML via
		// the parser, then inserted without re-running the markdown parser.
		const parsedHtml = (editor as any).storage.markdown.parser.parse(plain)
		insertParsedHtml(editor, parsedHtml, { replaceAll: true })

		const doc = editor.getJSON()
		const blocks: { language: string | null; text: string }[] = []
		const walk = (node: any) => {
			if (node.type === 'codeBlock') {
				blocks.push({
					language: node.attrs?.language ?? null,
					text: node.content?.[0]?.text ?? '',
				})
			}
			for (const child of node.content ?? []) walk(child)
		}
		walk(doc)

		expect(blocks).toHaveLength(1)
		expect(blocks[0].language).toBe('typescript')
		expect(blocks[0].text).toBe(code)
		expect(blocks[0].text).not.toContain('</code></pre>')
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