import { Node, mergeAttributes } from '@tiptap/core'

export const CALLOUT_TYPES = ['note', 'warning', 'info', 'tip', 'success', 'danger', 'question'] as const

export type CalloutType = (typeof CALLOUT_TYPES)[number]

/** Minimal structural type for the markdown-it instance passed to `parse.setup`. */
export interface MarkdownItLike {
	core: {
		ruler: {
			push: (name: string, rule: (state: unknown) => void) => void
		}
	}
}

const MARKER_RE = /^\[!([a-zA-Z0-9 ]+)\](?:(-))?(?: +([^\n]*))?/

/** Input-rule match: `> [!note]` / `> [!note]-` / `> [!note] Title` followed by a space. */
export const MARKER_INPUT_RE = /^> \[!([a-zA-Z0-9 ]+)\](-)?(?: +([^\n]*))? $/

function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Rewrite markdown-it's token stream: a blockquote whose first line is a
 * `[!type]` marker becomes a callout. The marker line's type/title/collapsed
 * become the node's attrs (emitted as `data-callout-*`); the body lines are
 * re-emitted as separate paragraphs (markdown-it flattens adjacent `> ` lines
 * into a single paragraph, and splitting on the softbreaks keeps the line
 * structure Obsidian preserves).
 */
function calloutCoreRule(state: any) {
	const tokens = state.tokens
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i].type !== 'blockquote_open') continue

		// Find the matching blockquote_close.
		let depth = 1
		let end = i + 1
		for (; end < tokens.length; end++) {
			if (tokens[end].type === 'blockquote_open') depth++
			else if (tokens[end].type === 'blockquote_close') {
				depth--
				if (depth === 0) break
			}
		}
		if (end >= tokens.length) continue

		// First child must be a paragraph holding an inline token.
		const paraOpen = tokens[i + 1]
		const inlineTok = tokens[i + 2]
		if (!paraOpen || paraOpen.type !== 'paragraph_open') continue
		if (!inlineTok || inlineTok.type !== 'inline') continue

		const content = inlineTok.content
		const match = content.match(MARKER_RE)
		if (!match) continue

		const type = match[1].trim().toLowerCase()
		const collapsed = Boolean(match[2])
		const title = (match[3] ?? '').trim()

		// Rebuild the body as separate paragraphs: strip the marker text from
		// the first inline token's children, then split the remainder on
		// softbreaks so adjacent `> ` lines become distinct paragraphs.
		const md = state.md
		const firstParaChildren = (inlineTok.children as any[]).filter((c) => c.type !== 'softbreak')
		const markerLength = match[0].length
		firstParaChildren[0] = new state.Token('text', '', 0)
		firstParaChildren[0].content = content.slice(markerLength).replace(/^\n/, '')

		const replacement: any[] = []
		const open = new state.Token('callout_open', 'div', 1)
		open.meta = { type, title, collapsed }
		replacement.push(open)

		// Body paragraphs: first paragraph from the stripped inline children,
		// then every paragraph token that follows inside the blockquote.
		const bodyFirst = firstParaChildren.length > 0 && firstParaChildren[0].content.trim() !== ''
		if (bodyFirst) {
			const pOpen = new state.Token('paragraph_open', 'p', 1)
			replacement.push(pOpen)
			const inline = new state.Token('inline', '', 0)
			inline.content = firstParaChildren[0].content
			inline.children = []
			md.inline.parse(inline.content, md, state.env, inline.children)
			replacement.push(inline)
			replacement.push(new state.Token('paragraph_close', 'p', -1))
		}

		// Every remaining token up to blockquote_close (later paragraphs,
		// lists, code) is preserved verbatim. i + 3 is the first paragraph's
		// own paragraph_close, which is dropped because the first paragraph
		// is rebuilt above.
		for (let t = i + 4; t < end; t++) {
			replacement.push(tokens[t])
		}

		replacement.push(new state.Token('callout_close', 'div', -1))

		tokens.splice(i, end - i + 1, ...replacement)
		i += replacement.length
	}
}

function renderCalloutOpen(tokens: any[], idx: number) {
	const t = tokens[idx]
	return (
		`<div data-callout="true" data-callout-type="${escapeHtml(t.meta.type)}" ` +
		`data-callout-title="${escapeHtml(t.meta.title)}" data-callout-collapsed="${String(t.meta.collapsed)}">\n`
	)
}

export const Callout = Node.create({
	name: 'callout',

	group: 'block',

	content: 'block+',

	defining: true,

	draggable: true,

	addAttributes() {
		return {
			type: { default: 'note' },
			title: { default: '' },
			collapsed: { default: false },
		}
	},

	parseHTML() {
		return [
			{
				tag: 'div[data-callout]',
				getAttrs: (el) => {
					const htmlEl = el as HTMLElement
					return {
						type: htmlEl.getAttribute('data-callout-type') || 'note',
						title: htmlEl.getAttribute('data-callout-title') || '',
						collapsed: htmlEl.getAttribute('data-callout-collapsed') === 'true',
					}
				},
			},
		]
	},

	renderHTML({ node, HTMLAttributes }) {
		const { type, title, collapsed } = node.attrs
		const attrs = mergeAttributes(HTMLAttributes, {
			class: `callout callout-${type}`,
			'data-callout': 'true',
			'data-callout-type': type,
			'data-callout-title': title,
			'data-callout-collapsed': String(collapsed),
		})
		// Only the data-callout-* attributes survive serialization — raw
		// attrs (type/title/collapsed) must not leak into exported HTML.
		delete attrs.type
		delete attrs.title
		delete attrs.collapsed
		return [
			'div',
			attrs,
			title ? ['div', { class: 'callout-title' }, title] : ['div', { class: 'callout-title' }],
			['div', { class: 'callout-content' }, 0],
		]
	},

	addStorage() {
		return {
			markdown: {
				serialize(state: any, node: any) {
					const { type, title, collapsed } = node.attrs
					const marker = collapsed ? '-' : ''
					state.write(`> [!${type}]${marker}${title ? ` ${title}` : ''}`)
					state.ensureNewLine()
					// One wrapBlock around all body content keeps the `> `
					// delim active across child boundaries, so blank lines
					// between body paragraphs stay inside the blockquote.
					state.wrapBlock('> ', '> ', node, () => state.renderContent(node))
				},
				parse: {
					setup(markdownit: MarkdownItLike) {
						markdownit.core.ruler.push('lekhan_callout', calloutCoreRule)
						const md = markdownit as any
						md.renderer.rules.callout_open = renderCalloutOpen
						md.renderer.rules.callout_close = () => '</div>\n'
					},
				},
			},
		}
	},
})