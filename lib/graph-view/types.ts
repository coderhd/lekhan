import type { Page, PageLink } from '@/types'

/** A page in the workspace graph, or a ghost node standing in for an unresolved link target. */
export interface GraphNode {
	id: string
	kind: 'page' | 'unresolved'
	title: string
	tags: string[]
	isPublic: boolean
	/** ISO timestamp of the page's last edit; `null` for ghost nodes. */
	updatedAt: string | null
}

export interface GraphEdge {
	id: string
	/** Node id of the linking page. */
	source: string
	/** Node id of the target page (or `ghost:<title>` for an unresolved link). */
	target: string
	unresolved: boolean
}

/** A tag facet over the whole workspace, for the (GV-T2) tag filter. */
export interface GraphTagFacet {
	tag: string
	count: number
}

export interface WorkspaceGraphData {
	nodes: GraphNode[]
	edges: GraphEdge[]
	tags: GraphTagFacet[]
	/** Pages read from `pages`; excludes ghost nodes. */
	totalPages: number
	/** Link rows read from `page_links`, before any dropping. */
	totalLinks: number
	/** Edges rendered against a ghost node. */
	unresolvedLinks: number
}

export interface WorkspaceGraphInput {
	pages: Page[]
	links: PageLink[]
	/** `page_tags` grouped by `page_id`, as returned by `fetchWorkspacePageTags`. */
	tagsByPage?: Map<string, string[]>
}

export const GHOST_NODE_PREFIX = 'ghost:'

/** Stable ghost id for an unresolved `to_title`, case/whitespace insensitive. */
export function ghostNodeId (title: string): string {
	return `${GHOST_NODE_PREFIX}${title.trim().toLowerCase()}`
}
