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
const ROW_NODE_TYPES = new Set(['listItem', 'taskItem'])

/**
 * One capture row's text, with block children separated like the persister's
 * index text. `textContent` concatenates blocks (`#inboxextra note`), which
 * would make a multi-paragraph capture undetectable and its stale-row guard
 * compare the wrong string.
 */
function rowText (node: PMNode): string {
	return node.textBetween(0, node.content.size, '\n', '\n').trim()
}

function isRowNode (node: PMNode): boolean {
	return ROW_NODE_TYPES.has(node.type.name)
}

/** Remove the `#inbox` marker, preserving the rest of the row text. */
export function stripInboxTag (text: string): string {
	return text
		.replace(/(?:^|\s)#inbox\b/gi, ' ')
		.replace(/[ \t]{2,}/g, ' ')
		.trim()
}

/** True when `tag` fits the graph index's `#tag` grammar. */
export function isValidInboxTag (tag: string): boolean {
	return TAG_NAME_RE.test(String(tag ?? '').trim().replace(/^#+/, ''))
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
 * The focused inbox row for the current selection, or `null`.
 *
 * Section-agnostic: any `listItem` tagged `#inbox` is a capture, whether it
 * lives under the daily page's Inbox heading or was sent to another page.
 * This matches the count, which is line-based over the indexed page text.
 */
export function findInboxRowAtSelection (state: EditorState): InboxRow | null {
	const { $from } = state.selection

	for (let depth = $from.depth; depth > 0; depth--) {
		const node = $from.node(depth)
		if (!isRowNode(node)) continue
		const text = rowText(node)
		if (!INBOX_TAG_RE.test(text)) continue
		return { pos: $from.before(depth), text }
	}

	return null
}

/**
 * Delete the whole focused row. When it is the list's only item, delete the
 * empty list too so triage cannot leave an empty bullet behind.
 */
export function deleteInboxRow (view: EditorView, row: InboxRow): boolean {
	const item = view.state.doc.nodeAt(row.pos)
	if (!item || !isRowNode(item)) return false
	// Pos alone is not identity: a collaborator may have inserted above this
	// row while the triage dialog was open. Never delete a different capture.
	if (rowText(item) !== row.text) return false

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
	if (!item || !isRowNode(item)) return false
	// The dialog can stay open across collaborator edits; only rewrite the
	// row if it is still the same capture we captured on keypress.
	if (rowText(item) !== row.text) return false

	// A capture is one paragraph. If the row gained extra blocks, replace its
	// whole content so no stale fragment is left behind.
	if (item.childCount !== 1) {
		const paragraph = view.state.schema.nodes.paragraph.create(
			null,
			text ? view.state.schema.text(text) : null,
		)
		view.dispatch(
			view.state.tr.replaceWith(row.pos + 1, row.pos + item.nodeSize - 1, paragraph).scrollIntoView(),
		)
		return true
	}

	const paragraph = item.firstChild
	if (!paragraph || paragraph.type.name !== 'paragraph') return false

	// listItem > paragraph > inline content
	const from = row.pos + 2
	const to = from + paragraph.content.size
	view.dispatch(view.state.tr.insertText(text, from, to).scrollIntoView())
	return true
}
