import '@testing-library/jest-dom'
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import GraphView from '@/components/graph-view'
import type { PositionedGraph } from '@/lib/graph-view/layout'
import type { WorkspaceGraphData } from '@/lib/graph-view/types'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const data: WorkspaceGraphData = {
	nodes: [
		{ id: 'p-1', kind: 'page', title: 'Alpha', tags: [], isPublic: false, updatedAt: null },
		{ id: 'p-2', kind: 'page', title: 'Beta', tags: [], isPublic: false, updatedAt: null },
		{ id: 'ghost:later', kind: 'unresolved', title: 'Later', tags: [], isPublic: false, updatedAt: null },
	],
	edges: [
		{ id: 'l-1', source: 'p-1', target: 'p-2', unresolved: false },
		{ id: 'l-2', source: 'p-2', target: 'ghost:later', unresolved: true },
	],
	tags: [],
	totalPages: 2,
	totalLinks: 2,
	unresolvedLinks: 1,
}

const layout = (node: PositionedGraph['nodes'][number]): PositionedGraph => ({
	nodes: [node],
	edges: [],
	bounds: { minX: node.x, minY: node.y, maxX: node.x, maxY: node.y },
	iterations: 1,
})

const positioned = (
	id: string,
	kind: 'page' | 'unresolved' = 'page',
): PositionedGraph['nodes'][number] => ({
	id,
	kind,
	title: id === 'ghost:later' ? 'Later' : 'Alpha',
	tags: [],
	isPublic: false,
	updatedAt: null,
	x: 0,
	y: 0,
	degree: 1,
})

class ResizeObserverStub {
	callback: ResizeObserverCallback
	constructor (callback: ResizeObserverCallback) {
		this.callback = callback
	}
	observe () {
		this.callback([{ contentRect: { width: 800, height: 600 } }] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver)
	}
	unobserve () {}
	disconnect () {}
}

const context2d = new Proxy({}, {
	get (target, prop) {
		if (prop === 'canvas') return document.createElement('canvas')
		const value = (target as Record<string | symbol, unknown>)[prop]
		if (value) return value
		return () => undefined
	},
	set (target, prop, value) {
		(target as Record<string | symbol, unknown>)[prop] = value
		return true
	},
})

describe('GraphView', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// jsdom has no PointerEvent; testing-library then builds a plain Event
		// and drops clientX/clientY. A MouseEvent subclass restores coordinates.
		vi.stubGlobal('PointerEvent', class PointerEventPolyfill extends MouseEvent {})
		vi.stubGlobal('ResizeObserver', ResizeObserverStub)
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context2d as unknown as CanvasRenderingContext2D)
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
			width: 800, height: 600, left: 0, top: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}),
		})
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it('renders an accessible canvas summary including ghost links', () => {
		render(<GraphView data={data} />)

		const canvas = screen.getByRole('img')
		expect(canvas).toHaveAccessibleName(/2 pages/i)
		expect(canvas).toHaveAccessibleName(/2 page links/i)
		expect(canvas).toHaveAccessibleName(/1 unresolved/i)
	})

	it('exposes keyboard-reachable, labelled pan/zoom controls', () => {
		render(<GraphView data={data} />)

		for (const name of [/zoom in/i, /zoom out/i, /reset view/i]) {
			const button = screen.getByRole('button', { name })
			expect(button.tagName).toBe('BUTTON')
			expect(button).toHaveAttribute('type', 'button')
		}
	})

	it('exposes page nodes as keyboard-reachable links', () => {
		render(<GraphView data={data} />)

		const alpha = screen.getByRole('link', { name: 'Alpha' })
		expect(alpha).toHaveAttribute('href', '/page/p-1')
		expect(screen.getByRole('link', { name: 'Beta' })).toHaveAttribute('href', '/page/p-2')
		// Ghost nodes are labelled for AT but are not navigable.
		expect(screen.queryByRole('link', { name: 'Later' })).not.toBeInTheDocument()
		expect(screen.getByText(/unresolved: later/i)).toBeInTheDocument()
	})

	it('opens a page node in the editor on click', () => {
		render(<GraphView data={data} layout={layout(positioned('p-1'))} />)

		const canvas = screen.getByRole('img')
		fireEvent.pointerDown(canvas, { clientX: 400, clientY: 300, button: 0 })
		fireEvent.pointerUp(canvas, { clientX: 400, clientY: 300, button: 0 })

		expect(push).toHaveBeenCalledWith('/page/p-1')
	})

	it('does not navigate for a ghost node', () => {
		render(<GraphView data={data} layout={layout(positioned('ghost:later', 'unresolved'))} />)

		const canvas = screen.getByRole('img')
		fireEvent.pointerDown(canvas, { clientX: 400, clientY: 300, button: 0 })
		fireEvent.pointerUp(canvas, { clientX: 400, clientY: 300, button: 0 })

		expect(push).not.toHaveBeenCalled()
	})

	it('treats a drag as panning, not a node click', () => {
		render(<GraphView data={data} layout={layout(positioned('p-1'))} />)

		const canvas = screen.getByRole('img')
		fireEvent.pointerDown(canvas, { clientX: 400, clientY: 300, button: 0 })
		fireEvent.pointerMove(canvas, { clientX: 460, clientY: 340 })
		fireEvent.pointerUp(canvas, { clientX: 460, clientY: 340, button: 0 })

		expect(push).not.toHaveBeenCalled()
	})

	it('shows an empty state instead of a canvas when the workspace has no pages', () => {
		render(<GraphView data={{ nodes: [], edges: [], tags: [], totalPages: 0, totalLinks: 0, unresolvedLinks: 0 }} />)

		expect(screen.queryByRole('img')).not.toBeInTheDocument()
		expect(screen.getByText(/no pages to graph yet/i)).toBeInTheDocument()
	})
})
