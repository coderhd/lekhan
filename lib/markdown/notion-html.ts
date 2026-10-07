import type { JSONContent } from '@tiptap/core'

/**
 * Notion-friendly HTML serializer for the clipboard copy-out path (SIL-9 S3).
 *
 * This is a pure JSON walker rather than `generateHTML`, so the Notion mapping
 * is testable in isolation and does not depend on instantiating a Tiptap
 * editor/schema. It intentionally emits only the constructs Notion's paste
 * converter understands well:
 *
 * - real heading elements (`h1`-`h4`),
 * - callouts as blockquotes with a bold title line (Notion's callout-equivalent
 *   paste), keeping the `callout-*` class names used by the `.html` export,
 * - `ul`/`ol`/`li` lists with disabled checkbox inputs for task items,
 * - `table`/`thead`/`tbody`/`th`/`td`, and
 * - genuine `a[href]` links and `img[src]`.
 *
 * Wikilinks are literal text in the editor (an inline decoration, not a node),
 * so they pass through as `[[Page]]`; Notion cannot resolve a page identity
 * that does not exist in the target workspace (spec §3). The Obsidian
 * `text/plain` payload carries the machine-readable form.
 */

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

function escapeAttr(value: unknown): string {
	if (value === null || value === undefined) return ''
	return escapeHtml(String(value))
}

interface MarkLike {
	type: string
	attrs?: Record<string, unknown> | null
}

function renderTextNode(node: JSONContent): string {
	let html = escapeHtml(node.text ?? '')
	const marks = (node.marks ?? []) as MarkLike[]
	for (const mark of marks) {
		switch (mark.type) {
			case 'code':
				html = `<code>${html}</code>`
				break
			case 'bold':
				html = `<strong>${html}</strong>`
				break
			case 'italic':
				html = `<em>${html}</em>`
				break
			case 'strike':
				html = `<s>${html}</s>`
				break
			case 'underline':
				html = `<u>${html}</u>`
				break
			case 'highlight':
				html = `<mark>${html}</mark>`
				break
			case 'link': {
				const href = escapeAttr(mark.attrs?.href)
				const title = mark.attrs?.title ? ` title="${escapeAttr(mark.attrs.title)}"` : ''
				if (href) html = `<a href="${href}"${title}>${html}</a>`
				break
			}
			case 'textStyle': {
				const color = mark.attrs?.color
				const fontFamily = mark.attrs?.fontFamily
				const styles: string[] = []
				if (typeof color === 'string' && color) styles.push(`color: ${escapeAttr(color)}`)
				if (typeof fontFamily === 'string' && fontFamily) styles.push(`font-family: ${escapeAttr(fontFamily)}`)
				if (styles.length > 0) html = `<span style="${styles.join('; ')}">${html}</span>`
				break
			}
			default:
				break
		}
	}
	return html
}

function renderChildren(node: JSONContent): string {
	return (node.content ?? []).map(renderNode).join('')
}

/** Render a code block's raw text, preserving newlines without mark wrapping. */
function renderCodeBlock(node: JSONContent): string {
	const language = typeof node.attrs?.language === 'string' ? node.attrs.language : ''
	const classAttr = language ? ` class="language-${escapeAttr(language)}"` : ''
	const text = (node.content ?? []).map((child) => escapeHtml(child.text ?? '')).join('')
	return `<pre><code${classAttr}>${text}</code></pre>`
}

function renderCheckedTaskItem(node: JSONContent): string {
	const checked = node.attrs?.checked === true
	const checkbox = `<input type="checkbox" disabled${checked ? ' checked' : ''}> `
	return `<li>${checkbox}${renderChildren(node)}</li>`
}

function renderCallout(node: JSONContent): string {
	const type = typeof node.attrs?.type === 'string' ? node.attrs.type : 'note'
	const title = typeof node.attrs?.title === 'string' ? node.attrs.title : ''
	const titleHtml = title ? `<p><strong>${escapeHtml(title)}</strong></p>` : ''
	return `<blockquote class="callout callout-${escapeAttr(type)}" data-callout="${escapeAttr(type)}">${titleHtml}${renderChildren(node)}</blockquote>`
}

function renderNode(node: JSONContent): string {
	switch (node.type) {
		case 'doc':
			return renderChildren(node)
		case 'text':
			return renderTextNode(node)
		case 'paragraph': {
			const inner = renderChildren(node)
			// Empty paragraphs are spacing noise to Notion's converter (and the
			// editor's round-trip pass appends one after list blocks); skip them.
			return inner ? `<p>${inner}</p>` : ''
		}
		case 'heading': {
			const raw = Number(node.attrs?.level ?? 1)
			const level = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 4) : 1
			return `<h${level}>${renderChildren(node)}</h${level}>`
		}
		case 'bulletList':
			return `<ul>${renderChildren(node)}</ul>`
		case 'orderedList': {
			const start = Number(node.attrs?.start ?? 1)
			const attr = Number.isFinite(start) && start !== 1 ? ` start="${start}"` : ''
			return `<ol${attr}>${renderChildren(node)}</ol>`
		}
		case 'listItem':
			return `<li>${renderChildren(node)}</li>`
		case 'taskList':
			return `<ul>${renderChildren(node)}</ul>`
		case 'taskItem':
			return renderCheckedTaskItem(node)
		case 'blockquote':
			return `<blockquote>${renderChildren(node)}</blockquote>`
		case 'callout':
			return renderCallout(node)
		case 'codeBlock':
			return renderCodeBlock(node)
		case 'horizontalRule':
			return '<hr>'
		case 'hardBreak':
			return '<br>'
		case 'image': {
			const src = escapeAttr(node.attrs?.src)
			if (!src) return ''
			const alt = node.attrs?.alt ? ` alt="${escapeAttr(node.attrs.alt)}"` : ''
			const title = node.attrs?.title ? ` title="${escapeAttr(node.attrs.title)}"` : ''
			return `<img src="${src}"${alt}${title}>`
		}
		case 'table':
			return `<table><tbody>${renderChildren(node)}</tbody></table>`
		case 'tableRow':
			return `<tr>${renderChildren(node)}</tr>`
		case 'tableHeader':
			return `<th>${renderChildren(node)}</th>`
		case 'tableCell':
			return `<td>${renderChildren(node)}</td>`
		case 'mention': {
			const label = node.attrs?.label ?? node.attrs?.id ?? ''
			return `<span class="mention">${escapeHtml(String(label))}</span>`
		}
		default:
			// Unknown/unsupported node: render children rather than dropping content.
			return renderChildren(node)
	}
}

/** Serialize a Page/selection doc to Notion-paste-friendly HTML. */
export function serializeNotionHtml(doc: JSONContent): string {
	return renderNode(doc)
}
