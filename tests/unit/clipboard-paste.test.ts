import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import {
	classifyClipboardPaste,
	isObsidianMarkdown,
	isObsidianHtml,
	isNotionHtml,
	decideMarkdownPaste,
} from '@/lib/markdown-paste'
import { hasObsidianFrontmatter, splitObsidianFrontmatter } from '@/lib/obsidian-clipboard'
import { notionHtmlToMarkdown } from '@/lib/notion-clipboard'
import { getSharedExtensions } from '@/lib/editor-extensions'
import { insertParsedHtml } from '@/lib/insert-parsed-html'
import { createWikilinkDecorations, normalizeWikilinkTarget } from '@/lib/wikilink'

// ---------------------------------------------------------------------------
// Recorded clipboard fixtures (seam 3). Real Obsidian + Notion copy payloads,
// dual text/html + text/plain, committed under tests/fixtures/clipboard/.
// ---------------------------------------------------------------------------

interface ClipboardFixture {
	source: string
	clipboard: { 'text/plain': string; 'text/html': string }
	expectations: Record<string, unknown>
}

const fixtureDir = path.resolve(process.cwd(), 'tests/fixtures/clipboard')

function loadFixture(name: string): ClipboardFixture {
	return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'))
}

const obsidian = loadFixture('obsidian-note.json')
const notion = loadFixture('notion-page.json')

function buildEditor(): Editor {
	return new Editor({ extensions: [...getSharedExtensions()] })
}

function findNodes(node: JSONContent, type: string, found: JSONContent[] = []): JSONContent[] {
	if (node.type === type) found.push(node)
	for (const child of node.content ?? []) findNodes(child, type, found)
	return found
}

function collectMarks(node: JSONContent, type: string, found: NonNullable<JSONContent['marks']> = []) {
	for (const mark of node.marks ?? []) if (mark.type === type) found.push(mark)
	for (const child of node.content ?? []) collectMarks(child, type, found)
	return found
}

// ---------------------------------------------------------------------------
// T3 — clipboard classifier
// ---------------------------------------------------------------------------

describe('classifyClipboardPaste', () => {
	it('routes the recorded Obsidian payload as obsidian-markdown', () => {
		expect(classifyClipboardPaste(obsidian.clipboard['text/plain'], obsidian.clipboard['text/html'])).toBe(
			'obsidian-markdown',
		)
	})

	it('routes the recorded Notion payload as notion-html', () => {
		expect(classifyClipboardPaste(notion.clipboard['text/plain'], notion.clipboard['text/html'])).toBe('notion-html')
	})

	it('keeps generic markdown classification unchanged', () => {
		const plain = '# Welcome\n\n- item one'
		const html = "<meta charset='utf-8'><div><pre># Welcome\n\n- item one</pre></div>"
		expect(classifyClipboardPaste(plain, html)).toBe('markdown')
		expect(decideMarkdownPaste(plain, html)).toBe('markdown')
	})

	it('still classifies genuine code from an editor as a code block', () => {
		const plain = 'const x = 1\nfunction foo() { return x }'
		const html = '<pre style="color:#d4d4d4">const x = 1\nfunction foo() { return x }</pre>'
		expect(classifyClipboardPaste(plain, html)).toBe('codeBlock')
	})

	it('keeps code containing double-bracket indexing as a code block (R6)', () => {
		const plain = 'matrix[[i]][[j]] = 1\nconst arr = [[1], [2]]'
		const html = '<pre style="color:#d4d4d4">matrix[[i]][[j]] = 1\nconst arr = [[1], [2]]</pre>'
		// The naive signal is present, but a bare `[[…]]` must not divert a code
		// paste away from the code-block branch.
		expect(isObsidianMarkdown(plain)).toBe(true)
		expect(classifyClipboardPaste(plain, html)).toBe('codeBlock')
	})

	it('still treats a real wikilink note as Obsidian markdown', () => {
		expect(classifyClipboardPaste('See [[Design System]]', '')).toBe('obsidian-markdown')
	})

	it('lets a structural Obsidian signal override a <pre> wrapper', () => {
		expect(classifyClipboardPaste('> [!note] Heads up\nbody', '<pre>x</pre>')).toBe('obsidian-markdown')
	})

	it('routes Obsidian clipboard HTML to markdown even when wrapped in <pre> (R1)', () => {
		const plain = 'See [[Design System]] before the release.'
		const html =
			"<pre>See <a href='obsidian://open?vault=V&file=Design%20System'>Design System</a> before the release.</pre>"
		expect(isObsidianHtml(html)).toBe(true)
		expect(classifyClipboardPaste(plain, html)).toBe('obsidian-markdown')
	})

	it('does not treat a bare inline tag as Obsidian markdown', () => {
		expect(isObsidianMarkdown('Note about #1 priority')).toBe(false)
		expect(isObsidianMarkdown('A #tag in prose')).toBe(false)
	})

	it('detects strong Obsidian signals and Notion hosts', () => {
		expect(isObsidianMarkdown('> [!note] Title')).toBe(true)
		expect(isObsidianMarkdown('See [[Page]]')).toBe(true)
		expect(isObsidianMarkdown('---\ntitle: x\n---\nbody')).toBe(true)
		expect(isNotionHtml('<a href="https://www.notion.so/x-y">x</a>')).toBe(true)
		expect(isNotionHtml('<p>plain</p>')).toBe(false)
	})

	it('prefers Obsidian classification when both dialects are present', () => {
		expect(classifyClipboardPaste('See [[Page]]', '<a href="https://www.notion.so/x-y">x</a>')).toBe(
			'obsidian-markdown',
		)
	})
})

