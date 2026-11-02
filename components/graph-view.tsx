'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import {
	fitCamera,
	hitTestGraph,
	worldToScreen,
	zoomCameraAt,
	type Camera,
	type Point,
	type Size,
} from '@/lib/graph-view/camera'
import { computeGraphLayout, nodeRadius, type PositionedGraph, type PositionedNode } from '@/lib/graph-view/layout'
import {
	EMPTY_GRAPH_FILTER,
	filterGraphData,
	graphFilterReducer,
	isGraphFilterActive,
	type GraphFilterAction,
} from '@/lib/graph-view/filters'
import { edgeCountBadge, sampleEdges } from '@/lib/graph-view/degrade'
import type { WorkspaceGraphData } from '@/lib/graph-view/types'
import GraphFilters from './graph-filters'

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-container focus-visible:ring-offset-2'
const LABEL_ZOOM = 0.55
const GHOST_LABEL_ZOOM = 0.4
const MAX_LABEL_CHARS = 28
const DRAG_THRESHOLD = 4
const HOVER_CARD_MARGIN = 96

export interface GraphViewProps {
	data: WorkspaceGraphData
	/**
	 * Injection seam for tests and deterministic renders. Production omits it
	 * and the surface runs the pure d3-force layout from `data`.
	 */
	layout?: PositionedGraph
	className?: string
}

interface DragState {
	x: number
	y: number
	lastX: number
	lastY: number
	moved: boolean
}

interface HoverCard {
	id: string
	x: number
	y: number
}

interface Palette {
	edge: string
	ghostEdge: string
	node: string
	nodeStroke: string
	ghost: string
	hover: string
	label: string
	labelMuted: string
}

/**
 * Canvas-2D workspace graph surface: pan, zoom, hover, filters, and
 * click-through into the editor. Ghost nodes (dashed) stand in for unresolved
 * `page_links` targets and are intentionally not navigable. The view is
 * read-only — it renders the payload serialized from `fetchWorkspaceGraph` and
 * never writes.
 *
 * Filters run before `computeGraphLayout`, so a filter change re-seeds the
 * force simulation rather than CSS-hiding nodes. Above `EDGE_BUDGET` links the
 * renderer samples deterministically and shows a "showing N of M links" badge.
 */
