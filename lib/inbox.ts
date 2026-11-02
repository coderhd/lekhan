import { supabase } from '@/lib/supabase'
import { dailyTitle, isDailyPage, shiftDailyDate } from '@/lib/daily-notes'
import type { Page } from '@/types'

/**
 * Inbox counting and lookup (epic #39, DN-T3).
 *
 * A capture is a pending inbox item while its bullet still carries `#inbox`.
 * Triage removes the marker (link) or the whole bullet (delete), so processed
 * items stop counting without any extra state or schema.
 *
 * The body text comes from `pages.searchable_text`, the graph index the hub
 * persister maintains from the page's Yjs document. There is no second copy and
 * no per-page CRDT connection on the dashboard.
 */

export const INBOX_TAG = 'inbox'
export const INBOX_WINDOW_DAYS = 14

export interface InboxItem {
	/** The daily page that holds the bullet. */
	pageId: string
	/** The daily page title (`YYYY-MM-DD`), which is also the capture's day. */
	pageTitle: string
	/** The bullet text, without a leading markdown bullet marker. */
	text: string
}

type InboxRow = Page & {
	searchable_text?: string | null
	page_tags?: Array<{ tag?: string | null }> | null
}

const BULLET_PREFIX_RE = /^\s*(?:[-*+]|\d+[.)])\s+/
// Same boundary as the graph index: `#inboxing` is a different tag.
const INBOX_TAG_RE = /(?:^|\s)#inbox(?=\s|$|[.,;:!?)\]])/i

/**
 * The daily dates in the inbox window, newest first. Local calendar days only:
 * a workspace's "today" is the user's today (DN-T1's timezone decision).
 */
export function inboxWindowDates (now: Date, days = INBOX_WINDOW_DAYS): Date[] {
	if (!Number.isFinite(days) || days <= 0) return []
	return Array.from({ length: Math.floor(days) }, (_, index) => shiftDailyDate(now, -index))
}

/**
 * The pending capture lines in one page body.
 *
 * `searchable_text` joins block nodes with newlines (see `server/persister.js`);
 * a line counts when it still has the `#inbox` marker. Processed lines (linked
 * or deleted) have lost the marker and are excluded here.
 */
export function pendingInboxLines (text: string | null | undefined): string[] {
	return String(text ?? '')
		.split(/\r?\n/)
		.map(line => line.replace(BULLET_PREFIX_RE, '').trim())
		.filter(Boolean)
		.filter(line => INBOX_TAG_RE.test(line))
}

export interface FetchInboxOptions {
	/** Injection seam for deterministic tests; production uses the local today. */
	now?: Date
	days?: number
	/** Top-N limit for the dashboard card; omit for the full count. */
	limit?: number
}

/**
 * Load the workspace's pending inbox items for the last 14 local days.
 *
 * Newest day first; within a day, the newest capture first (captures append to
 * the end of the section). This is the "top five" order on the dashboard card.
 */
export async function fetchInboxItems (
	workspaceId: string,
	options: FetchInboxOptions = {},
): Promise<InboxItem[]> {
	const { now = new Date(), days = INBOX_WINDOW_DAYS, limit } = options
	const titles = inboxWindowDates(now, days).map(dailyTitle)
	if (titles.length === 0) return []

	const { data, error } = await supabase
		.from('pages')
		.select('*, page_tags (tag)')
		.eq('workspace_id', workspaceId)
		.in('title', titles)

	if (error) {
		throw error
	}

	const pages = ((data ?? []) as InboxRow[])
		.filter(isDailyPage)
		.sort((a, b) => b.title.localeCompare(a.title))

	const items: InboxItem[] = []
	for (const page of pages) {
		const lines = pendingInboxLines(page.searchable_text)
		for (let index = lines.length - 1; index >= 0; index--) {
			items.push({ pageId: page.id, pageTitle: page.title, text: lines[index] })
		}
	}

	return typeof limit === 'number' ? items.slice(0, Math.max(0, limit)) : items
}