// ---------------------------------------------------------------------------
// T2 — Obsidian frontmatter split
// ---------------------------------------------------------------------------

describe('splitObsidianFrontmatter', () => {
	it('extracts properties, tags and body from the recorded payload', () => {
		const { properties, tags, body } = splitObsidianFrontmatter(obsidian.clipboard['text/plain'])
		expect(properties).toEqual({ status: 'active', tags: ['work', 'planning'] })
		expect(tags).toEqual(['work', 'planning'])
		expect(body.trimStart().startsWith(obsidian.expectations.bodyStartsWith as string)).toBe(true)
		expect(body).not.toContain('status: active')
	})

	it('leaves text without frontmatter untouched', () => {
		const text = '# Just a heading\n\nNo frontmatter here.'
		expect(hasObsidianFrontmatter(text)).toBe(false)
		expect(splitObsidianFrontmatter(text)).toEqual({ properties: {}, tags: [], body: text })
	})

	it('does not mistake a thematic break for frontmatter', () => {
		const text = '---\n\nNot frontmatter\n'
		expect(hasObsidianFrontmatter(text)).toBe(false)
		expect(splitObsidianFrontmatter(text).body).toBe(text)
	})
})

// ---------------------------------------------------------------------------
// T4 — Notion HTML → markdown
// ---------------------------------------------------------------------------

describe('notionHtmlToMarkdown', () => {
	it('converts the recorded Notion payload to Obsidian-flavored markdown', () => {
		const md = notionHtmlToMarkdown(notion.clipboard['text/html'])
		for (const expected of notion.expectations.markdownIncludes as string[]) {
			expect(md).toContain(expected)
		}
	})

	it('returns an empty string when there is nothing to convert', () => {
		expect(notionHtmlToMarkdown('')).toBe('')
		expect(notionHtmlToMarkdown('   ')).toBe('')
	})

	it('keeps genuinely external links as markdown links, never wikilinks', () => {
		const md = notionHtmlToMarkdown('<p>Read <a href="https://obsidian.md">Obsidian</a></p>')
		expect(md).toBe('Read [Obsidian](https://obsidian.md)')
		expect(md).not.toContain('[[')
	})

	it('derives a page title from a Notion href when the anchor text is empty', () => {
		const md = notionHtmlToMarkdown(
			'<p><a href="https://www.notion.so/Roadmap-ffffffffffffffffffffffffffffffff"></a></p>',
		)
		expect(md).toBe('[[Roadmap]]')
	})
})

