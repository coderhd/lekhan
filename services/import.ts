import { createPage } from '@/services/graph'
import { parseFrontmatter, parseMarkdown } from '@/lib/markdown-io'
import type { Page } from '@/types'

/**
 * Per-tab payload store for import hydration. A module-scoped Map that
 * survives `router.push` within the same tab, keyed by the newly created
 * page id. A full page refresh re-initializes the module, so a refresh
 * before hydration simply opens the page empty (the pending payload is gone).
 */
const pendingPayloads = new Map<string, string>()

export interface ImportMarkdownOptions {
	workspaceId: string
	ownerId: string
	filename?: string
}

/**
 * Derive a page title from a filename: the extension is stripped and
 * separators collapse to spaces. The design's fallback when the frontmatter
 * has no `title`.
 */
export function titleFromFilename(filename: string): string {
	const base = filename.replace(/\.(md|markdown|mdown|txt)$/i, '').trim()
	if (!base) return 'Untitled'
	return base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Import a `.md` file as a new page: frontmatter → title/properties/tags,
 * body parsed via the round-trip engine (validating parseability before the
 * page is created), then the page is created and the raw body is stashed in
 * the per-tab payload store keyed by the new page id. Returns the created
 * page so the caller can navigate to `/page/{id}`.
 *
 * On any error — empty file, malformed frontmatter, a body the engine cannot
 * parse, or a failed insert — nothing is created and nothing is stashed.
 */
export async function importMarkdownFile (
	fileText: string,
	{ workspaceId, ownerId, filename }: ImportMarkdownOptions
): Promise<Page> {
	if (fileText.trim() === '') {
		throw new Error('File is empty. Nothing to import.')
	}

	const { data, body } = parseFrontmatter(fileText)

	const title = data.title ?? titleFromFilename(filename ?? '')

	const properties: Record<string, unknown> = { ...data.properties }
	if (data.tags && data.tags.length > 0) {
		properties.tags = data.tags
	}

	// Parse the body through the round-trip engine. This is the fidelity gate:
	// malformed input surfaces here as an error before any page is created.
	parseMarkdown(body)

	const page = await createPage(workspaceId, ownerId, null, { title, properties })

	pendingPayloads.set(page.id, body)
	return page
}

/**
 * Read and clear the pending import payload for a page. Returns `null` when
 * there is nothing pending (e.g. after a refresh, or for a page that was not
 * imported). Consumption happens here — the caller hands the markdown string
 * to `EditorWorkspace` as `initialContent`, which hydrates on first mount.
 */
export function consumePendingImport (pageId: string): string | null {
	const payload = pendingPayloads.get(pageId)
	if (payload !== undefined) {
		pendingPayloads.delete(pageId)
		return payload
	}
	return null
}