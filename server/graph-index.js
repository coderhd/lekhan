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
 * tags are lowercased, trimmed and deduped. Anything else (or absent) yields
 * no tags.
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
		if (!tag || seen.has(tag)) continue
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

module.exports = { extractLinks, extractTags, extractPropertyTags, normalizeTitle, getWorkspaceForPage, indexPage }