'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import type { WorkspaceGraphData } from '@/lib/graph-view/types'

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-container focus-visible:ring-offset-2'
const LABEL_ZOOM = 0.55
const GHOST_LABEL_ZOOM = 0.4
const MAX_LABEL_CHARS = 28
const DRAG_THRESHOLD = 4

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
 * Canvas-2D workspace graph surface: pan, zoom, hover, and click-through into
 * the editor. Ghost nodes (dashed) stand in for unresolved `page_links`
 * targets and are intentionally not navigable. The view is read-only — it
 * renders the payload serialized from `fetchWorkspaceGraph` and never writes.
 */
export default function GraphView ({ data, layout, className }: GraphViewProps) {
	const router = useRouter()
	const containerRef = useRef<HTMLDivElement>(null)
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const dragRef = useRef<DragState | null>(null)
	const lastLayoutRef = useRef<PositionedGraph | null>(null)

	const [size, setSize] = useState<Size>({ width: 0, height: 0 })
	const [camera, setCamera] = useState<Camera | null>(null)
	const [hoveredId, setHoveredId] = useState<string | null>(null)
	const [cursor, setCursor] = useState<'default' | 'grab' | 'grabbing' | 'pointer'>('grab')

	const positioned = useMemo(
		() => layout ?? computeGraphLayout(data.nodes, data.edges),
		[layout, data],
	)
	const nodes = positioned.nodes
	const empty = nodes.length === 0

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
	}, [])

	// Fit for a new graph or the first measurement. Plain resizes keep the
	// user's pan/zoom (Reset view restores the fitted camera on demand).
	useEffect(() => {
		if (size.width === 0 || size.height === 0 || empty) return
		const newLayout = lastLayoutRef.current !== positioned
		lastLayoutRef.current = positioned
		if (newLayout || camera === null) {
			setCamera(fitCamera(positioned.bounds, size))
		}
	}, [positioned, size.width, size.height, empty, camera])

	const resetView = useCallback(() => {
		if (!empty && size.width > 0 && size.height > 0) {
			setCamera(fitCamera(positioned.bounds, size))
		}
	}, [empty, positioned, size])

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
	}, [])

	// Paint on every camera/hover/size change.
	useEffect(() => {
		const canvas = canvasRef.current
		if (!canvas || !camera || empty || size.width === 0 || size.height === 0) return
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
		const byId = new Map(nodes.map(node => [node.id, node]))
		const onScreen = (point: PositionedNode) => worldToScreen(point, camera)
		const visible = (point: Point) =>
			point.x > -80 && point.y > -40 && point.x < size.width + 80 && point.y < size.height + 40

		// Edges first, so nodes sit on top.
		context.lineWidth = 1
		for (const edge of positioned.edges) {
			const source = byId.get(edge.source)
			const target = byId.get(edge.target)
			if (!source || !target) continue
			const from = onScreen(source)
			const to = onScreen(target)
			// Cull only when the whole segment is outside the same viewport
			// edge; long edges crossing the view stay visible when zoomed in.
			if (segmentOutside(from, to, size.width, size.height)) continue
			context.beginPath()
			context.setLineDash(edge.unresolved ? [4, 4] : [])
			context.strokeStyle = edge.unresolved ? palette.ghostEdge : palette.edge
			context.moveTo(from.x, from.y)
			context.lineTo(to.x, to.y)
			context.stroke()
		}
		context.setLineDash([])

		// Nodes: ghosts are dashed outlines, pages are filled discs.
		for (const node of nodes) {
			const point = onScreen(node)
			if (!visible(point)) continue
			const radius = Math.max(3.5, nodeRadius(node.degree) * camera.scale)
			const hovered = node.id === hoveredId

			context.beginPath()
			context.arc(point.x, point.y, radius, 0, Math.PI * 2)
			if (node.kind === 'unresolved') {
				context.setLineDash([3, 3])
				context.lineWidth = 1.6
				context.strokeStyle = palette.ghost
				context.stroke()
				context.setLineDash([])
			} else {
				context.fillStyle = hovered ? palette.hover : palette.node
				context.fill()
				context.lineWidth = hovered ? 2.5 : 1.5
				context.strokeStyle = palette.nodeStroke
				context.stroke()
			}
		}

		// Labels: pages once zoomed in, ghosts a little earlier, hovered always.
		context.textBaseline = 'middle'
		for (const node of nodes) {
			const point = onScreen(node)
			if (!visible(point)) continue
			const hovered = node.id === hoveredId
			const threshold = node.kind === 'unresolved' ? GHOST_LABEL_ZOOM : LABEL_ZOOM
			if (!hovered && camera.scale < threshold) continue
			const radius = Math.max(3.5, nodeRadius(node.degree) * camera.scale)
			context.font = `${node.kind === 'unresolved' ? 'italic ' : ''}11px Inter, system-ui, sans-serif`
			context.fillStyle = node.kind === 'unresolved' ? palette.labelMuted : palette.label
			context.fillText(truncate(node.title), point.x + radius + 4, point.y + 1)
		}
	}, [camera, empty, hoveredId, nodes, positioned.edges, size.height, size.width])

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
		setHoveredId(hit?.id ?? null)
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
		setHoveredId(null)
		setCursor('grab')
	}

	const handlePointerCancel = () => {
		dragRef.current = null
		setCursor('grab')
	}

	if (empty) {
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

	const linkCount = data.edges.length
	const description = [
		`${plural(data.totalPages, 'page')} and ${plural(linkCount, 'page link')} in this workspace.`,
		data.unresolvedLinks > 0
			? `${plural(data.unresolvedLinks, 'unresolved link')} shown as dashed ghost nodes.`
			: '',
		'Drag to pan, scroll or use the buttons to zoom.',
		'Page nodes open in the editor when clicked, or from the Pages in this graph list.',
	].filter(Boolean).join(' ')

	return (
		<div
			ref={containerRef}
			className={`relative h-full w-full overflow-hidden rounded-2xl border border-black/10 bg-surface-container-lowest dark:border-white/10 ${className ?? ''}`}
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
			<div className="sr-only focus-within:not-sr-only focus-within:absolute focus-within:left-4 focus-within:top-4 focus-within:z-10 focus-within:max-h-72 focus-within:w-64 focus-within:overflow-auto focus-within:rounded-xl focus-within:border focus-within:border-black/10 focus-within:bg-surface-container focus-within:p-3 focus-within:shadow-xl dark:focus-within:border-white/10">
				<h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-on-surface-variant">Pages in this graph</h2>
				<ul className="flex flex-col gap-1 text-sm">
					{nodes.filter(node => node.kind === 'page').map(node => (
						<li key={node.id}>
							<Link
								href={`/page/${node.id}`}
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
					className={`flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant hover:bg-black/5 hover:text-on-surface dark:hover:bg-white/10 ${FOCUS_RING}`}
				>
					<Plus size={18} aria-hidden="true" />
				</button>
				<button
					type="button"
					aria-label="Zoom out"
					title="Zoom out"
					onClick={() => zoomBy(0.8)}
					className={`flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant hover:bg-black/5 hover:text-on-surface dark:hover:bg-white/10 ${FOCUS_RING}`}
				>
					<Minus size={18} aria-hidden="true" />
				</button>
				<button
					type="button"
					aria-label="Reset view"
					title="Reset view"
					onClick={resetView}
					className={`flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant hover:bg-black/5 hover:text-on-surface dark:hover:bg-white/10 ${FOCUS_RING}`}
				>
					<RotateCcw size={16} aria-hidden="true" />
				</button>
			</div>

			<p className="sr-only">
				Use the Zoom in, Zoom out and Reset view buttons to change the graph scale. Drag anywhere on the canvas to pan.
			</p>
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
