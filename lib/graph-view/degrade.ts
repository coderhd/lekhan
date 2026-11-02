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
 * Deterministic edge sampling. When the corpus is over budget the edges are
 * sorted by stable id first, so the same edge set samples identically no matter
 * what order the database returned (`fetchWorkspaceGraph` has no ORDER BY).
 * Keeps the first and last edge in id order when the budget allows more than
 * one slot, and never mutates `edges`. At or below the budget the original
 * array is returned untouched.
 */
export function sampleEdges (edges: GraphEdge[], budget: number = EDGE_BUDGET): EdgeSample {
	const total = edges.length
	if (total <= budget) {
		return { edges, shown: total, total, sampled: false }
	}
	if (budget <= 0) {
		// A misconfigured budget must not silently disable the degradation guard.
		return { edges: [], shown: 0, total, sampled: true }
	}

	const ordered = [...edges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
	const step = (ordered.length - 1) / (budget - 1)
	const sampled: GraphEdge[] = []
	for (let index = 0; index < budget; index += 1) {
		const sourceIndex = budget === 1 ? 0 : Math.round(index * step)
		sampled.push(ordered[sourceIndex])
	}

	return { edges: sampled, shown: sampled.length, total, sampled: true }
}

/** Comma-grouped integer, locale-independent so tests and SSR agree. */
export function formatCount (value: number): string {
	return Math.trunc(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Visible badge for a sampled graph; `null` when every link is drawn. */
export function edgeCountBadge (
	shown: number,
	total: number,
	options: { filtered?: boolean } = {},
): EdgeBadge | null {
	if (shown >= total) return null
	const label = `Showing ${formatCount(shown)} of ${formatCount(total)} links`
	const scope = options.filtered ? 'the filtered links' : 'the links'
	return {
		label,
		description: `${label} — the rest of ${scope} are sampled out to keep the graph interactive.`,
	}
}