export default function GraphView ({ data, layout, className }: GraphViewProps) {
	const router = useRouter()
	const containerRef = useRef<HTMLDivElement>(null)
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const dragRef = useRef<DragState | null>(null)
	const lastLayoutRef = useRef<PositionedGraph | null>(null)

	const [filter, dispatch] = useReducer(graphFilterReducer, EMPTY_GRAPH_FILTER)
	const [size, setSize] = useState<Size>({ width: 0, height: 0 })
	const [camera, setCamera] = useState<Camera | null>(null)
	const [highlightedId, setHighlightedId] = useState<string | null>(null)
	const [hoverCard, setHoverCard] = useState<HoverCard | null>(null)
	const [cursor, setCursor] = useState<'default' | 'grab' | 'grabbing' | 'pointer'>('grab')

	const filtered = useMemo(() => filterGraphData(data, filter), [data, filter])
	const sample = useMemo(() => sampleEdges(filtered.edges), [filtered.edges])
	const positioned = useMemo(
		() => layout ?? computeGraphLayout(filtered.nodes, sample.edges),
		[layout, filtered.nodes, sample.edges],
	)
	const nodes = positioned.nodes
	const nodeById = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes])
	const badge = edgeCountBadge(sample.shown, sample.total)
	const visiblePages = filtered.nodes.filter(node => node.kind === 'page').length
	const workspaceEmpty = data.nodes.length === 0
	const noMatches = !workspaceEmpty && filtered.nodes.length === 0
	const filtering = isGraphFilterActive(filter)

	// Drop stale hover/focus highlight when the filter changes the node set.
	const handleFilter = useCallback((action: GraphFilterAction) => {
		dispatch(action)
		setHighlightedId(null)
		setHoverCard(null)
	}, [])

	// Measure the surface; ResizeObserver keeps it correct across layout shifts.
	useEffect(() => {
		const element = containerRef.current
		if (!element) return

		const measure = () => {
			const rect = element.getBoundingClientRect()
			const width = element.clientWidth || rect.width
			const height = element.clientHeight || rect.height
			setSize(previous =>
				previous.width === width && previous.height === height ? previous : { width, height },
			)
		}
		measure()

		if (typeof ResizeObserver === 'undefined') return
		const observer = new ResizeObserver(entries => {
			const rect = entries[0]?.contentRect
			if (rect) {
				setSize(previous =>
					previous.width === rect.width && previous.height === rect.height
						? previous
						: { width: rect.width, height: rect.height },
				)
			}
		})
		observer.observe(element)
		return () => observer.disconnect()
	}, [noMatches])

	// Fit for a new layout or the first measurement. Plain resizes keep the
	// user's pan/zoom (Reset view restores the fitted camera on demand).
	useEffect(() => {
		if (size.width === 0 || size.height === 0 || nodes.length === 0) return
		const newLayout = lastLayoutRef.current !== positioned
		lastLayoutRef.current = positioned
		if (newLayout || camera === null) {
			setCamera(fitCamera(positioned.bounds, size))
		}
	}, [positioned, size.width, size.height, nodes.length, camera])

	const resetView = useCallback(() => {
		if (nodes.length > 0 && size.width > 0 && size.height > 0) {
			setCamera(fitCamera(positioned.bounds, size))
		}
	}, [nodes.length, positioned, size])

	const zoomBy = useCallback((factor: number) => {
		setCamera(current => (current ? zoomCameraAt(current, { x: size.width / 2, y: size.height / 2 }, factor) : current))
	}, [size.height, size.width])

	// Wheel zoom is attached natively so it can preventDefault without React's
	// passive-listener warning and so zoom anchors on the cursor.
	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas) return
		const onWheel = (event: WheelEvent) => {
			event.preventDefault()
			const rect = canvas.getBoundingClientRect()
			const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top }
			const factor = Math.exp(-event.deltaY * 0.0015)
			setCamera(current => (current ? zoomCameraAt(current, anchor, factor) : current))
		}
		canvas.addEventListener('wheel', onWheel, { passive: false })
		return () => canvas.removeEventListener('wheel', onWheel)
	}, [noMatches])

	// Paint on every camera/highlight/size change.
	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas || !camera || nodes.length === 0 || size.width === 0 || size.height === 0) return
		const context = canvas.getContext('2d')
		if (!context) return

		const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
		canvas.width = Math.round(size.width * dpr)
		canvas.height = Math.round(size.height * dpr)
		canvas.style.width = `${size.width}px`
		canvas.style.height = `${size.height}px`
		context.setTransform(dpr, 0, 0, dpr, 0, 0)
		context.clearRect(0, 0, size.width, size.height)

		const palette = readPalette()
		const highlightEdges = highlightedId === null
			? null
			: new Set(
				positioned.edges
					.filter(edge => edge.source === highlightedId || edge.target === highlightedId)
					.map(edge => edge.id),
			)
		const highlightNeighbours = highlightedId === null
			? null
			: new Set(
				positioned.edges.flatMap(edge =>
					edge.source === highlightedId ? [edge.target] : edge.target === highlightedId ? [edge.source] : [],
				),
			)
		const byId = new Map(nodes.map(node => [node.id, node]))
		const onScreen = (point: PositionedNode) => worldToScreen(point, camera)
		const visible = (point: Point) =>
			point.x > -80 && point.y > -40 && point.x < size.width + 80 && point.y < size.height + 40

		// Edges first, so nodes sit on top.
		for (const edge of positioned.edges) {
			const source = byId.get(edge.source)
			const target = byId.get(edge.target)
			if (!source || !target) continue
			const from = onScreen(source)
			const to = onScreen(target)
			// Cull only when the whole segment is outside the same viewport
			// edge; long edges crossing the view stay visible when zoomed in.
			if (segmentOutside(from, to, size.width, size.height)) continue
			const highlightedEdge = highlightEdges?.has(edge.id) ?? false
			context.globalAlpha = highlightEdges !== null && !highlightedEdge ? 0.18 : 1
			context.lineWidth = highlightedEdge ? 2.4 : 1
			context.beginPath()
			context.setLineDash(edge.unresolved ? [4, 4] : [])
			context.strokeStyle = highlightedEdge
				? palette.hover
				: edge.unresolved ? palette.ghostEdge : palette.edge
			context.moveTo(from.x, from.y)
			context.lineTo(to.x, to.y)
			context.stroke()
		}
		context.globalAlpha = 1
		context.setLineDash([])

		// Nodes: ghosts are dashed outlines, pages are filled discs.
		for (const node of nodes) {
			const point = onScreen(node)
			if (!visible(point)) continue
			const radius = Math.max(3.5, nodeRadius(node.degree) * camera.scale)
			const highlighted = node.id === highlightedId
			const dimmed = highlightNeighbours !== null && !highlighted && !highlightNeighbours.has(node.id)
			context.globalAlpha = dimmed ? 0.3 : 1

			context.beginPath()
			context.arc(point.x, point.y, radius, 0, Math.PI * 2)
			if (node.kind === 'unresolved') {
				context.setLineDash([3, 3])
				context.lineWidth = highlighted ? 2.4 : 1.6
				context.strokeStyle = highlighted ? palette.hover : palette.ghost
				context.stroke()
				context.setLineDash([])
			} else {
				context.fillStyle = highlighted ? palette.hover : palette.node
				context.fill()
				context.lineWidth = highlighted ? 2.5 : 1.5
				context.strokeStyle = palette.nodeStroke
				context.stroke()
			}
		}
		context.globalAlpha = 1

		// Labels: pages once zoomed in, ghosts a little earlier, hovered always.
		context.textBaseline = 'middle'
		for (const node of nodes) {
			const point = onScreen(node)
			if (!visible(point)) continue
			const highlighted = node.id === highlightedId
			const dimmed = highlightNeighbours !== null && !highlighted && !highlightNeighbours.has(node.id)
			const threshold = node.kind === 'unresolved' ? GHOST_LABEL_ZOOM : LABEL_ZOOM
			if (!highlighted && camera.scale < threshold) continue
			const radius = Math.max(3.5, nodeRadius(node.degree) * camera.scale)
			context.globalAlpha = dimmed ? 0.3 : 1
			context.font = `${node.kind === 'unresolved' ? 'italic ' : ''}11px Inter, system-ui, sans-serif`
			context.fillStyle = node.kind === 'unresolved' ? palette.labelMuted : palette.label
			context.fillText(truncate(node.title), point.x + radius + 4, point.y + 1)
		}
		context.globalAlpha = 1

		// The hovered title always wins the label collision, bolded.
		const highlightedNode = highlightedId !== null ? byId.get(highlightedId) : undefined
		if (highlightedNode) {
			const point = onScreen(highlightedNode)
			const radius = Math.max(3.5, nodeRadius(highlightedNode.degree) * camera.scale)
			context.font = `600 13px Inter, system-ui, sans-serif`
			context.fillStyle = palette.hover
			context.fillText(truncate(highlightedNode.title), point.x + radius + 5, point.y + 1)
		}
	}, [camera, highlightedId, nodes, positioned.edges, size.height, size.width])

	const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
		const rect = event.currentTarget.getBoundingClientRect()
		return { x: event.clientX - rect.left, y: event.clientY - rect.top }
	}

	const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
		if (event.button !== 0) return
		const point = pointFromEvent(event)
		dragRef.current = { x: point.x, y: point.y, lastX: point.x, lastY: point.y, moved: false }
		event.currentTarget.setPointerCapture?.(event.pointerId)
		setCursor('grabbing')
	}

	const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
		const point = pointFromEvent(event)
		const drag = dragRef.current

		if (drag) {
			const dx = point.x - drag.lastX
			const dy = point.y - drag.lastY
			if (Math.abs(point.x - drag.x) > DRAG_THRESHOLD || Math.abs(point.y - drag.y) > DRAG_THRESHOLD) {
				drag.moved = true
			}
			drag.lastX = point.x
			drag.lastY = point.y
			if (dx !== 0 || dy !== 0) {
				setCamera(current => (current ? { ...current, tx: current.tx + dx, ty: current.ty + dy } : current))
			}
			return
		}

		if (!camera) return
		const hit = hitTestGraph(nodes, point, camera)
		setHighlightedId(hit?.id ?? null)
		setHoverCard(hit ? { id: hit.id, x: point.x, y: point.y } : null)
		setCursor(hit ? (hit.kind === 'page' ? 'pointer' : 'default') : 'grab')
	}

	const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
		const drag = dragRef.current
		dragRef.current = null
		event.currentTarget.releasePointerCapture?.(event.pointerId)
		setCursor('grab')
		if (!drag || drag.moved || !camera) return

		const hit = hitTestGraph(nodes, pointFromEvent(event), camera)
		if (hit?.kind === 'page') {
			router.push(`/page/${hit.id}`)
		}
	}

	const handlePointerLeave = () => {
		dragRef.current = null
		setHighlightedId(null)
		setHoverCard(null)
		setCursor('grab')
	}

	const handlePointerCancel = () => {
		dragRef.current = null
		setCursor('grab')
	}

	if (workspaceEmpty) {
		return (
			<div className={`flex h-full min-h-[320px] flex-col items-center justify-center gap-3 text-center ${className ?? ''}`}>
				<span className="material-symbols-outlined text-[48px] text-on-surface-variant/60">hub</span>
				<h2 className="text-lg font-bold text-on-surface">No pages to graph yet</h2>
				<p className="max-w-sm text-sm text-on-surface-variant">
					Create a page and link to another with <code className="rounded bg-black/5 px-1 py-0.5 dark:bg-white/10">[[wiki links]]</code> — the workspace graph builds itself from those links.
				</p>
			</div>
		)
	}

	const linkCount = positioned.edges.length
	const unresolvedShown = positioned.edges.filter(edge => edge.unresolved).length
	const hoveredNode = hoverCard ? nodeById.get(hoverCard.id) ?? null : null
	const hoveredEdges = hoveredNode
		? positioned.edges.filter(edge => edge.source === hoveredNode.id || edge.target === hoveredNode.id)
		: []
	const hoveredNeighbours = hoveredNode
		? Array.from(new Set(hoveredEdges.map(edge => (edge.source === hoveredNode.id ? edge.target : edge.source))))
			.map(id => nodeById.get(id)?.title)
			.filter((title): title is string => Boolean(title))
		: []
	const description = [
		`${plural(visiblePages, 'page')} and ${plural(linkCount, 'page link')}${filtering ? ' after filtering' : ''} in this workspace.`,
		unresolvedShown > 0
			? `${plural(unresolvedShown, 'unresolved link')} shown as dashed ghost nodes.`
			: '',
		sample.sampled && badge ? `${badge.label} for performance.` : '',
		'Drag to pan, scroll or use the buttons to zoom.',
		'Page nodes open in the editor when clicked, or from the Pages in this graph list.',
	].filter(Boolean).join(' ')

	return (
		<div className={`flex h-full min-h-0 flex-col gap-3 ${className ?? ''}`}>
			<GraphFilters
				state={filter}
				facets={data.tags}
				visiblePages={visiblePages}
				totalPages={data.totalPages}
				dispatch={handleFilter}
			/>

			{noMatches ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-black/10 text-center dark:border-white/10">
					<span className="material-symbols-outlined text-[40px] text-on-surface-variant/60" aria-hidden="true">filter_alt_off</span>
					<h2 className="text-lg font-bold text-on-surface">No pages match these filters</h2>
					<p className="max-w-sm text-sm text-on-surface-variant">
						Try a different title, uncheck a tag facet, or clear the filters to see the whole graph.
					</p>
				</div>
			) : (
				<div
					ref={containerRef}
					data-highlighted-node={highlightedId ?? undefined}
					className="relative min-h-[320px] flex-1 overflow-hidden rounded-2xl border border-black/10 bg-surface-container-lowest dark:border-white/10"
				>
					<canvas
						ref={canvasRef}
						role="img"
						aria-label={description}
						className="block h-full w-full touch-none"
						style={{ cursor }}
						onPointerDown={handlePointerDown}
						onPointerMove={handlePointerMove}
						onPointerUp={handlePointerUp}
						onPointerCancel={handlePointerCancel}
						onLostPointerCapture={handlePointerCancel}
						onPointerLeave={handlePointerLeave}
					/>

					{/* Keyboard/AT path: the canvas is a picture, so page navigation
					    lives in this list. It becomes visible as soon as it is focused. */}
					<div className="sr-only focus-within:not-sr-only focus-within:absolute focus-within:left-4 focus-within:top-4 focus-within:z-20 focus-within:max-h-72 focus-within:w-64 focus-within:overflow-auto focus-within:rounded-xl focus-within:border focus-within:border-black/10 focus-within:bg-surface-container focus-within:p-3 focus-within:shadow-xl dark:focus-within:border-white/10">
						<h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-on-surface-variant">Pages in this graph</h2>
						<ul className="flex flex-col gap-1 text-sm">
							{nodes.filter(node => node.kind === 'page').map(node => (
								<li key={node.id}>
									<Link
										href={`/page/${node.id}`}
										onFocus={() => setHighlightedId(node.id)}
										onBlur={() => setHighlightedId(current => (current === node.id ? null : current))}
										onMouseEnter={() => setHighlightedId(node.id)}
										onMouseLeave={() => setHighlightedId(current => (current === node.id ? null : current))}
										className={`block truncate rounded px-1 py-0.5 text-on-surface hover:bg-black/5 dark:hover:bg-white/10 ${FOCUS_RING}`}
									>
										{node.title}
									</Link>
								</li>
							))}
						</ul>
						{nodes.some(node => node.kind === 'unresolved') && (
							<p className="mt-2 border-t border-black/10 pt-2 text-xs text-on-surface-variant dark:border-white/10">
								Unresolved: {nodes.filter(node => node.kind === 'unresolved').map(node => node.title).join(', ')}
							</p>
						)}
					</div>

					{linkCount === 0 && nodes.length > 0 && (
						<div className="pointer-events-none absolute inset-x-4 top-4 z-10 mx-auto max-w-md rounded-xl border border-black/10 bg-surface-container/95 p-3 text-center shadow-lg backdrop-blur dark:border-white/10">
							<p className="text-sm font-semibold text-on-surface">No page links yet</p>
							<p className="mt-0.5 text-xs text-on-surface-variant">
								Type <code className="rounded bg-black/5 px-1 py-0.5 dark:bg-white/10">[[Page title]]</code> in any page to draw the first edge.
							</p>
						</div>
					)}

					{sample.sampled && badge && (
						<p
							data-testid="graph-edge-badge"
							role="note"
							title={badge.description}
							className="absolute left-4 top-4 z-10 rounded-full border border-black/10 bg-surface-container/95 px-3 py-1.5 text-xs font-semibold text-on-surface-variant shadow backdrop-blur dark:border-white/10"
						>
							{badge.label}
						</p>
					)}

					{hoveredNode && (
						<div
							data-testid="graph-hover-card"
							aria-hidden="true"
							className="pointer-events-none absolute z-20 w-max max-w-[260px] -translate-x-1/2 -translate-y-[calc(100%+14px)] rounded-lg bg-inverse-surface px-2.5 py-1.5 text-xs text-inverse-on-surface shadow-xl"
							style={{ left: clamp(hoverCard?.x ?? 0, HOVER_CARD_MARGIN, Math.max(HOVER_CARD_MARGIN, size.width - HOVER_CARD_MARGIN)), top: hoverCard?.y ?? 0 }}
						>
							<p className="font-semibold">{hoveredNode.title}</p>
							<p className="mt-0.5 text-[11px] opacity-80">
								{hoveredNode.kind === 'unresolved' ? 'Unresolved · ' : ''}
								{plural(hoveredEdges.length, 'link')}
							</p>
							{hoveredNeighbours.length > 0 && (
								<p className="mt-0.5 truncate text-[11px] opacity-80">
									Linked to {hoveredNeighbours.slice(0, 3).join(', ')}{hoveredNeighbours.length > 3 ? '…' : ''}
								</p>
							)}
						</div>
					)}

					<div
						role="group"
						aria-label="Graph view controls"
						className="absolute bottom-4 right-4 flex items-center gap-1 rounded-xl border border-black/10 bg-surface-container/95 p-1 shadow-lg backdrop-blur dark:border-white/10"
					>
						<button
							type="button"
							aria-label="Zoom in"
							title="Zoom in"
							onClick={() => zoomBy(1.25)}
							className={`flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant hover:bg-black/5 hover:text-on-surface dark:hover:bg-white/10 ${FOCUS_RING}`}
						>
							<Plus size={18} aria-hidden="true" />
						</button>
						<button
							type="button"
							aria-label="Zoom out"
							title="Zoom out"
							onClick={() => zoomBy(0.8)}
							className={`flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant hover:bg-black/5 hover:text-on-surface dark:hover:bg-white/10 ${FOCUS_RING}`}
						>
							<Minus size={18} aria-hidden="true" />
						</button>
						<button
							type="button"
							aria-label="Reset view"
							title="Reset view"
							onClick={resetView}
							className={`flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant hover:bg-black/5 hover:text-on-surface dark:hover:bg-white/10 ${FOCUS_RING}`}
						>
							<RotateCcw size={16} aria-hidden="true" />
						</button>
					</div>

					<p className="sr-only">
						Use the Zoom in, Zoom out and Reset view buttons to change the graph scale. Drag anywhere on the canvas to pan.
					</p>
				</div>
			)}
		</div>
	)
}

