import { ghostNodeId, type GraphEdge, type GraphNode, type GraphTagFacet, type WorkspaceGraphData, type WorkspaceGraphInput } from './types'

/**
 * Shape the read-only graph rows into the client's graph payload.
 *
 * Pages are nodes and `page_links` rows are edges. A link whose `to_page_id`
 * is NULL is an unresolved target; it is kept — never dropped — as a ghost
 * node labelled with `to_title`, deduped case-insensitively so ten pages
 * linking to the same unwritten note share one ghost. `page_tags` becomes both
 * per-node tags and the workspace tag facets the filter pane consumes.
 *
 * Pure and read-only: the only sources are the rows passed in.
 */
export function serializeWorkspaceGraph ({ pages, links, tagsByPage }: WorkspaceGraphInput): WorkspaceGraphData {
	const tags = tagsByPage ?? new Map<string, string[]>()
	const nodes: GraphNode[] = pages.map(page => ({
		id: page.id,
		kind: 'page',
		title: page.title,
		tags: tags.get(page.id) ?? [],
		isPublic: page.is_public,
		updatedAt: page.updated_at,
	}))

	const pageIds = new Set(pages.map(page => page.id))
	// Display title for each ghost id, first spelling wins.
	const ghostTitles = new Map<string, string>()
	const edges: GraphEdge[] = []
	let unresolvedLinks = 0

	for (const link of links) {
		if (!pageIds.has(link.from_page_id)) continue

		let target = link.to_page_id
		let unresolved = false

		if (target === null) {
			const title = link.to_title.trim()
			if (!title) continue
			const ghostId = ghostNodeId(title)
			if (!ghostTitles.has(ghostId)) ghostTitles.set(ghostId, title)
			target = ghostId
			unresolved = true
		} else if (!pageIds.has(target)) {
			// The target belongs to another workspace or was deleted between the
			// two reads; an edge to nowhere is worse than skipping the row.
			continue
		}

		// A page linking to itself carries no information in a force graph.
		if (target === link.from_page_id) continue

		if (unresolved) unresolvedLinks += 1
		edges.push({ id: link.id, source: link.from_page_id, target, unresolved })
	}

	for (const [id, title] of ghostTitles) {
		nodes.push({
			id,
			kind: 'unresolved',
			title,
			tags: [],
			isPublic: false,
			updatedAt: null,
		})
	}

	return {
		nodes,
		edges,
		tags: buildTagFacets(nodes),
		totalPages: pages.length,
		totalLinks: links.length,
		unresolvedLinks,
	}
}

/** Workspace tag facets, most-used first, ties alphabetical. */
function buildTagFacets (nodes: GraphNode[]): GraphTagFacet[] {
	const counts = new Map<string, number>()
	for (const node of nodes) {
		for (const tag of node.tags) {
			counts.set(tag, (counts.get(tag) ?? 0) + 1)
		}
	}
	return [...counts.entries()]
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}
