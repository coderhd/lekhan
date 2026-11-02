import type { GraphEdge, GraphNode, WorkspaceGraphData } from './types'

/** Client-side graph filter: a title substring plus multi-select tag facets. */
export interface GraphFilterState {
	title: string
	tags: string[]
}

export const EMPTY_GRAPH_FILTER: GraphFilterState = { title: '', tags: [] }

export type GraphFilterAction =
	| { type: 'set-title'; title: string }
	| { type: 'toggle-tag'; tag: string }
	| { type: 'clear' }

/** Filter state reducer. Pure: returns the same state value for no-op actions. */
export function graphFilterReducer (state: GraphFilterState, action: GraphFilterAction): GraphFilterState {
	switch (action.type) {
		case 'set-title':
			return state.title === action.title ? state : { ...state, title: action.title }
		case 'toggle-tag': {
			const selected = state.tags.includes(action.tag)
			return {
				...state,
				tags: selected ? state.tags.filter(tag => tag !== action.tag) : [...state.tags, action.tag],
			}
		}
		case 'clear':
			return { title: '', tags: [] }
		default:
			return state
	}
}

export function isGraphFilterActive (state: GraphFilterState): boolean {
	return state.title.trim().length > 0 || state.tags.length > 0
}

export interface FilteredGraph {
	nodes: GraphNode[]
	edges: GraphEdge[]
	hiddenNodes: number
	hiddenEdges: number
}

/**
 * Apply the title and tag-facet filters to the raw graph payload.
 *
 * Semantics (v1, locked here):
 * - Title is a trimmed, case-insensitive substring match over node titles.
 * - Tag facets are multi-select and use OR within the group; a page matches when
 *   it carries any selected tag. Title and facets combine with AND.
 * - Ghost nodes carry no tags. With facets active they are not selected directly;
 *   they survive only as context for a visible page that links to them, so a
 *   filtered page keeps the unresolved target it points at. Without facets, a
 *   ghost matches the title filter on its own title as well.
 * - An edge survives only when both endpoints survive.
 *
 * The result feeds `computeGraphLayout` directly, so filtering re-seeds the
 * physics simulation instead of CSS-hiding nodes.
 */
export function filterGraphData (
	data: Pick<WorkspaceGraphData, 'nodes' | 'edges'>,
	state: GraphFilterState,
): FilteredGraph {
	const query = state.title.trim().toLowerCase()
	const facetsActive = state.tags.length > 0
	const selected = new Set(state.tags)
	const titleMatches = (node: GraphNode) => query.length === 0 || node.title.toLowerCase().includes(query)
	const visible = new Set<string>()

	for (const node of data.nodes) {
		if (!titleMatches(node)) continue
		if (node.kind === 'page') {
			if (facetsActive && !node.tags.some(tag => selected.has(tag))) continue
		} else if (facetsActive) {
			// Ghosts cannot carry tags; they are added back below when a visible
			// page links to them.
			continue
		}
		visible.add(node.id)
	}

	const ghostIds = new Set(
		data.nodes.filter(node => node.kind === 'unresolved').map(node => node.id),
	)
	for (const edge of data.edges) {
		if (ghostIds.has(edge.target) && visible.has(edge.source)) visible.add(edge.target)
		if (ghostIds.has(edge.source) && visible.has(edge.target)) visible.add(edge.source)
	}

	const nodes = data.nodes.filter(node => visible.has(node.id))
	const edges = data.edges.filter(edge => visible.has(edge.source) && visible.has(edge.target))

	return {
		nodes,
		edges,
		hiddenNodes: data.nodes.length - nodes.length,
		hiddenEdges: data.edges.length - edges.length,
	}
}
