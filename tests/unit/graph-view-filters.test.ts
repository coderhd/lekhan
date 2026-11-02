import { describe, it, expect } from 'vitest'
import {
	EMPTY_GRAPH_FILTER,
	filterGraphData,
	graphFilterReducer,
	isGraphFilterActive,
	type GraphFilterState,
} from '@/lib/graph-view/filters'
import type { GraphEdge, GraphNode } from '@/lib/graph-view/types'

const node = (id: string, title: string, tags: string[] = [], kind: GraphNode['kind'] = 'page'): GraphNode => ({
	id,
	kind,
	title,
	tags,
	isPublic: false,
	updatedAt: kind === 'page' ? '2026-11-02T00:00:00.000Z' : null,
})

const edge = (id: string, source: string, target: string, unresolved = false): GraphEdge => ({
	id,
	source,
	target,
	unresolved,
})

const graph = {
	nodes: [
		node('p-1', 'Alpha', ['research']),
		node('p-2', 'Beta', ['journal']),
		node('p-3', 'Gamma', ['research', 'journal']),
		node('ghost:later', 'Later', [], 'unresolved'),
	],
	edges: [
		edge('e-1', 'p-1', 'p-2'),
		edge('e-2', 'p-1', 'ghost:later', true),
		edge('e-3', 'p-2', 'p-3'),
		edge('e-4', 'p-3', 'ghost:later', true),
	],
}

const ids = (nodes: GraphNode[]) => nodes.map(item => item.id)
const edgeIds = (edges: GraphEdge[]) => edges.map(item => item.id)

describe('graphFilterReducer', () => {
	it('sets the title filter without touching tag facets', () => {
		const next = graphFilterReducer({ ...EMPTY_GRAPH_FILTER, tags: ['research'] }, { type: 'set-title', title: 'alp' })

		expect(next).toEqual({ title: 'alp', tags: ['research'] })
	})

	it('toggles a tag facet on and off while keeping selection order', () => {
		const withResearch = graphFilterReducer(EMPTY_GRAPH_FILTER, { type: 'toggle-tag', tag: 'research' })
		const withBoth = graphFilterReducer(withResearch, { type: 'toggle-tag', tag: 'journal' })
		const withoutResearch = graphFilterReducer(withBoth, { type: 'toggle-tag', tag: 'research' })

		expect(withBoth.tags).toEqual(['research', 'journal'])
		expect(withoutResearch.tags).toEqual(['journal'])
	})

	it('clears both title and facets', () => {
		const active: GraphFilterState = { title: 'alpha', tags: ['research'] }

		expect(graphFilterReducer(active, { type: 'clear' })).toEqual(EMPTY_GRAPH_FILTER)
	})
})

describe('isGraphFilterActive', () => {
	it('treats whitespace-only titles and empty facets as inactive', () => {
		expect(isGraphFilterActive(EMPTY_GRAPH_FILTER)).toBe(false)
		expect(isGraphFilterActive({ title: '   ', tags: [] })).toBe(false)
	})

	it('is active when a real title or any facet is set', () => {
		expect(isGraphFilterActive({ title: 'alpha', tags: [] })).toBe(true)
		expect(isGraphFilterActive({ title: '', tags: ['research'] })).toBe(true)
	})
})

describe('filterGraphData', () => {
	it('returns every node and edge when no filter is active', () => {
		const filtered = filterGraphData(graph, EMPTY_GRAPH_FILTER)

		expect(ids(filtered.nodes)).toEqual(['p-1', 'p-2', 'p-3', 'ghost:later'])
		expect(edgeIds(filtered.edges)).toEqual(['e-1', 'e-2', 'e-3', 'e-4'])
		expect(filtered.hiddenNodes).toBe(0)
		expect(filtered.hiddenEdges).toBe(0)
	})

	it('filters by title case-insensitively and trims the query', () => {
		const filtered = filterGraphData(graph, { title: '  ALPHA  ', tags: [] })

		expect(ids(filtered.nodes)).toEqual(['p-1', 'ghost:later'])
		// e-2 survives because the ghost is kept as context for the matching page;
		// e-1 does not, because Beta was filtered out.
		expect(edgeIds(filtered.edges)).toEqual(['e-2'])
		expect(filtered.hiddenNodes).toBe(2)
		expect(filtered.hiddenEdges).toBe(3)
	})

	it('matches ghost node titles directly', () => {
		const filtered = filterGraphData(graph, { title: 'later', tags: [] })

		expect(ids(filtered.nodes)).toEqual(['ghost:later'])
		expect(filtered.edges).toEqual([])
	})

	it('filters by tag facet using OR within the facet group', () => {
		const filtered = filterGraphData(graph, { title: '', tags: ['research'] })

		expect(ids(filtered.nodes)).toEqual(['p-1', 'p-3', 'ghost:later'])
		expect(edgeIds(filtered.edges)).toEqual(['e-2', 'e-4'])
	})

	it('keeps ghost targets only when a visible page links to them', () => {
		const filtered = filterGraphData(graph, { title: '', tags: ['journal'] })

		// p-2 and p-3 match; the ghost is linked from p-3, so it stays.
		expect(ids(filtered.nodes)).toEqual(['p-2', 'p-3', 'ghost:later'])
		expect(edgeIds(filtered.edges)).toEqual(['e-3', 'e-4'])
	})

	it('combines title and tag facets with AND', () => {
		const filtered = filterGraphData(graph, { title: 'gamma', tags: ['research'] })

		expect(ids(filtered.nodes)).toEqual(['p-3', 'ghost:later'])
		expect(edgeIds(filtered.edges)).toEqual(['e-4'])
	})

	it('returns an empty graph when nothing matches, including every edge', () => {
		const filtered = filterGraphData(graph, { title: 'nothing here', tags: ['research'] })

		expect(filtered.nodes).toEqual([])
		expect(filtered.edges).toEqual([])
		expect(filtered.hiddenNodes).toBe(graph.nodes.length)
		expect(filtered.hiddenEdges).toBe(graph.edges.length)
	})
})
