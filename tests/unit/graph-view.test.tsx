import '@testing-library/jest-dom'
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach, afterAll } from 'vitest'
import GraphView, { GraphViewSkeleton } from '@/components/graph-view'
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

const tagged: WorkspaceGraphData = {
	...data,
	nodes: [
		{ id: 'p-1', kind: 'page', title: 'Alpha', tags: ['research'], isPublic: false, updatedAt: null },
		{ id: 'p-2', kind: 'page', title: 'Beta', tags: ['journal'], isPublic: false, updatedAt: null },
	],
	tags: [
		{ tag: 'research', count: 1 },
		{ tag: 'journal', count: 1 },
	],
	totalPages: 2,
	totalLinks: 1,
	unresolvedLinks: 0,
	edges: [{ id: 'l-1', source: 'p-1', target: 'p-2', unresolved: false }],
}

const noLinks: WorkspaceGraphData = {
	nodes: [
		{ id: 'p-1', kind: 'page', title: 'Alpha', tags: [], isPublic: false, updatedAt: null },
		{ id: 'p-2', kind: 'page', title: 'Beta', tags: [], isPublic: false, updatedAt: null },
	],
	edges: [],
	tags: [],
	totalPages: 2,
	totalLinks: 0,
	unresolvedLinks: 0,
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
	title = id === 'ghost:later' ? 'Later' : 'Alpha',
): PositionedGraph['nodes'][number] => ({
	id,
	kind,
	title,
	tags: [],
	isPublic: false,
	updatedAt: null,
	x: 0,
	y: 0,
	degree: 1,
})