// ---------------------------------------------------------------------------
// T6 / T7 — paste integration at the Tiptap seam (external behavior only)
// ---------------------------------------------------------------------------

describe('pasting the recorded Obsidian payload into the editor', () => {
	it('yields a callout node, frontmatter properties, and wikilink + tag text', () => {
		const editor = buildEditor()
		const { properties, tags, body } = splitObsidianFrontmatter(obsidian.clipboard['text/plain'])
		expect(properties.status).toBe('active')
		expect(tags).toEqual(['work', 'planning'])

		const parsedHtml = (editor as any).storage.markdown.parser.parse(body)
		insertParsedHtml(editor, parsedHtml, { replaceDocument: true })

		const doc = editor.getJSON()
		const callouts = findNodes(doc, 'callout')
		expect(callouts).toHaveLength(1)
		expect(callouts[0].attrs?.type).toBe(obsidian.expectations.calloutType)

		const text = editor.getText()
		expect(text).toContain('[[Design System]]')
		expect(text).toContain('[[Roadmap|the roadmap]]')
		expect(text).toContain('[[Nonexistent Page]]')
		expect(text).toContain('#work')
		editor.destroy()
	})
})

describe('pasting the recorded Notion payload into the editor', () => {
	it('yields native nodes, page mentions and external links', () => {
		const editor = buildEditor()
		const md = notionHtmlToMarkdown(notion.clipboard['text/html'])
		const parsedHtml = (editor as any).storage.markdown.parser.parse(md)
		insertParsedHtml(editor, parsedHtml, { replaceDocument: true })

		const doc = editor.getJSON()
		const headings = findNodes(doc, 'heading')
		expect(headings[0]?.content?.[0]?.text).toBe('Meeting notes')

		const text = editor.getText()
		for (const pageLink of notion.expectations.pageLinks as string[]) {
			expect(text).toContain(`[[${pageLink}]]`)
		}

		const links = collectMarks(doc, 'link')
		const hrefs = links.map((mark) => mark.attrs?.href)
		expect(hrefs).toContain('https://obsidian.md')
		editor.destroy()
	})

	it('renders resolved and unresolved Page links from the recorded mentions (AC2)', () => {
		const editor = buildEditor()
		const md = notionHtmlToMarkdown(notion.clipboard['text/html'])
		const parsedHtml = (editor as any).storage.markdown.parser.parse(md)
		insertParsedHtml(editor, parsedHtml, { replaceDocument: true })

		const resolved = notion.expectations.resolvedPage as string
		const pagesMap = new Map([[normalizeWikilinkTarget(resolved), { id: 'page-1', title: resolved }]])
		const decorations = createWikilinkDecorations(editor.state.doc, pagesMap)
		const classes = decorations.find().map((deco: any) => String(deco.type?.attrs?.class ?? ''))

		expect(editor.getText()).toContain(`[[${notion.expectations.unresolvedPage}]]`)
		expect(classes.some((c) => c.includes('wikilink-resolved'))).toBe(true)
		expect(classes.some((c) => c.includes('wikilink-unresolved'))).toBe(true)
		editor.destroy()
	})
})

describe('three link states from pasted content', () => {
	it('decorates resolved and unresolved wikilinks distinctly and keeps external links external', () => {
		const editor = buildEditor()
		const md = 'See [[Design System]], [[Nonexistent Page]] and [Obsidian](https://obsidian.md).'
		const parsedHtml = (editor as any).storage.markdown.parser.parse(md)
		insertParsedHtml(editor, parsedHtml, { replaceDocument: true })

		const pagesMap = new Map([
			[normalizeWikilinkTarget('Design System'), { id: 'page-1', title: 'Design System' }],
		])
		const decorations = createWikilinkDecorations(editor.state.doc, pagesMap)
		const classes = decorations.find().map((deco: any) => String(deco.type?.attrs?.class ?? ''))

		expect(classes.some((c) => c.includes('wikilink-resolved'))).toBe(true)
		expect(classes.some((c) => c.includes('wikilink-unresolved'))).toBe(true)

		// External URL is a real link, not a wikilink decoration.
		const linkHrefs = collectMarks(editor.getJSON(), 'link').map((mark) => mark.attrs?.href)
		expect(linkHrefs).toContain('https://obsidian.md')
		editor.destroy()
	})
})

