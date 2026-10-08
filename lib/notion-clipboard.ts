import { isNotionHtml } from '@/lib/markdown-paste'

export { isNotionHtml }

const NOTION_URL_RE = /(?:^https?:\/\/)?(?:www\.)?notion\.(?:so|site)\//i
const NOTION_TAIL_ID_RE = /-[\da-f]{32}$/i
const BLANK_LINES_RE = /\n{3,}/g

function notionTitleFromText(text: string): string {
	return text.replace(/\s+/g, ' ').trim()
}

function titleFromNotionHref(href: string): string {
	const withoutQuery = href.split(/[?#]/)[0]
	const segments = withoutQuery.split('/').filter(Boolean)
	const last = segments[segments.length - 1] ?? ''
	let decoded = last
	try {
		decoded = decodeURIComponent(last)
	} catch {
		decoded = last
	}
	return notionTitleFromText(decoded.replace(NOTION_TAIL_ID_RE, '').replace(/-/g, ' '))
}

function escapeTableCell(text: string): string {
	return text.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim()
}

function isElement(node: Node): node is HTMLElement {
	return node.nodeType === 1
}

function isText(node: Node): node is Text {
	return node.nodeType === 3
}

function renderInline(node: Node): string {
	if (isText(node)) return node.textContent ?? ''
	if (!isElement(node)) return ''

	const tag = node.tagName.toLowerCase()
	if (tag === 'br') return '\n'
	if (tag === 'strong' || tag === 'b') return `**${renderChildren(node)}**`
	if (tag === 'em' || tag === 'i') return `*${renderChildren(node)}*`
	if (tag === 'code') return `\`${node.textContent ?? ''}\``
	if (tag === 'del' || tag === 's' || tag === 'strike') return `~~${renderChildren(node)}~~`
	if (tag === 'img') {
		const src = node.getAttribute('src') ?? ''
		const alt = node.getAttribute('alt') ?? ''
		return src ? `![${alt}](${src})` : alt
	}
	if (tag === 'a') {
		const href = node.getAttribute('href') ?? ''
		const label = notionTitleFromText(node.textContent ?? '')
		if (NOTION_URL_RE.test(href)) {
			return `[[${label || titleFromNotionHref(href)}]]`
		}
		if (!href) return label
		return `[${label || href}](${href})`
	}
	// Notion page mentions. Some clipboard shapes use a `<span class="mention">`
	// (possibly with `data-*` markers); newer exports use `<mention-page>`.
	if (tag === 'span') {
		const cls = node.getAttribute('class') ?? ''
		const dataType = node.getAttribute('data-type') ?? ''
		const mentionId = node.getAttribute('data-mention-page-id') ?? ''
		if (/mention/i.test(cls) || /mention/i.test(dataType) || mentionId) {
			const label = notionTitleFromText(node.textContent ?? '')
			if (label) return `[[${label}]]`
		}
		return renderChildren(node)
	}
	if (tag === 'mention-page') {
		const label = notionTitleFromText(node.textContent ?? '')
		if (label) return `[[${label}]]`
	}
	return renderChildren(node)
}

function renderChildren(el: Node): string {
	let out = ''
	for (const child of Array.from(el.childNodes)) out += renderInline(child)
	return out
}

function renderList(el: HTMLElement, ordered: boolean, depth: number): string {
	const indent = '  '.repeat(depth)
	const lines: string[] = []
	let index = 1
	for (const child of Array.from(el.children)) {
		const tag = child.tagName.toLowerCase()
		if (tag !== 'li') continue
		const marker = ordered ? `${index++}. ` : '- '
		// Render the item's own inline content, then any nested lists.
		let inline = ''
		const nested: string[] = []
		for (const grand of Array.from(child.childNodes)) {
			if (isElement(grand) && ['ul', 'ol'].includes(grand.tagName.toLowerCase())) {
				nested.push(renderList(grand, grand.tagName.toLowerCase() === 'ol', depth + 1))
			} else {
				inline += renderInline(grand)
			}
		}
		lines.push(`${indent}${marker}${notionTitleFromText(inline)}`)
		for (const n of nested) lines.push(n)
	}
	return lines.join('\n')
}

function renderTable(el: HTMLElement): string {
	const rows = Array.from(el.querySelectorAll('tr'))
	if (rows.length === 0) return ''
	const matrix = rows.map((row) =>
		Array.from(row.querySelectorAll('th,td')).map((cell) => escapeTableCell(renderChildren(cell)))
	)
	const columns = Math.max(...matrix.map((row) => row.length), 0)
	if (columns === 0) return ''

	const pad = (row: string[]): string[] => {
		const next = row.slice()
		while (next.length < columns) next.push('')
		return next
	}
	const header = pad(matrix[0])
	const lines = [
		`| ${header.join(' | ')} |`,
		`| ${header.map(() => '---').join(' | ')} |`,
		...matrix.slice(1).map((row) => `| ${pad(row).join(' | ')} |`),
	]
	return lines.join('\n')
}

function renderCodeBlock(el: HTMLElement): string {
	const codeEl = el.querySelector('code')
	const languageMatch = codeEl?.className.match(/language-([\w-]+)/)
	const language = languageMatch ? languageMatch[1] : ''
	const code = (codeEl ?? el).textContent ?? ''
	return `\`\`\`${language}\n${code.replace(/\n$/, '')}\n\`\`\``
}

function renderBlock(el: HTMLElement, blocks: string[]): void {
	const tag = el.tagName.toLowerCase()

	if (/^h[1-6]$/.test(tag)) {
		const level = Number(tag[1])
		blocks.push(`${'#'.repeat(level)} ${notionTitleFromText(renderChildren(el))}`)
		return
	}
	if (tag === 'p') {
		blocks.push(notionTitleFromText(renderChildren(el)))
		return
	}
	if (tag === 'blockquote' || tag === 'aside') {
		const inner = notionTitleFromText(renderChildren(el))
		if (inner) blocks.push(inner.split('\n').map((line) => `> ${line}`).join('\n'))
		return
	}
	if (tag === 'ul' || tag === 'ol') {
		const rendered = renderList(el, tag === 'ol', 0)
		if (rendered) blocks.push(rendered)
		return
	}
	if (tag === 'pre') {
		blocks.push(renderCodeBlock(el))
		return
	}
	if (tag === 'table') {
		const rendered = renderTable(el)
		if (rendered) blocks.push(rendered)
		return
	}
	if (tag === 'hr') {
		blocks.push('---')
		return
	}
	if (['div', 'section', 'article', 'main', 'body', 'header', 'footer'].includes(tag)) {
		for (const child of Array.from(el.children)) renderBlock(child as HTMLElement, blocks)
		return
	}

	// Fallback: treat unknown block as a paragraph if it has inline text.
	const text = notionTitleFromText(renderChildren(el))
	if (text) blocks.push(text)
}

/**
 * Convert Notion-copied HTML into Obsidian-flavored markdown so the content can
 * flow through the same markdown parser and graph indexer as Obsidian paste.
 *
 * Internal Notion page links become `[[Page Title]]` so the wikilink layer can
 * resolve them where a target Page exists; genuinely external links stay
 * `[text](url)`. Returns an empty string when there is nothing parseable, which
 * lets the caller fall back to the native HTML paste path rather than losing
 * content.
 */
export function notionHtmlToMarkdown(html: string): string {
	if (typeof html !== 'string' || html.trim() === '') return ''
	if (typeof document === 'undefined') return ''

	const doc = new DOMParser().parseFromString(html, 'text/html')
	const root = doc.body ?? doc.documentElement
	if (!root) return ''

	const blocks: string[] = []
	for (const child of Array.from(root.children)) renderBlock(child as HTMLElement, blocks)

	return blocks
		.filter((block) => block.length > 0)
		.join('\n\n')
		.replace(BLANK_LINES_RE, '\n\n')
		.trim()
}
