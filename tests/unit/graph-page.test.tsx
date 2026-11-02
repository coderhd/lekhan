import '@testing-library/jest-dom'
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import GraphPage from '@/components/graph-page'
import { supabase } from '@/lib/supabase'
import { fetchWorkspaceGraph, fetchWorkspaces, fetchWorkspacePageTags } from '@/services/graph'
import type { Page, PageLink } from '@/types'

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
const replace = router.replace
vi.mock('next/navigation', () => ({ useRouter: () => router }))

vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getUser: vi.fn() } } }))

vi.mock('@/services/graph', () => ({
	fetchWorkspaces: vi.fn(),
	fetchWorkspaceGraph: vi.fn(),
	fetchWorkspacePageTags: vi.fn(),
}))

const getUser = supabase.auth.getUser as unknown as ReturnType<typeof vi.fn>
const workspaces = fetchWorkspaces as unknown as ReturnType<typeof vi.fn>
const workspaceGraph = fetchWorkspaceGraph as unknown as ReturnType<typeof vi.fn>
const pageTags = fetchWorkspacePageTags as unknown as ReturnType<typeof vi.fn>

const page = (id: string, title: string): Page => ({
	id,
	workspace_id: 'ws-1',
	parent_id: null,
	title,
	owner_id: 'user-1',
	icon: null,
	cover: null,
	properties: {},
	is_public: false,
	searchable_text: null,
	created_at: '2026-11-01T00:00:00.000Z',
	updated_at: '2026-11-02T00:00:00.000Z',
})

const link = (id: string, from: string, to: string | null, toTitle: string): PageLink => ({
	id,
	workspace_id: 'ws-1',
	from_page_id: from,
	to_page_id: to,
	to_title: toTitle,
	block_id: null,
	created_at: '2026-11-02T00:00:00.000Z',
})

const context2d = new Proxy({}, {
	get (target, prop) {
		const value = (target as Record<string | symbol, unknown>)[prop]
		if (value) return value
		return () => undefined
	},
	set (target, prop, value) {
		(target as Record<string | symbol, unknown>)[prop] = value
		return true
	},
})

describe('GraphPage', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context2d as unknown as CanvasRenderingContext2D)
		vi.stubGlobal('ResizeObserver', class {
			observe () {}
			unobserve () {}
			disconnect () {}
		})
		getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
		workspaces.mockResolvedValue([{ id: 'ws-1', name: 'My Workspace', owner_id: 'user-1' }])
		workspaceGraph.mockResolvedValue({
			pages: [page('p-1', 'Alpha'), page('p-2', 'Beta')],
			links: [
				link('l-1', 'p-1', 'p-2', 'Beta'),
				link('l-2', 'p-2', null, 'Not written yet'),
			],
		})
		pageTags.mockResolvedValue(new Map([['p-1', ['research']]]))
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it('loads the workspace graph and serializes it into canvas props', async () => {
		render(<GraphPage />)

		expect(await screen.findByRole('img')).toHaveAccessibleName(/2 pages and 2 page links/i)
		expect(screen.getByRole('heading', { name: 'Graph' })).toBeInTheDocument()
		expect(screen.getByRole('link', { name: /graph/i })).toHaveAttribute('aria-current', 'page')
		expect(workspaceGraph).toHaveBeenCalledWith('ws-1')
		expect(pageTags).toHaveBeenCalledWith(['p-1', 'p-2'])
		// Read-only route: no workspace write path is touched.
		expect(screen.getByText(/1 unresolved/i)).toBeInTheDocument()
	})

	it('shows the graph skeleton while the workspace graph loads', async () => {
		workspaces.mockReturnValue(new Promise(() => {}))

		render(<GraphPage />)

		expect(await screen.findByRole('status', { name: /building your graph/i })).toHaveAttribute('aria-busy', 'true')
	})

	it('redirects signed-out visitors to login', async () => {
		getUser.mockResolvedValue({ data: { user: null }, error: null })

		render(<GraphPage />)

		await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
		expect(workspaceGraph).not.toHaveBeenCalled()
	})

	it('explains the empty workspace state instead of erroring', async () => {
		workspaces.mockResolvedValue([])

		render(<GraphPage />)

		expect(await screen.findByText(/no workspace yet/i)).toBeInTheDocument()
		expect(screen.getByRole('link', { name: /go to pages/i })).toHaveAttribute('href', '/')
		expect(workspaceGraph).not.toHaveBeenCalled()
	})

	it('offers a retry after a failed read without inventing data', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
		workspaceGraph.mockRejectedValueOnce(new Error('network down'))

		render(<GraphPage />)

		expect(await screen.findByText(/couldn't load your graph/i)).toBeInTheDocument()
		expect(consoleError).toHaveBeenCalled()

		fireEvent.click(screen.getByRole('button', { name: /try again/i }))

		expect(await screen.findByRole('img')).toBeInTheDocument()
		expect(workspaceGraph).toHaveBeenCalledTimes(2)
	})
})