// ---------------------------------------------------------------------------
// T4/T6 — Notion converter hardening (review findings)
// External behavior only: the emitted markdown and the parsed document.
// ---------------------------------------------------------------------------

describe('notionHtmlToMarkdown hardening', () => {
	it('preserves direct text nodes beside converting children in a wrapper', () => {
		expect(notionHtmlToMarkdown('<div>Intro <span>x</span> tail</div>')).toBe('Intro x tail')
	})

	it('keeps explicitly non-page mentions as plain text but still converts page mentions', () => {
		// A date mention must not become a Page link.
		expect(notionHtmlToMarkdown('<p><span class="mention" data-type="date">Tomorrow</span></p>')).toBe('Tomorrow')
		expect(notionHtmlToMarkdown('<p><span class="mention" data-type="date">Tomorrow</span></p>')).not.toContain('[[')
		// Page-mention forms still convert: explicit page id, untyped span, typed page.
		expect(notionHtmlToMarkdown('<p><span class="mention" data-mention-page-id="1a2b3c">Design Tokens</span></p>')).toBe(
			'[[Design Tokens]]',
		)
		expect(notionHtmlToMarkdown('<p><span class="mention">Unreleased Page</span></p>')).toBe('[[Unreleased Page]]')
		expect(notionHtmlToMarkdown('<p><span class="mention" data-type="page">Design Tokens</span></p>')).toBe(
			'[[Design Tokens]]',
		)
	})

	it('emits a fence longer than the longest backtick run in a code block', () => {
		const md = notionHtmlToMarkdown('<pre><code>before\n```\nafter</code></pre>')
		expect(md.startsWith('````')).toBe(true)
		expect(md.endsWith('````')).toBe(true)
		expect(md).toContain('before\n```\nafter')
	})

	it('parses a code block containing a three-backtick line as a single code block', () => {
		const editor = buildEditor()
		const md = notionHtmlToMarkdown('<pre><code>before\n```\nafter</code></pre>')
		const parsedHtml = (editor as any).storage.markdown.parser.parse(md)

		// With a three-backtick fence this would close early and the tail would
		// become a heading/paragraph; the whole block must stay inside one <pre>.
		expect(parsedHtml).toBe('<pre><code>before\n```\nafter</code></pre>')
		expect(parsedHtml).not.toContain('<h1')
		editor.destroy()
	})

	it('treats a URL whose path looks like Notion as an external link, not Notion content', () => {
		const html = '<p><a href="https://example.com/notion.so/guide">Guide</a></p>'
		expect(isNotionHtml(html)).toBe(false)
		expect(classifyClipboardPaste('Guide', html)).not.toBe('notion-html')
		expect(notionHtmlToMarkdown(html)).toBe('[Guide](https://example.com/notion.so/guide)')
	})

	it('wraps an external href containing a space so it stays one link destination', () => {
		const md = notionHtmlToMarkdown('<p><a href="https://example.com/a b">Guide</a></p>')
		expect(md).toBe('[Guide](<https://example.com/a%20b>)')

		const editor = buildEditor()
		const parsedHtml = (editor as any).storage.markdown.parser.parse(md)
		insertParsedHtml(editor, parsedHtml, { replaceDocument: true })
		const hrefs = collectMarks(editor.getJSON(), 'link').map((mark) => mark.attrs?.href)
		expect(hrefs).toHaveLength(1)
		expect(String(hrefs[0])).toMatch(/example\.com\/a( |%20)b/)
		editor.destroy()
	})
})
