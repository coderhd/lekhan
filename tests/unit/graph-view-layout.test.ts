import { describe, it, expect } from 'vitest'
import { computeGraphLayout, defaultIterations, nodeRadius } from '@/lib/graph-view/layout'
import type { GraphEdge, GraphNode } from '@/lib/graph-view/types'

const node = (id: string, kind: GraphNode['kind'] = 'page'): GraphNode => ({
	id,
	kind,
	title: id,
	tags: [],
	isPublic: false,
	updatedAt: kind === 'page' ? '2026-11-02T00:00:00.000Z' : null,
})

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

	it('is deterministic for the same input at the default tick count', () => {
		const nodes = [node('a'), node('b'), node('c'), node('d')]
		const edges: GraphEdge[] = [
			{ id: 'e1', source: 'a', target: 'b', unresolved: false },
			{ id: 'e2', source: 'c', target: 'd', unresolved: false },
		]

		const first = computeGraphLayout(nodes, edges)
		const second = computeGraphLayout(nodes, edges)

		expect(first.iterations).toBe(defaultIterations(nodes.length))
		expect(first.iterations).toBe(300)
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
})
