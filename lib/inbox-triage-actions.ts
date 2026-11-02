import type { EditorView } from '@tiptap/pm/view'
import { appendBulletToPageSection } from './quick-capture'
import {
	appendInboxTag,
	buildLinkedRowText,
	buildRelatedActionText,
	replaceInboxRowText,
	RELATED_ACTIONS_HEADING,
	type InboxRow,
} from './inbox-triage'

/**
 * The write half of inbox triage (DN-T3).
 *
 * Extracted from the editor component so the two-write `o` flow (rewrite the
 * daily row, append a back-reference to the target page) has a tested
 * ordering and compensation path. Both writes are best-effort over the CRDT
 * channel; the row is only considered processed once the target append lands.
 */

export type InboxTriageErrorCode = 'stale' | 'invalid-tag' | 'forbidden'

export class InboxTriageError extends Error {
	code: InboxTriageErrorCode

	constructor (code: InboxTriageErrorCode, message: string) {
		super(message)
		this.name = 'InboxTriageError'
		this.code = code
	}
}

export interface InboxLinkTarget {
	id: string
	title: string
}

export interface AppendToSectionInput {
	pageId: string
	token: string
	section: string
	text: string
}

export interface LinkInboxRowOptions {
	view: EditorView
	row: InboxRow
	target: InboxLinkTarget
	dailyPageTitle: string
	token: string
	/** Pre-flight permission check (the hub silently drops viewer writes). */
	ensureCanEdit: (pageId: string) => Promise<boolean>
	/** Injection seam for tests; production uses the CRDT append. */
	append?: (input: AppendToSectionInput) => Promise<unknown>
}

/**
 * Link a focused capture to a page.
 *
 * 1. Refuse read-only targets before writing anything.
 * 2. Rewrite the daily row first (local, cheap), dropping `#inbox` and adding
 *    `[[target]]`.
 * 3. Append `[[daily]] <capture>` to the target's Related actions section.
 *    If that append fails, put the pending row back so a retry cannot create a
 *    duplicate back-reference.
 *
 * Throws `InboxTriageError('stale')` when the row changed underneath the dialog
 * (a collaborator inserted or edited above/before it).
 */
export async function linkInboxRow (options: LinkInboxRowOptions): Promise<void> {
	const { view, row, target, dailyPageTitle, token, ensureCanEdit } = options
	const append = options.append ?? appendBulletToPageSection

	if (!(await ensureCanEdit(target.id))) {
		throw new InboxTriageError('forbidden', 'No edit access to that page.')
	}

	const linkedText = buildLinkedRowText(row.text, target.title)
	if (!replaceInboxRowText(view, row, linkedText)) {
		throw new InboxTriageError('stale', 'The capture row moved.')
	}

	try {
		await append({
			pageId: target.id,
			token,
			section: RELATED_ACTIONS_HEADING,
			text: buildRelatedActionText(dailyPageTitle, row.text),
		})
	} catch (error) {
		// Compensate only if the rewritten row is still ours.
		replaceInboxRowText(view, { pos: row.pos, text: linkedText }, row.text)
		throw error
	}
}

export interface TagInboxRowOptions {
	view: EditorView
	row: InboxRow
	tag: string
}

export interface TagInboxRowResult {
	text: string
	/** False when the row already carried the tag (no write happened). */
	changed: boolean
}

/**
 * Add one `#tag` to a focused capture. The row keeps `#inbox`, so it remains
 * pending per the counting rule. Throws `invalid-tag` or `stale`.
 */
export function tagInboxRow (options: TagInboxRowOptions): TagInboxRowResult {
	const { view, row, tag } = options
	const next = appendInboxTag(row.text, tag)
	if (!next) {
		throw new InboxTriageError('invalid-tag', 'Use one tag word.')
	}
	if (next === row.text) {
		return { text: next, changed: false }
	}
	if (!replaceInboxRowText(view, row, next)) {
		throw new InboxTriageError('stale', 'The capture row moved.')
	}
	return { text: next, changed: true }
}
