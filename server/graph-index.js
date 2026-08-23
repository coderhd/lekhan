const MARKDOWN_LINK_RE = /\[\[([^[\]|]+?)(?:\|([^[\]]+?))?\]\]/g
const TAG_RE = /(?:^|[\s(])#([a-zA-Z0-9_][a-zA-Z0-9_\-/]*)/g

function normalizeTitle (title) {
	return String(title || '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim()
}

function extractLinks (text) {
	if (typeof text !== 'string') return []
	const links = []
	const seen = new Set()
	let match
	MARKDOWN_LINK_RE.lastIndex = 0
	while ((match = MARKDOWN_LINK_RE.exec(text)) !== null) {
		const title = match[1].trim()
		if (!title) continue
		const normalized = normalizeTitle(title)
		if (seen.has(normalized)) continue
		seen.add(normalized)
		links.push({ title, alias: match[2] ? match[2].trim() : null })
	}
	return links
}

function extractTags (text) {
	if (typeof text !== 'string') return []
	const tags = []
	const seen = new Set()
	let match
	TAG_RE.lastIndex = 0
	while ((match = TAG_RE.exec(text)) !== null) {
		const tag = match[1].toLowerCase()
		if (seen.has(tag)) continue
		seen.add(tag)
		tags.push(tag)
	}
	return tags
}

/**
 * Fold frontmatter tags (`pages.properties.tags`) into the tag index so
 * imported and properties-driven tags are searchable like body `#tags`.
 * Accepts an array of strings or a single comma/space-separated string;
 * tags are lowercased, trimmed and deduped, and constrained to the same
 * character set as body `#tags` (so `page_tags` rows stay consistent).
 * Anything else (or absent) yields no tags.
 */
function extractPropertyTags (properties) {
	if (!properties || typeof properties !== 'object') return []
	const raw = properties.tags
	const values = Array.isArray(raw)
		? raw.filter(t => typeof t === 'string')
		: (typeof raw === 'string' ? raw.split(/[,\s]+/) : [])
	const tags = []
	const seen = new Set()
	for (const value of values) {
		const tag = value.trim().toLowerCase()
		if (!tag || !/^[a-zA-Z0-9_][a-zA-Z0-9_\-/]*$/.test(tag) || seen.has(tag)) continue
		seen.add(tag)
		tags.push(tag)
	}
	return tags
}

async function getWorkspaceForPage (supabaseAdmin, pageId) {
	const { data, error } = await supabaseAdmin
		.from('pages')
		.select('workspace_id, properties')
		.eq('id', pageId)
		.maybeSingle()
	if (error) {
		throw error
	}
	return data
		? { workspaceId: data.workspace_id, properties: data.properties || {} }
		: null
}

async function indexPage (supabaseAdmin, pageId, text) {
	const page = await getWorkspaceForPage(supabaseAdmin, pageId)
	let linkRows = []
	let tagRows = []

	if (page) {
		const { data: workspacePages, error: workspaceError } = await supabaseAdmin
			.from('pages')
			.select('id, title')
			.eq('workspace_id', page.workspaceId)
		if (workspaceError) {
			throw workspaceError
		}

		const titleIndex = new Map()
		for (const workspacePage of workspacePages || []) {
			titleIndex.set(normalizeTitle(workspacePage.title), workspacePage.id)
		}

		linkRows = extractLinks(text).map(link => ({
			workspace_id: page.workspaceId,
			from_page_id: pageId,
			to_page_id: titleIndex.get(normalizeTitle(link.title)) || null,
			to_title: link.title,
		}))
		tagRows = extractTags(text).map(tag => ({ page_id: pageId, tag }))
		for (const tag of extractPropertyTags(page.properties)) {
			if (!tagRows.some(row => row.tag === tag)) {
				tagRows.push({ page_id: pageId, tag })
			}
		}
	}

	const { data, error } = await supabaseAdmin.rpc('sync_page_graph', {
		p_page_id: pageId,
		p_workspace_id: page ? page.workspaceId : null,
		p_searchable_text: text,
		p_links: linkRows,
		p_tags: tagRows,
	})
	if (error) {
		throw error
	}

	return { links: data?.links ?? 0, tags: data?.tags ?? 0 }
}

/**
 * Bulk variant of indexPage for import batches: loads each page's row once and
 * builds one title index per distinct workspace, instead of re-fetching the
 * whole workspace per page (indexPage is O(pages × workspace) when called in a
 * loop). Per-page failures are isolated — collected into `errors` rather than
 * thrown — so one bad page cannot fail the batch.
 */
async function indexPages (supabaseAdmin, items) {
	const indexed = []
	const errors = []
	if (!Array.isArray(items) || items.length === 0) {
		return { indexed, errors }
	}

	const ids = items.map(item => item.pageId)
	const { data: pageRows, error: pagesError } = await supabaseAdmin
		.from('pages')
		.select('id, workspace_id, properties')
		.in('id', ids)
	if (pagesError) {
		throw pagesError
	}
	const rowsById = new Map((pageRows || []).map(row => [row.id, row]))

	const titleIndexes = new Map()
	async function titleIndexFor (workspaceId) {
		let titleIndex = titleIndexes.get(workspaceId)
		if (titleIndex) {
			return titleIndex
		}
		const { data: workspacePages, error } = await supabaseAdmin
			.from('pages')
			.select('id, title')
			.eq('workspace_id', workspaceId)
		if (error) {
			throw error
		}
		titleIndex = new Map()
		for (const workspacePage of workspacePages || []) {
			titleIndex.set(normalizeTitle(workspacePage.title), workspacePage.id)
		}
		titleIndexes.set(workspaceId, titleIndex)
		return titleIndex
	}

	for (const item of items) {
		try {
			const row = rowsById.get(item.pageId)
			if (!row) {
				throw new Error('Page row not found')
			}
			const titleIndex = await titleIndexFor(row.workspace_id)
			const linkRows = extractLinks(item.plainText).map(link => ({
				workspace_id: row.workspace_id,
				from_page_id: item.pageId,
				to_page_id: titleIndex.get(normalizeTitle(link.title)) || null,
				to_title: link.title,
			}))
			const tagRows = extractTags(item.plainText).map(tag => ({ page_id: item.pageId, tag }))
			for (const tag of extractPropertyTags(row.properties || {})) {
				if (!tagRows.some(rowTag => rowTag.tag === tag)) {
					tagRows.push({ page_id: item.pageId, tag })
				}
			}
			const { error } = await supabaseAdmin.rpc('sync_page_graph', {
				p_page_id: item.pageId,
				p_workspace_id: row.workspace_id,
				p_searchable_text: item.plainText,
				p_links: linkRows,
				p_tags: tagRows,
			})
			if (error) {
				throw error
			}
			indexed.push(item.pageId)
		} catch (err) {
			const message = err instanceof Error
				? err.message
				: (err && typeof err === 'object' && 'message' in err)
					? String(err.message)
					: String(err)
			errors.push({
				pageId: item.pageId,
				error: message,
			})
		}
	}
	return { indexed, errors }
}

module.exports = { extractLinks, extractTags, extractPropertyTags, normalizeTitle, getWorkspaceForPage, indexPage, indexPages }