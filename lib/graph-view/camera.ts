import { nodeRadius, type GraphBounds, type PositionedNode } from './layout'

export interface Point {
	x: number
	y: number
}

export interface Size {
	width: number
	height: number
}

/** Screen = world * scale + translation. */
export interface Camera {
	scale: number
	tx: number
	ty: number
}

export const MIN_SCALE = 0.15
export const MAX_SCALE = 4
const MAX_FIT_SCALE = 1.5

export function worldToScreen (point: Point, camera: Camera): Point {
	return { x: point.x * camera.scale + camera.tx, y: point.y * camera.scale + camera.ty }
}

export function screenToWorld (point: Point, camera: Camera): Point {
	return { x: (point.x - camera.tx) / camera.scale, y: (point.y - camera.ty) / camera.scale }
}

/** Fit the whole graph into the viewport, centred, with breathing room. */
export function fitCamera (bounds: GraphBounds, size: Size, padding = 48): Camera {
	const usableWidth = Math.max(size.width - padding * 2, 1)
	const usableHeight = Math.max(size.height - padding * 2, 1)
	// Degenerate bounds (one node, or all nodes coincident) still need a scale.
	const spanX = Math.max(bounds.maxX - bounds.minX, 1)
	const spanY = Math.max(bounds.maxY - bounds.minY, 1)
	const scale = clamp(Math.min(usableWidth / spanX, usableHeight / spanY), MIN_SCALE, MAX_FIT_SCALE)
	const centreX = (bounds.minX + bounds.maxX) / 2
	const centreY = (bounds.minY + bounds.maxY) / 2

	return {
		scale,
		tx: size.width / 2 - centreX * scale,
		ty: size.height / 2 - centreY * scale,
	}
}

/** Zoom while keeping the world point under `anchor` pinned in place. */
export function zoomCameraAt (camera: Camera, anchor: Point, factor: number): Camera {
	const scale = clamp(camera.scale * factor, MIN_SCALE, MAX_SCALE)
	const pinned = screenToWorld(anchor, camera)
	return {
		scale,
		tx: anchor.x - pinned.x * scale,
		ty: anchor.y - pinned.y * scale,
	}
}

/**
 * Nearest node under a screen point. The hit radius has a screen-space floor
 * so small nodes stay tappable when zoomed far out.
 */
export function hitTestGraph (nodes: PositionedNode[], point: Point, camera: Camera): PositionedNode | null {
	let nearest: PositionedNode | null = null
	let nearestDistance = Infinity

	for (const node of nodes) {
		const centre = worldToScreen(node, camera)
		const distance = Math.hypot(centre.x - point.x, centre.y - point.y)
		const radius = Math.max(nodeRadius(node.degree) * camera.scale, 8) + 2
		if (distance <= radius && distance < nearestDistance) {
			nearest = node
			nearestDistance = distance
		}
	}
	return nearest
}

function clamp (value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value))
}