/** Loading placeholder for the graph surface. */
export function GraphViewSkeleton () {
	return (
		<div
			role="status"
			aria-busy="true"
			aria-label="Building your graph"
			className="flex h-full min-h-[320px] w-full flex-col gap-3"
		>
			<div className="h-[4.5rem] w-full animate-pulse rounded-2xl bg-black/5 dark:bg-white/10" />
			<div className="flex-1 animate-pulse rounded-2xl border border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/10" />
			<span className="sr-only">Building your graph…</span>
		</div>
	)
}

function truncate (title: string): string {
	return title.length > MAX_LABEL_CHARS ? `${title.slice(0, MAX_LABEL_CHARS - 1)}…` : title
}

/** True when an edge segment cannot intersect the viewport. */
function segmentOutside (from: Point, to: Point, width: number, height: number): boolean {
	return (from.x < 0 && to.x < 0)
		|| (from.x > width && to.x > width)
		|| (from.y < 0 && to.y < 0)
		|| (from.y > height && to.y > height)
}

function plural (count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function clamp (value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value))
}

/** Resolve theme tokens from `globals.css`, with SSR/test fallbacks. */
function readPalette (): Palette {
	if (typeof window === 'undefined') {
		return {
			edge: 'rgba(25,28,30,0.18)',
			ghostEdge: 'rgba(25,28,30,0.34)',
			node: '#e07b00',
			nodeStroke: 'rgba(255,255,255,0.9)',
			ghost: 'rgba(60,60,60,0.55)',
			hover: '#8a4b00',
			label: '#262626',
			labelMuted: '#595959',
		}
	}

	const styles = getComputedStyle(document.documentElement)
	const dark = document.documentElement.classList.contains('dark')
	const token = (name: string, fallback: string) => {
		const raw = styles.getPropertyValue(name).trim()
		return raw ? `hsl(${raw})` : fallback
	}

	return {
		edge: dark ? 'rgba(235,235,235,0.16)' : 'rgba(25,28,30,0.18)',
		ghostEdge: dark ? 'rgba(235,235,235,0.32)' : 'rgba(25,28,30,0.34)',
		node: token('--primary-container', '#e07b00'),
		nodeStroke: dark ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.9)',
		ghost: dark ? 'rgba(255,255,255,0.55)' : 'rgba(60,60,60,0.55)',
		hover: token('--primary', '#8a4b00'),
		label: token('--on-surface', '#262626'),
		labelMuted: token('--on-surface-variant', '#595959'),
	}
}
