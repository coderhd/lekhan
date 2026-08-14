import '@testing-library/jest-dom'
import React from 'react'
import { render, screen, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Dashboard from '@/components/dashboard'
import { GlobalHeaderProvider } from '@/components/layout/global-header-context'
import GlobalSearchPalette from '@/components/global-search-palette'

let authCallbacks: ((event: string, session: any) => void)[] = []

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/lib/supabase', () => ({
	supabase: {
		auth: {
			onAuthStateChange: vi.fn((cb: (event: string, session: any) => void) => {
				authCallbacks.push(cb)
				return { data: { subscription: { unsubscribe: vi.fn() } } }
			}),
			getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
		},
	},
}))

const ensureWorkspace = vi.fn()
const fetchWorkspacePages = vi.fn()
const fetchSharedPages = vi.fn()
const fetchPageInvites = vi.fn()
const createPage = vi.fn()

vi.mock('@/services/graph', () => ({
	ensureWorkspace: (...args: any[]) => ensureWorkspace(...args),
	fetchWorkspacePages: (...args: any[]) => fetchWorkspacePages(...args),
	fetchSharedPages: (...args: any[]) => fetchSharedPages(...args),
	fetchPendingPageInvitations: (...args: any[]) => fetchPageInvites(...args),
	createPage: (...args: any[]) => createPage(...args),
	deletePage: vi.fn(),
	updatePageTitle: vi.fn(),
}))

