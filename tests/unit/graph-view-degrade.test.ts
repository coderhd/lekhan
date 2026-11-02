import { describe, it, expect } from 'vitest'
import {
	EDGE_BUDGET,
	edgeCountBadge,
	formatCount,
	sampleEdges,
} from '@/lib/graph-view/degrade'
import type { GraphEdge } from '@/lib/graph-view/types'

const edges = (count: number): GraphEdge[] => Array.from({ length: count }, (_, index) => ({
	id: `e-${index}`,
	source: 'p-1',
	target: 'p-2',
	unresolved: false,
}))

describe('sampleEdges', () => {
	it('passes the original array through at or below the budget', () => {
		const input = edges(EDGE_BUDGET)
		const sample = sampleEdges(input)

		expect(sample.sampled).toBe(false)
		expect(sample.total).toBe(EDGE_BUDGET)
		expect(sample.shown).toBe(EDGE_BUDGET)
		expect(sample.edges).toBe(input)
	})

	it('samples down to the budget above the limit, never silently truncating', () => {
		const input = edges(2_400)
		const sample = sampleEdges(input)

		expect(sample.sampled).toBe(true)
		expect(sample.total).toBe(2_400)
		expect(sample.shown).toBe(EDGE_BUDGET)
		expect(sample.edges).toHaveLength(EDGE_BUDGET)
		// The input array is untouched; the caller decides what to render.
		expect(input).toHaveLength(2_400)
	})

	it('is deterministic and keeps the first and last links', () => {
		const input = edges(1_001)
		const first = sampleEdges(input)
		const second = sampleEdges(input)

		expect(first.edges.map(edge => edge.id)).toEqual(second.edges.map(edge => edge.id))
		expect(first.edges[0].id).toBe('e-0')
		expect(first.edges[first.edges.length - 1].id).toBe('e-1000')
		expect(new Set(first.edges.map(edge => edge.id)).size).toBe(first.shown)
	})

	it('handles a budget of one link without dividing by zero', () => {
		const sample = sampleEdges(edges(10), 1)

		expect(sample.shown).toBe(1)
		expect(sample.edges.map(edge => edge.id)).toEqual(['e-0'])
	})
})

describe('formatCount', () => {
	it('groups thousands deterministically', () => {
		expect(formatCount(0)).toBe('0')
		expect(formatCount(999)).toBe('999')
		expect(formatCount(1_000)).toBe('1,000')
		expect(formatCount(12_345)).toBe('12,345')
		expect(formatCount(1_234_567)).toBe('1,234,567')
	})
})

describe('edgeCountBadge', () => {
	it('returns null when every link is shown', () => {
		expect(edgeCountBadge(1_000, 1_000)).toBeNull()
		expect(edgeCountBadge(42, 42)).toBeNull()
	})

	it('describes sampled counts with thousands separators', () => {
		const badge = edgeCountBadge(1_000, 1_001)

		expect(badge).not.toBeNull()
		expect(badge?.label).toBe('Showing 1,000 of 1,001 links')
		expect(badge?.description).toMatch(/sampled/i)
	})

	it('uses the same wording for a large corpus', () => {
		expect(edgeCountBadge(1_000, 2_400)?.label).toBe('Showing 1,000 of 2,400 links')
	})
})
