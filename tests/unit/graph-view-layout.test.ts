import { describe, it, expect } from 'vitest'
import { computeGraphLayout, defaultIterations, nodeRadius } from '@/lib/graph-view/layout'
import { serializeWorkspaceGraph } from '@/lib/graph-view/serialize'
import type { GraphEdge, GraphNode } from '@/lib/graph-view/types'
import type { Page, PageLink } from '@/types'

const node = (id: string, kind: GraphNode['kind'] = 'page'): GraphNode => ({
	id,
	kind,
	title: id,
	tags: [],
	isPublic: false,
	updatedAt: kind === 'page' ? '2026-11-02T00:00:00.000Z' : null,
})

/** Deterministic PRNG so the seeded corpus is identical on every run. */
function mulberry32 (seed: number): () => number {
	let a = seed
	return () => {
		a |= 0
		a = (a + 0x6D2B79F5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/** 500 pages / 2,000 links — the spec's W45 dogfood corpus. */
function seededCorpus (): { pages: Page[]; links: PageLink[] } {
	const pages: Page[] = Array.from({ length: 500 }, (_, i) => ({
		id: `p-${i}`,
		workspace_id: 'ws-1',
		parent_id: null,
		title: `Page ${i}`,
		owner_id: 'user-1',
		icon: null,
		cover: null,
		properties: {},
		is_public: false,
		searchable_text: null,
		created_at: '2026-11-01T00:00:00.000Z',
		updated_at: '2026-11-02T00:00:00.000Z',
	}))
	const rand = mulberry32(206)
	const linkedTitles = new Set<string>()
	const links: PageLink[] = []
	for (let i = 0; i < 2000; i++) {
		const from = Math.floor(rand() * pages.length)
		let to = Math.floor(rand() * pages.length)
		if (to === from) to = (to + 1) % pages.length
		// `page_links` is UNIQUE(from_page_id, to_title), mirror that here.
		const key = `${from}:${to}`
		if (linkedTitles.has(key)) {
			i -= 1
			continue
		}
		linkedTitles.add(key)
		links.push({
			id: `l-${i}-${from}-${to}`,
			workspace_id: 'ws-1',
			from_page_id: `p-${from}`,
			to_page_id: `p-${to}`,
			to_title: pages[to].title,
			block_id: null,
			created_at: '2026-11-02T00:00:00.000Z',
		})
	}
	// 20 unresolved targets keep ghost-node rendering inside the budget too.
	for (let i = 0; i < 20; i++) {
		links.push({
			id: `ghost-${i}`,
			workspace_id: 'ws-1',
			from_page_id: `p-${i}`,
			to_page_id: null,
			to_title: `Unwritten ${i}`,
			block_id: null,
			created_at: '2026-11-02T00:00:00.000Z',
		})
	}
	return { pages, links }
}

describe('computeGraphLayout', () => {
	it('positions every node with finite coordinates inside bounds', () => {
		const nodes = [node('a'), node('b'), node('c'), node('d', 'unresolved')]
		const edges: GraphEdge[] = [
			{ id: 'e1', source: 'a', target: 'b', unresolved: false },
			{ id: 'e2', source: 'b', target: 'c', unresolved: false },
			{ id: 'e3', source: 'a', target: 'd', unresolved: true },
		]

		const layout = computeGraphLayout(nodes, edges)

		expect(layout.nodes).toHaveLength(4)
		for (const positioned of layout.nodes) {
			expect(Number.isFinite(positioned.x)).toBe(true)
			expect(Number.isFinite(positioned.y)).toBe(true)
			expect(positioned.x).toBeGreaterThanOrEqual(layout.bounds.minX)
			expect(positioned.x).toBeLessThanOrEqual(layout.bounds.maxX)
			expect(positioned.y).toBeGreaterThanOrEqual(layout.bounds.minY)
			expect(positioned.y).toBeLessThanOrEqual(layout.bounds.maxY)
		}
		expect(layout.edges).toEqual(edges)
	})

	it('records each node degree from the edges', () => {
		const nodes = [node('a'), node('b'), node('c')]
		const edges: GraphEdge[] = [
			{ id: 'e1', source: 'a', target: 'b', unresolved: false },
			{ id: 'e2', source: 'a', target: 'c', unresolved: false },
			{ id: 'e3', source: 'a', target: 'b', unresolved: false },
		]

		const layout = computeGraphLayout(nodes, edges)
		const degree = Object.fromEntries(layout.nodes.map(n => [n.id, n.degree]))

		expect(degree).toEqual({ a: 3, b: 2, c: 1 })
		expect(nodeRadius(degree.a)).toBeGreaterThan(nodeRadius(degree.c))
	})

	it('is deterministic for the same input', () => {
		const nodes = [node('a'), node('b'), node('c'), node('d')]
		const edges: GraphEdge[] = [
			{ id: 'e1', source: 'a', target: 'b', unresolved: false },
			{ id: 'e2', source: 'c', target: 'd', unresolved: false },
		]

		const first = computeGraphLayout(nodes, edges, { iterations: 60 })
		const second = computeGraphLayout(nodes, edges, { iterations: 60 })

		expect(second.nodes.map(n => [n.id, n.x, n.y])).toEqual(first.nodes.map(n => [n.id, n.x, n.y]))
	})

	it('handles a single page without edges', () => {
		const layout = computeGraphLayout([node('solo')], [])

		expect(layout.nodes).toHaveLength(1)
		expect(layout.nodes[0].degree).toBe(0)
		expect(layout.bounds.minX).toBe(layout.bounds.maxX)
		expect(layout.bounds.minY).toBe(layout.bounds.maxY)
	})

	it('uses fewer iterations as the graph grows', () => {
		expect(defaultIterations(100)).toBe(300)
		expect(defaultIterations(200)).toBe(300)
		expect(defaultIterations(201)).toBe(220)
		expect(defaultIterations(500)).toBe(140)
	})

	it('lays out 500 pages / 2,020 links within the 1 s first-paint budget', () => {
		const { pages, links } = seededCorpus()

		const started = performance.now()
		const data = serializeWorkspaceGraph({ pages, links })
		const layout = computeGraphLayout(data.nodes, data.edges)
		const elapsed = performance.now() - started

		expect(data.nodes).toHaveLength(520) // 500 pages + 20 ghosts
		expect(layout.nodes).toHaveLength(520)
		expect(layout.edges.length).toBeGreaterThan(1900)
		// Spec §Scope: first paint < 1 s at 500 pages / 2,000 links.
		expect(elapsed).toBeLessThan(1000)
	})
})