vi.mock('@/services/search', () => ({
	searchPages: vi.fn().mockResolvedValue([]),
	fetchRecentPages: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/components/invitations', () => ({ default: () => <div data-testid="invitations" /> }))
vi.mock('@/components/profile-menu', () => ({ default: () => <div /> }))
vi.mock('@/components/theme-toggle', () => ({ default: () => <div /> }))
vi.mock('@/components/global-loader', () => ({ default: ({ text }: { text: string }) => <div>{text}</div> }))
vi.mock('@/components/inline-edit', () => ({ InlineEdit: () => <div /> }))
vi.mock('@/components/ui/confirm-dialog', () => ({ ConfirmDialog: () => <div /> }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const user = { id: 'user-1', email: 'author@example.com' }

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((res) => { resolve = res })
	return { promise, resolve }
}

function fireAuth(event: string, session: any) {
	for (const cb of authCallbacks) cb(event, session)
}

function renderDashboard() {
	return render(
		<GlobalSearchPalette>
			<GlobalHeaderProvider>
				<Dashboard user={user} />
			</GlobalHeaderProvider>
		</GlobalSearchPalette>
	)
}

describe('Dashboard refetch on auth', () => {
	beforeEach(() => {
		authCallbacks = []
		ensureWorkspace.mockReset()
		fetchWorkspacePages.mockReset()
		fetchSharedPages.mockReset()
		fetchPageInvites.mockReset()
		ensureWorkspace.mockResolvedValue({ id: 'ws-1', owner_id: 'user-1' })
		fetchWorkspacePages.mockResolvedValue([])
		fetchSharedPages.mockResolvedValue([])
		fetchPageInvites.mockResolvedValue([])
	})

	it('refetches documents when a fresh session is established (SIGNED_IN)', async () => {
		renderDashboard()

		await waitFor(() => expect(fetchWorkspacePages).toHaveBeenCalledTimes(1))

		act(() => {
			fireAuth('SIGNED_IN', { user: { id: 'user-1', email: 'author@example.com' } })
		})

		await waitFor(() => expect(fetchWorkspacePages).toHaveBeenCalledTimes(2))
	})

	it('does not refetch on unrelated auth events', async () => {
		renderDashboard()

		await waitFor(() => expect(fetchWorkspacePages).toHaveBeenCalledTimes(1))

		act(() => {
			fireAuth('TOKEN_REFRESHED', { user: { id: 'user-1', email: 'author@example.com' } })
			fireAuth('USER_UPDATED', { user: { id: 'user-1', email: 'author@example.com' } })
		})

		expect(fetchWorkspacePages).toHaveBeenCalledTimes(1)
	})

	it('shows a retryable error state instead of the empty state when fetching fails', async () => {
		fetchWorkspacePages.mockRejectedValueOnce(new Error('PGRST303'))

		renderDashboard()

		expect(await screen.findByText(/couldn't load your pages/i)).toBeInTheDocument()
		expect(screen.queryByText(/welcome to lekhan/i)).not.toBeInTheDocument()

		fetchWorkspacePages.mockResolvedValueOnce([{ id: 'doc-1', title: 'My Doc', owner_id: 'user-1', updated_at: new Date().toISOString() }])

		act(() => {
			screen.getByRole('button', { name: /try again/i }).click()
		})

		await waitFor(() => expect(fetchWorkspacePages).toHaveBeenCalledTimes(2))
		expect(screen.queryByText(/couldn't load your pages/i)).not.toBeInTheDocument()
	})

	it('replaces the error view with a loading state during a retry', async () => {
		fetchWorkspacePages.mockRejectedValueOnce(new Error('PGRST303'))

		renderDashboard()

		expect(await screen.findByText(/couldn't load your pages/i)).toBeInTheDocument()

		const ownedDeferred = deferred<any[]>()
		const sharedDeferred = deferred<any[]>()
		const invitesDeferred = deferred<any[]>()

		fetchWorkspacePages.mockImplementationOnce(() => ownedDeferred.promise)
		fetchSharedPages.mockImplementationOnce(() => sharedDeferred.promise)
		fetchPageInvites.mockImplementationOnce(() => invitesDeferred.promise)

		act(() => {
			screen.getByRole('button', { name: /try again/i }).click()
		})

		expect(screen.queryByText(/couldn't load your pages/i)).not.toBeInTheDocument()
		expect(screen.getByText('Loading dashboard...')).toBeInTheDocument()

		await act(async () => {
			ownedDeferred.resolve([{ id: 'doc-1', title: 'My Doc', owner_id: 'user-1', updated_at: new Date().toISOString() }])
			sharedDeferred.resolve([])
			invitesDeferred.resolve([])
		})

		expect(screen.queryByText('Loading dashboard...')).not.toBeInTheDocument()
		expect(screen.queryByText(/couldn't load your pages/i)).not.toBeInTheDocument()
	})

	it('keeps the newer result when a refreshed request resolves before the original', async () => {
		const firstOwned = deferred<any[]>()
		const firstShared = deferred<any[]>()
		const firstInvites = deferred<any[]>()
		const secondOwned = deferred<any[]>()
		const secondShared = deferred<any[]>()
		const secondInvites = deferred<any[]>()

		fetchWorkspacePages.mockImplementationOnce(() => firstOwned.promise)
		fetchSharedPages.mockImplementationOnce(() => firstShared.promise)
		fetchPageInvites.mockImplementationOnce(() => firstInvites.promise)

		renderDashboard()

		await waitFor(() => expect(fetchWorkspacePages).toHaveBeenCalledTimes(1))

		fetchWorkspacePages.mockImplementationOnce(() => secondOwned.promise)
		fetchSharedPages.mockImplementationOnce(() => secondShared.promise)
		fetchPageInvites.mockImplementationOnce(() => secondInvites.promise)

		act(() => {
			fireAuth('SIGNED_IN', { user: { id: 'user-1', email: 'author@example.com' } })
		})

		await waitFor(() => expect(fetchWorkspacePages).toHaveBeenCalledTimes(2))

		// Resolve the newer (refreshed) request first with two docs.
		await act(async () => {
			secondOwned.resolve([
				{ id: 'new-doc-1', title: 'Newer Doc', owner_id: 'user-1', updated_at: new Date().toISOString() },
				{ id: 'new-doc-2', title: 'Also Newer', owner_id: 'user-1', updated_at: new Date().toISOString() },
			])
			secondShared.resolve([])
			secondInvites.resolve([])
		})

		// Then resolve the stale original with a single older doc.
		await act(async () => {
			firstOwned.resolve([{ id: 'stale-doc', title: 'Stale Doc', owner_id: 'user-1', updated_at: new Date().toISOString() }])
			firstShared.resolve([])
			firstInvites.resolve([])
		})

		// The newer two-doc result must remain, not the stale single-doc one.
		await waitFor(() => expect(screen.getAllByText('Owned').length).toBe(2))
		expect(screen.queryByText(/stale doc/i)).not.toBeInTheDocument()
	})
})
