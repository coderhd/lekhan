import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import React from 'react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const searchPages = vi.fn()
const fetchRecentPages = vi.fn()
vi.mock('@/services/search', () => ({
	searchPages: (...args: any[]) => searchPages(...args),
	fetchRecentPages: (...args: any[]) => fetchRecentPages(...args),
}))

const getSession = vi.fn()
vi.mock('@/lib/supabase', () => ({
	supabase: {
		auth: {
			getSession: (...args: any[]) => getSession(...args),
			onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
		},
	},
}))

const reauth = vi.hoisted(() => ({ useSessionReauth: vi.fn() }))
vi.mock('@/components/session-reauth-provider', () => ({
	useSessionReauth: (...args: any[]) => reauth.useSessionReauth(...args),
}))

import GlobalSearchPalette, { useGlobalSearch } from '@/components/global-search-palette'

const Trigger = () => {
	const { open } = useGlobalSearch()
	return <button onClick={open}>Open Search</button>
}

const renderPalette = () => render(
	<GlobalSearchPalette>
		<Trigger />
	</GlobalSearchPalette>
)

const openViaKey = async () => {
	await act(async () => {}) // flush the getSession promise so userId is set
	await act(async () => {
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
	})
}

describe('GlobalSearchPalette', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
		getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null })
		fetchRecentPages.mockResolvedValue([
			{ id: 'p-1', title: 'Recent Page', owner_id: 'user-1', updated_at: '2026-08-14T00:00:00Z' },
		])
		searchPages.mockResolvedValue([
			{ id: 'p-9', title: 'Obsidian Workflow', icon: null, workspace_id: 'ws-1', updated_at: '2026-08-14T00:00:00Z', surface: 'title', context: null },
		])
		reauth.useSessionReauth.mockReturnValue({ isLocked: false, lockSession: vi.fn(), unlockSession: vi.fn() })
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('does not render when signed out', async () => {
		getSession.mockResolvedValue({ data: { session: null }, error: null })
		renderPalette()
		await act(async () => {})
		expect(screen.queryByPlaceholderText(/search pages/i)).toBeNull()
	})

	it('renders recent pages on an empty query (quick-switch)', async () => {
		renderPalette()
		await openViaKey()
		await act(async () => { await vi.advanceTimersByTimeAsync(210) })
		expect(fetchRecentPages).toHaveBeenCalledWith('user-1', 8)
		expect(screen.getByText('Recent Page')).toBeTruthy()
	})

	it('searches with the typed query and renders ranked results', async () => {
		renderPalette()
		await openViaKey()
		const input = screen.getByPlaceholderText(/search pages/i)
		fireEvent.change(input, { target: { value: 'obsidian' } })
		await act(async () => { await vi.advanceTimersByTimeAsync(210) })
		expect(searchPages).toHaveBeenCalledWith('obsidian', 15)
		expect(screen.getByText('Obsidian Workflow')).toBeTruthy()
	})

	it('renders recent pages when opened after the mount-time fetch would have completed', async () => {
		renderPalette()
		await act(async () => {}) // flush the getSession promise so userId is set
		await act(async () => { await vi.advanceTimersByTimeAsync(210) })
		expect(fetchRecentPages).not.toHaveBeenCalled()
		await openViaKey()
		await act(async () => { await vi.advanceTimersByTimeAsync(210) })
		expect(fetchRecentPages).toHaveBeenCalledWith('user-1', 8)
		expect(screen.getByText('Recent Page')).toBeTruthy()
	})

	it('navigates to the selected page on Enter', async () => {
		renderPalette()
		await openViaKey()
		const input = screen.getByPlaceholderText(/search pages/i)
		fireEvent.change(input, { target: { value: 'obsidian' } })
		await act(async () => { await vi.advanceTimersByTimeAsync(210) })
		fireEvent.keyDown(input, { key: 'ArrowDown' })
		fireEvent.keyDown(input, { key: 'Enter' })
		expect(push).toHaveBeenCalledWith('/page/p-9')
	})

	it('closes on Escape', async () => {
		renderPalette()
		await openViaKey()
		const input = screen.getByPlaceholderText(/search pages/i)
		fireEvent.keyDown(input, { key: 'Escape' })
		expect(screen.queryByPlaceholderText(/search pages/i)).toBeNull()
	})

	it('opens from the header trigger button', async () => {
		renderPalette()
		await act(async () => {}) // flush the getSession promise so userId is set
		fireEvent.click(screen.getByText('Open Search'))
		expect(screen.getByPlaceholderText(/search pages/i)).toBeTruthy()
	})

	it('does not open via Cmd+K when the session is locked', async () => {
		reauth.useSessionReauth.mockReturnValue({ isLocked: true, lockSession: vi.fn(), unlockSession: vi.fn() })
		renderPalette()
		await act(async () => {}) // flush the getSession promise so userId is set
		await act(async () => {
			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true }))
		})
		expect(screen.queryByPlaceholderText(/search pages/i)).toBeNull()
		expect(fetchRecentPages).not.toHaveBeenCalled()
	})

	it('does not open from the header trigger when the session is locked', async () => {
		reauth.useSessionReauth.mockReturnValue({ isLocked: true, lockSession: vi.fn(), unlockSession: vi.fn() })
		renderPalette()
		await act(async () => {}) // flush the getSession promise so userId is set
		fireEvent.click(screen.getByText('Open Search'))
		expect(screen.queryByPlaceholderText(/search pages/i)).toBeNull()
	})

	it('does not swallow the native Cmd+K shortcut when the session is locked', async () => {
		reauth.useSessionReauth.mockReturnValue({ isLocked: true, lockSession: vi.fn(), unlockSession: vi.fn() })
		renderPalette()
		await act(async () => {}) // flush the getSession promise so userId is set
		let evt: KeyboardEvent
		await act(async () => {
			evt = new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true })
			document.dispatchEvent(evt)
		})
		expect(evt!.defaultPrevented).toBe(false)
	})

	it('closes the palette when the session locks while it is open', async () => {
		const view = renderPalette()
		await openViaKey()
		expect(screen.getByPlaceholderText(/search pages/i)).toBeTruthy()
		reauth.useSessionReauth.mockReturnValue({ isLocked: true, lockSession: vi.fn(), unlockSession: vi.fn() })
		await act(async () => {
			view.rerender(
				<GlobalSearchPalette>
					<Trigger />
				</GlobalSearchPalette>
			)
		})
		expect(screen.queryByPlaceholderText(/search pages/i)).toBeNull()
	})

	it('shows a toast and empty state when search fails', async () => {
		searchPages.mockRejectedValue(new Error('boom'))
		renderPalette()
		await openViaKey()
		fireEvent.change(screen.getByPlaceholderText(/search pages/i), { target: { value: 'x' } })
		await act(async () => { await vi.advanceTimersByTimeAsync(210) })
		expect(toast.error).toHaveBeenCalledWith('Search failed. Please try again.')
		expect(screen.getByText(/no pages match/i)).toBeTruthy()
	})
})