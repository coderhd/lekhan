import {
	forceCenter,
	forceCollide,
	forceLink,
	forceManyBody,
	forceSimulation,
	type SimulationLinkDatum,
	type SimulationNodeDatum,
} from 'd3-force'
import type { GraphEdge, GraphNode } from './types'

export interface PositionedNode extends GraphNode {
	x: number
	y: number
	/** Number of page links incident on this node (both directions). */
	degree: number
}

export interface GraphBounds {
	minX: number
	minY: number
	maxX: number
	maxY: number
}

export interface PositionedGraph {
	nodes: PositionedNode[]
	edges: GraphEdge[]
	bounds: GraphBounds
	iterations: number
}

export interface LayoutOptions {
	/** Override the deterministic tick count (tests / very large graphs). */
	iterations?: number
	/**
	 * Wall-clock ceiling for the synchronous tick loop when `iterations` is not
	 * given. Keeps first paint inside the spec's 1 s budget even on a busy
	 * machine: once the budget is spent the layout is delivered as-is.
	 */
	budgetMs?: number
	linkDistance?: number
	chargeStrength?: number
	collideRadius?: number
}

interface SimNode extends SimulationNodeDatum {
	id: string
	degree: number
}

/**
 * Tick budget tuned to the spec's first-paint bar (< 1 s at 500 pages /
 * 2,000 links). d3-force settles in ~300 ticks; very large graphs trade a
 * little polish for staying inside the budget. Deterministic by design — the
 * simulation is stopped and ticked synchronously, no animation loop.
 */
export function defaultIterations (nodeCount: number): number {
	if (nodeCount <= 200) return 300
	if (nodeCount <= 400) return 220
	return 140
}

/** Screen-independent node radius; grows slowly with degree, capped at 11. */
export function nodeRadius (degree: number): number {
	return 5 + Math.min(6, Math.sqrt(Math.max(0, degree)) * 1.7)
}

/**
 * Pure d3-force layout for the workspace graph. Inputs are never mutated:
 * positions live on cloned simulation nodes, and edges are returned untouched.
 */
export function computeGraphLayout (
	nodes: GraphNode[],
	edges: GraphEdge[],
	options: LayoutOptions = {},
): PositionedGraph {
	const nodeIds = new Set(nodes.map(node => node.id))
	const edges_ = edges.filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target))

	const degrees = new Map<string, number>(nodes.map(node => [node.id, 0]))
	for (const edge of edges_) {
		degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1)
		degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1)
	}

	if (nodes.length === 0) {
		return {
			nodes: [],
			edges: edges_,
			bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
			iterations: 0,
		}
	}

	const simNodes: SimNode[] = nodes.map(node => ({
		id: node.id,
		degree: degrees.get(node.id) ?? 0,
	}))
	const simLinks: SimulationLinkDatum<SimNode>[] = edges_.map(edge => ({
		source: edge.source,
		target: edge.target,
	}))
	const maxIterations = options.iterations ?? defaultIterations(nodes.length)
	const budgetMs = options.budgetMs ?? (nodes.length > 400 ? 220 : 500)

	const simulation = forceSimulation<SimNode>(simNodes)
		.force(
			'link',
			forceLink<SimNode, SimulationLinkDatum<SimNode>>(simLinks)
				.id(node => node.id)
				.distance(options.linkDistance ?? 48)
				.strength(0.6),
		)
		.force('charge', forceManyBody<SimNode>().strength(options.chargeStrength ?? -120).distanceMax(400))
		.force('center', forceCenter(0, 0))
		.force('collide', forceCollide<SimNode>(options.collideRadius ?? 14))
		.stop()

	let iterations = 0
	const started = performance.now()
	for (; iterations < maxIterations; iterations += 1) {
		simulation.tick()
		// Caller-pinned iteration counts stay deterministic; default layouts
		// stop early when the wall-clock budget is spent (first-paint bar).
		if (options.iterations === undefined && (iterations & 7) === 7 && performance.now() - started > budgetMs) {
			iterations += 1
			break
		}
	}
	simulation.stop()

	const byId = new Map(simNodes.map(simNode => [simNode.id, simNode]))
	const positioned: PositionedNode[] = nodes.map(node => {
		const simNode = byId.get(node.id)
		return {
			...node,
			x: simNode?.x ?? 0,
			y: simNode?.y ?? 0,
			degree: degrees.get(node.id) ?? 0,
		}
	})

	return { nodes: positioned, edges: edges_, bounds: boundsOf(positioned), iterations }
}

function boundsOf (nodes: PositionedNode[]): GraphBounds {
	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	for (const node of nodes) {
		if (node.x < minX) minX = node.x
		if (node.y < minY) minY = node.y
		if (node.x > maxX) maxX = node.x
		if (node.y > maxY) maxY = node.y
	}
	return { minX, minY, maxX, maxY }
}
