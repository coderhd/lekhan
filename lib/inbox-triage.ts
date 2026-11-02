import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/**
 * Inbox triage helpers (epic #39, DN-T3).
 *
 * A capture row is a `listItem` under an `Inbox` heading whose text still
 * carries `#inbox`. Triage mutates that row in place through the live editor
 * transaction, so the change is an ordinary CRDT update and collaborators see
 * it immediately. Linking also appends a back-reference to the target page over
 * that page's CRDT channel (see `appendBulletToPageSection`).
 */

/** A focused inbox row: its list-item position, text, and the marker text. */
export interface InboxRow {
	/** Position immediately before the `listItem` node. */
	pos: number
	/** Full plain text of the list item. */
	text: string
}

const INBOX_TAG_RE = /(?:^|\s)#inbox\b/i
const TAG_NAME_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_\-/]*$/

/** Remove the `#inbox` marker, preserving the rest of the row text. */
export function stripInboxTag (text: string): string {
	return text
		.replace(/(?:^|\s)#inbox\b/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

/** The target page section that receives a linked capture. */
export const RELATED_ACTIONS_HEADING = 'Related actions'

/** The processed daily row: capture text plus a link to the chosen page. */
export function buildLinkedRowText (text: string, targetTitle: string): string {
	return `${stripInboxTag(text)} [[${targetTitle}]]`.trim()
}

/** The bullet written to the target page: a link back to the daily page. */
export function buildRelatedActionText (dailyPageTitle: string, text: string): string {
	return `[[${dailyPageTitle}]] ${stripInboxTag(text)}`.trim()
}

/**
 * Append one `#tag` to the row. The tag keeps `#inbox`, so a tagged capture
 * remains pending (the spec's counting rule only exempts linked/deleted items).
 * Returns `null` for text outside the graph index's `#tag` grammar.
 */
export function appendInboxTag (text: string, tag: string): string | null {
	const normalized = String(tag ?? '').trim().replace(/^#+/, '').toLowerCase()
	if (!TAG_NAME_RE.test(normalized)) return null

	const existing = new RegExp(`(?:^|\\s)#${escapeRegExp(normalized)}\\b`, 'i')
	if (existing.test(text)) return text
	return `${text.trimEnd()} #${normalized}`
}

function escapeRegExp (value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * True when `pos` (a list-item position) sits between an `Inbox` heading
 * (level ≤ 2) and the next heading that starts a sibling section.
 */
export function isInboxRowPosition (doc: PMNode, pos: number): boolean {
	let inInboxSection = false
	let inside = false

	doc.forEach((node, offset) => {
		if (inside) return
		if (node.type.name === 'heading') {
			inInboxSection =
				node.textContent.trim().toLowerCase() === 'inbox' &&
				Number(node.attrs.level ?? 1) <= 2
			return
		}
		if (inInboxSection && pos > offset && pos < offset + node.nodeSize) {
			inside = true
		}
	})

	return inside
}

/** The focused inbox row for the current selection, or `null`. */
export function findInboxRowAtSelection (state: EditorState): InboxRow | null {
	const { $from } = state.selection

	for (let depth = $from.depth; depth > 0; depth--) {
		const node = $from.node(depth)
		if (node.type.name !== 'listItem') continue
		if (!INBOX_TAG_RE.test(node.textContent)) continue

		const pos = $from.before(depth)
		if (!isInboxRowPosition(state.doc, pos)) continue
		return { pos, text: node.textContent }
	}

	return null
}

/**
 * Delete the whole focused row. When it is the list's only item, delete the
 * empty list too so triage cannot leave an empty bullet behind.
 */
export function deleteInboxRow (view: EditorView, row: InboxRow): boolean {
	const item = view.state.doc.nodeAt(row.pos)
	if (!item || item.type.name !== 'listItem') return false

	const $pos = view.state.doc.resolve(row.pos)
	const parent = $pos.parent
	const parentStart = $pos.before($pos.depth)
	const removeParent = parent.childCount === 1
	const from = removeParent ? parentStart : row.pos
	const to = removeParent ? parentStart + parent.nodeSize : row.pos + item.nodeSize

	view.dispatch(view.state.tr.delete(from, to).scrollIntoView())
	return true
}

/** Replace the focused row's text, keeping its list item and position. */
export function replaceInboxRowText (view: EditorView, row: InboxRow, text: string): boolean {
	const item = view.state.doc.nodeAt(row.pos)
	if (!item || item.type.name !== 'listItem') return false

	const paragraph = item.firstChild
	if (!paragraph || paragraph.type.name !== 'paragraph') return false

	// listItem > paragraph > inline content
	const from = row.pos + 2
	const to = from + paragraph.content.size
	view.dispatch(view.state.tr.insertText(text, from, to).scrollIntoView())
	return true
}
