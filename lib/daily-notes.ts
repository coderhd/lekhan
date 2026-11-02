import { supabase } from '@/lib/supabase'
import { createPage } from '@/services/graph'
import type { Page, Workspace } from '@/types'

/**
 * Daily notes are plain Pages (see CONTEXT.md: Page, never "note").
 *
 * A daily page is a top-level Page whose title is the client-local date in
 * `YYYY-MM-DD` form, tagged `#daily` and carrying a `properties.daily` marker.
 * Uniqueness is by convention, not a database constraint: `ensureDailyPage`
 * reuses the existing daily page for a date instead of creating a second one.
 *
 * Timezone decision (spec: 2026-11-02 H1 design): the date is the *client-local*
 * calendar day. A workspace's daily page always names the day the user means,
 * so UTC drift is accepted in v1. Never use toISOString() here — it formats in
 * UTC and would name the wrong day for users west of Greenwich after 00:00 UTC.
 */
export const dailyTag = 'daily'

/** The minimum workspace shape `ensureDailyPage` needs. */
export type DailyWorkspace = Pick<Workspace, 'id' | 'owner_id'>

/** A page row with its graph-indexed tags embedded (`page_tags (tag)`). */
type DailyPageRow = Page & { page_tags?: Array<{ tag?: string | null }> | null }

/** Format a date as the canonical daily-page title: local `YYYY-MM-DD`. */
export function dailyTitle (date: Date): string {
	const year = date.getFullYear()
	const month = String(date.getMonth() + 1).padStart(2, '0')
	const day = String(date.getDate()).padStart(2, '0')
	return `${year}-${month}-${day}`
}

/**
 * Move a date by whole days in local time, returned at local midnight so
 * day arithmetic never drifts across DST transitions or month boundaries.
 */
export function shiftDailyDate (date: Date, days: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

/** True when a page carries any of the daily markers (properties or #daily tag). */
export function isDailyPage (page: Pick<Page, 'properties'> & Pick<Partial<DailyPageRow>, 'page_tags'>): boolean {
	const properties = page.properties ?? {}

	if (properties.daily === true) {
		return true
	}

	// Imported/frontmatter pages keep tags in properties.tags; the graph index
	// folds them into page_tags on save, but the raw marker is available first.
	const rawTags = properties.tags
	const tags = Array.isArray(rawTags)
		? rawTags.map(tag => String(tag))
		: typeof rawTags === 'string'
			? rawTags.split(/[,\s]+/)
			: []
	if (tags.some(tag => tag.trim().toLowerCase() === dailyTag)) {
		return true
	}

	return (page.page_tags ?? []).some(row => String(row?.tag ?? '').trim().toLowerCase() === dailyTag)
}

async function findDailyPage (workspaceId: string, title: string): Promise<Page | null> {
	const { data, error } = await supabase
		.from('pages')
		.select('*, page_tags (tag)')
		.eq('workspace_id', workspaceId)
		.eq('title', title)
		.order('updated_at', { ascending: false })

	if (error) {
		throw error
	}

	const rows = (data ?? []) as unknown as DailyPageRow[]
	const existing = rows.find(isDailyPage)
	return existing ?? null
}

/**
 * In-flight dedupe: a double-click (or the strip plus a keyboard shortcut)
 * must not race two creates for the same date. Entries are removed as soon as
 * the promise settles so a failed call can be retried.
 */
const inFlight = new Map<string, Promise<Page>>()

/**
 * Return the workspace's daily page for `date`, creating it when missing.
 *
 * The created page carries `properties: { daily: true, tags: ['daily'] }` so
 * the graph index tags it `#daily` on its next save — no new write path and no
 * schema change. `properties.daily` is the authoritative marker for reuse/dots
 * (the graph tag index lags creation until the page is first saved).
 *
 * Existing pages are matched by exact title plus any daily marker, regardless
 * of nesting: if a user (or an importer) already made `YYYY-MM-DD` a daily page
 * under a parent, reusing it beats creating a second page with the same title
 * (the locked "one page per date per workspace" invariant). New pages are
 * always created top-level. A same-titled page that is not a daily page is
 * left alone.
 *
 * `workspace.owner_id` is the page's creator and must be the acting user
 * (`auth.uid()`), not merely the workspace owner — today H0 workspaces are
 * owner-scoped, but team workspaces will need the caller's id here.
 */
export function ensureDailyPage (workspace: DailyWorkspace, date: Date): Promise<Page> {
	const title = dailyTitle(date)
	const key = `${workspace.id}|${title}`

	const pending = inFlight.get(key)
	if (pending) {
		return pending
	}

	const request = (async () => {
		const existing = await findDailyPage(workspace.id, title)
		if (existing) {
			return existing
		}

		return createPage(workspace.id, workspace.owner_id, null, {
			title,
			properties: { daily: true, tags: [dailyTag] },
		})
	})()

	inFlight.set(key, request)
	request.then(
		() => { inFlight.delete(key) },
		() => { inFlight.delete(key) },
	)

	return request
}

/**
 * Load the daily pages for a set of dates, keyed by title. Used for the
 * dashboard dot indicators: one query per visible window, no N+1 lookups.
 */
export async function fetchDailyPages (workspaceId: string, dates: Date[]): Promise<Map<string, Page>> {
	const titles = dates.map(dailyTitle)
	if (titles.length === 0) {
		return new Map()
	}

	const { data, error } = await supabase
		.from('pages')
		.select('*, page_tags (tag)')
		.eq('workspace_id', workspaceId)
		.in('title', titles)

	if (error) {
		throw error
	}

	const pages = new Map<string, Page>()
	for (const row of (data ?? []) as unknown as DailyPageRow[]) {
		if (isDailyPage(row)) {
			pages.set(row.title, row)
		}
	}
	return pages
}
