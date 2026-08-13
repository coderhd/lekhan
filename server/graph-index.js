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

async function getWorkspaceForPage (supabaseAdmin, pageId) {
	const { data, error } = await supabaseAdmin
		.from('pages')
		.select('workspace_id')
		.eq('id', pageId)
		.maybeSingle()
	if (error) {
		throw error
	}
	return data ? data.workspace_id : null
}

async function indexPage (supabaseAdmin, pageId, text) {
	const workspaceId = await getWorkspaceForPage(supabaseAdmin, pageId)
	let links = 0
	let tags = 0

	if (workspaceId) {
		const { data: workspacePages, error: workspaceError } = await supabaseAdmin
			.from('pages')
			.select('id, title')
			.eq('workspace_id', workspaceId)
		if (workspaceError) {
			throw workspaceError
		}

		const titleIndex = new Map()
		for (const page of workspacePages || []) {
			titleIndex.set(normalizeTitle(page.title), page.id)
		}

		const linkRows = extractLinks(text).map(link => ({
			workspace_id: workspaceId,
			from_page_id: pageId,
			to_page_id: titleIndex.get(normalizeTitle(link.title)) || null,
			to_title: link.title,
		}))

		const { error: linksDeleteError } = await supabaseAdmin
			.from('page_links')
			.delete()
			.eq('from_page_id', pageId)
		if (linksDeleteError) {
			throw linksDeleteError
		}
		if (linkRows.length > 0) {
			const { error: linksInsertError } = await supabaseAdmin
				.from('page_links')
				.insert(linkRows)
			if (linksInsertError) {
				throw linksInsertError
			}
		}

		const tagRows = extractTags(text).map(tag => ({ page_id: pageId, tag }))

		const { error: tagsDeleteError } = await supabaseAdmin
			.from('page_tags')
			.delete()
			.eq('page_id', pageId)
		if (tagsDeleteError) {
			throw tagsDeleteError
		}
		if (tagRows.length > 0) {
			const { error: tagsInsertError } = await supabaseAdmin
				.from('page_tags')
				.insert(tagRows)
			if (tagsInsertError) {
				throw tagsInsertError
			}
		}

		links = linkRows.length
		tags = tagRows.length
	}

	const { error: updateError } = await supabaseAdmin
		.from('pages')
		.update({
			searchable_text: text,
			updated_at: new Date().toISOString(),
		})
		.eq('id', pageId)
	if (updateError) {
		throw updateError
	}

	return { links, tags }
}

module.exports = { extractLinks, extractTags, normalizeTitle, getWorkspaceForPage, indexPage }