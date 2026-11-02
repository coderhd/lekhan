import type { GraphEdge } from './types'

/**
 * Edge ceiling for the interactive renderer. Above it the surface samples links
 * and says so — it never hides edges silently. 1,000 sits comfortably inside the
 * canvas-2D budget while staying above the W45 dogfood corpus (2,000 links is
 * sampled, 500 pages still all render as nodes).
 */
export const EDGE_BUDGET = 1000

export interface EdgeSample {
	/** Edges the renderer should draw. */
	edges: GraphEdge[]
	shown: number
	total: number
	sampled: boolean
}

export interface EdgeBadge {
	label: string
	description: string
}

/**
 * Deterministic, evenly-spaced edge sampling. Keeps the first and last edge of
 * the (stable) input order so the map does not lose its oldest/newest links,
 * and never mutates `edges`. At or below the budget the original array is
 * returned untouched.
 */
export function sampleEdges (edges: GraphEdge[], budget: number = EDGE_BUDGET): EdgeSample {
	const total = edges.length
	if (budget <= 0 || total <= budget) {
		return { edges, shown: total, total, sampled: false }
	}

	const lastIndex = total - 1
	const step = (lastIndex) / (budget - 1)
	const sampled: GraphEdge[] = []
	for (let index = 0; index < budget; index += 1) {
		const sourceIndex = budget === 1 ? 0 : Math.round(index * step)
		sampled.push(edges[sourceIndex])
	}

	return { edges: sampled, shown: sampled.length, total, sampled: true }
}

/** Comma-grouped integer, locale-independent so tests and SSR agree. */
export function formatCount (value: number): string {
	return Math.trunc(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Visible badge for a sampled graph; `null` when every link is drawn. */
export function edgeCountBadge (shown: number, total: number): EdgeBadge | null {
	if (shown >= total) return null
	const label = `Showing ${formatCount(shown)} of ${formatCount(total)} links`
	return {
		label,
		description: `${label} — the rest are sampled out to keep the graph interactive.`,
	}
}
