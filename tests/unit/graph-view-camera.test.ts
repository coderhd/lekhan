import { describe, it, expect } from 'vitest'
import { fitCamera, hitTestGraph, screenToWorld, worldToScreen, zoomCameraAt } from '@/lib/graph-view/camera'
import type { PositionedNode } from '@/lib/graph-view/layout'

const positioned = (id: string, x: number, y: number, degree = 0): PositionedNode => ({
	id,
	kind: 'page',
	title: id,
	tags: [],
	isPublic: false,
	updatedAt: null,
	x,
	y,
	degree,
})

describe('fitCamera', () => {
	it('centres the world bounds in the viewport', () => {
		const camera = fitCamera(
			{ minX: -100, minY: -100, maxX: 100, maxY: 100 },
			{ width: 800, height: 600 },
		)

		expect(camera.scale).toBeGreaterThan(0)
		const centre = worldToScreen({ x: 0, y: 0 }, camera)
		expect(centre.x).toBeCloseTo(400)
		expect(centre.y).toBeCloseTo(300)
	})

	it('keeps a degenerate single-node graph visible', () => {
		const camera = fitCamera({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, { width: 800, height: 600 })

		const point = worldToScreen({ x: 5, y: 5 }, camera)
		expect(point.x).toBeCloseTo(400)
		expect(point.y).toBeCloseTo(300)
	})

	it('never fits below the minimum interactive scale', () => {
		const camera = fitCamera(
			{ minX: -1_000_000, minY: -1_000_000, maxX: 1_000_000, maxY: 1_000_000 },
			{ width: 800, height: 600 },
		)

		expect(camera.scale).toBeGreaterThanOrEqual(0.15)
	})
})

describe('screen/world transforms', () => {
	it('round-trips a point through worldToScreen and screenToWorld', () => {
		const camera = { scale: 1.75, tx: 40, ty: -12 }
		const world = { x: 123.5, y: -47 }

		const roundTripped = screenToWorld(worldToScreen(world, camera), camera)

		expect(roundTripped.x).toBeCloseTo(world.x)
		expect(roundTripped.y).toBeCloseTo(world.y)
	})
})

describe('zoomCameraAt', () => {
	it('keeps the anchored world point under the cursor', () => {
		const camera = { scale: 1, tx: 50, ty: 20 }
		const cursor = { x: 300, y: 200 }
		const anchoredWorld = screenToWorld(cursor, camera)

		const zoomed = zoomCameraAt(camera, cursor, 2)

		expect(zoomed.scale).toBe(2)
		const anchoredScreen = worldToScreen(anchoredWorld, zoomed)
		expect(anchoredScreen.x).toBeCloseTo(cursor.x)
		expect(anchoredScreen.y).toBeCloseTo(cursor.y)
	})

	it('clamps to the interactive zoom range', () => {
		const camera = { scale: 1, tx: 0, ty: 0 }

		expect(zoomCameraAt(camera, { x: 0, y: 0 }, 100).scale).toBe(4)
		expect(zoomCameraAt(camera, { x: 0, y: 0 }, 0.0001).scale).toBe(0.15)
	})
})

describe('hitTestGraph', () => {
	const nodes = [positioned('left', -100, 0, 8), positioned('right', 100, 0, 1)]

	it('returns the nearest node under the pointer', () => {
		const camera = { scale: 1, tx: 400, ty: 300 }

		expect(hitTestGraph(nodes, { x: 300, y: 300 }, camera)?.id).toBe('left')
		expect(hitTestGraph(nodes, { x: 500, y: 300 }, camera)?.id).toBe('right')
	})

	it('uses a screen-space floor so tiny nodes stay clickable', () => {
		const camera = { scale: 0.2, tx: 400, ty: 300 }

		// Node centre lands on screen at (380, 300); a 9px-away tap still hits.
		expect(hitTestGraph(nodes, { x: 389, y: 300 }, camera)?.id).toBe('left')
	})

	it('returns null when the pointer misses every node', () => {
		const camera = { scale: 1, tx: 400, ty: 300 }

		expect(hitTestGraph(nodes, { x: 400, y: 50 }, camera)).toBeNull()
	})
})