const hoverLayout: PositionedGraph = {
	nodes: [
		{ ...positioned('p-1', 'page', 'Alpha'), degree: 1 },
		{ ...positioned('p-2', 'page', 'Beta'), degree: 1 },
	],
	edges: [{ id: 'l-1', source: 'p-1', target: 'p-2', unresolved: false }],
	bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
	iterations: 1,
}

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
	// Install prototype spies once: the debounced filter commits a paint effect
	// during teardown, after per-test restore hooks have already run.
	beforeAll(() => {
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context2d as unknown as CanvasRenderingContext2D)
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
			width: 800, height: 600, left: 0, top: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}),
		})
	})

	beforeEach(() => {
		vi.clearAllMocks()
		// jsdom has no PointerEvent; testing-library then builds a plain Event
		// and drops clientX/clientY. A MouseEvent subclass restores coordinates.
		vi.stubGlobal('PointerEvent', class PointerEventPolyfill extends MouseEvent {})
		vi.stubGlobal('ResizeObserver', ResizeObserverStub)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	afterAll(() => {
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

	it('highlights a hovered node and its incident links', () => {
		render(<GraphView data={data} layout={hoverLayout} />)

		fireEvent.pointerMove(screen.getByRole('img'), { clientX: 400, clientY: 300 })

		const card = screen.getByTestId('graph-hover-card')
		expect(card).toHaveTextContent('Alpha')
		expect(card).toHaveTextContent(/beta/i)
		expect(card).toHaveTextContent(/1 link/i)
		expect(document.querySelector('[data-highlighted-node="p-1"]')).not.toBeNull()
	})

	it('clears the hover card and highlight on leave and pointer cancel', () => {
		render(<GraphView data={data} layout={hoverLayout} />)
		const canvas = screen.getByRole('img')

		fireEvent.pointerMove(canvas, { clientX: 400, clientY: 300 })
		expect(screen.getByTestId('graph-hover-card')).toBeInTheDocument()

		fireEvent.pointerLeave(canvas)
		expect(screen.queryByTestId('graph-hover-card')).not.toBeInTheDocument()
		expect(document.querySelector('[data-highlighted-node]')).toBeNull()

		fireEvent.pointerMove(canvas, { clientX: 400, clientY: 300 })
		expect(screen.getByTestId('graph-hover-card')).toBeInTheDocument()

		fireEvent.pointerCancel(canvas)
		expect(screen.queryByTestId('graph-hover-card')).not.toBeInTheDocument()
		expect(document.querySelector('[data-highlighted-node]')).toBeNull()
	})

	it('highlights a node from the keyboard page list', () => {
		render(<GraphView data={data} layout={layout(positioned('p-1'))} />)

		fireEvent.focus(screen.getByRole('link', { name: 'Alpha' }))

		expect(document.querySelector('[data-highlighted-node="p-1"]')).not.toBeNull()
	})

	it('filters nodes by title before laying the graph out', async () => {
		render(<GraphView data={tagged} />)

		fireEvent.change(screen.getByRole('searchbox', { name: /filter pages by title/i }), { target: { value: 'beta' } })

		await waitFor(() => expect(screen.queryByRole('link', { name: 'Alpha' })).not.toBeInTheDocument())
		expect(screen.getByRole('link', { name: 'Beta' })).toBeInTheDocument()
		expect(screen.getByRole('status')).toHaveTextContent('1 of 2 pages')
	})

	it('filters nodes by tag facet', async () => {
		render(<GraphView data={tagged} />)

		fireEvent.click(screen.getByRole('checkbox', { name: /#research/i }))

		await waitFor(() => expect(screen.queryByRole('link', { name: 'Beta' })).not.toBeInTheDocument())
		expect(screen.getByRole('link', { name: 'Alpha' })).toBeInTheDocument()
	})

	it('explains that no pages match the filters and lets the user clear them', async () => {
		render(<GraphView data={tagged} />)

		fireEvent.change(screen.getByRole('searchbox', { name: /filter pages by title/i }), { target: { value: 'zzz' } })

		expect(await screen.findByText(/no pages match these filters/i)).toBeInTheDocument()
		expect(screen.queryByRole('img')).not.toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: /clear filters/i }))

		expect(await screen.findByRole('img')).toBeInTheDocument()
		expect(screen.getByRole('link', { name: 'Alpha' })).toBeInTheDocument()
	})

	it('does not claim the workspace has no links when the filter removed them', async () => {
		render(<GraphView data={tagged} />)

		fireEvent.change(screen.getByRole('searchbox', { name: /filter pages by title/i }), { target: { value: 'alpha' } })

		expect(await screen.findByText(/no links between the filtered pages/i)).toBeInTheDocument()
		expect(screen.queryByText(/no page links yet/i)).not.toBeInTheDocument()
	})

	it('shows an empty state instead of a canvas when the workspace has no pages', () => {
		render(<GraphView data={{ nodes: [], edges: [], tags: [], totalPages: 0, totalLinks: 0, unresolvedLinks: 0 }} />)

		expect(screen.queryByRole('img')).not.toBeInTheDocument()
		expect(screen.getByText(/no pages to graph yet/i)).toBeInTheDocument()
		expect(screen.queryByRole('searchbox', { name: /filter pages by title/i })).not.toBeInTheDocument()
	})

	it('explains the no-links state while still showing the pages', () => {
		render(<GraphView data={noLinks} />)

		expect(screen.getByRole('img')).toBeInTheDocument()
		expect(screen.getByText(/no page links yet/i)).toBeInTheDocument()
		expect(screen.getByRole('link', { name: 'Alpha' })).toBeInTheDocument()
	})

	it('shows a "showing N of M links" badge when edges are sampled', () => {
		const manyEdges = Array.from({ length: 1_001 }, (_, index) => ({
			id: `e-${index}`,
			source: 'p-1',
			target: 'p-2',
			unresolved: false,
		}))
		const sampled: WorkspaceGraphData = {
			...data,
			edges: manyEdges,
			totalLinks: 1_001,
			unresolvedLinks: 0,
		}

		render(<GraphView data={sampled} />)

		expect(screen.getByText('Showing 1,000 of 1,001 links')).toBeInTheDocument()
		// The canvas summary must not claim more edges than were rendered.
		expect(screen.getByRole('img')).toHaveAccessibleName(/1,000 of 1,001 page links shown/i)
	})
})

describe('GraphViewSkeleton', () => {
	it('announces a busy, labelled loading state', () => {
		render(<GraphViewSkeleton />)

		const status = screen.getByRole('status', { name: /building your graph/i })
		expect(status).toHaveAttribute('aria-busy', 'true')
	})
})
