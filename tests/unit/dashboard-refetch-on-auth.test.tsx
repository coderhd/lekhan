import '@testing-library/jest-dom'
import React from 'react'
import { render, screen, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Dashboard from '@/components/dashboard'
import { GlobalHeaderProvider } from '@/components/layout/global-header-context'

let authCallback: ((event: string, session: any) => void) | null = null

const fetchOwned = vi.fn()
const fetchShared = vi.fn()
const fetchInvites = vi.fn()
const createDocument = vi.fn()

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/lib/supabase', () => ({
	supabase: {
		auth: {
			onAuthStateChange: vi.fn((cb: (event: string, session: any) => void) => {
				authCallback = cb
				return { data: { subscription: { unsubscribe: vi.fn() } } }
			}),
		},
	},
}))

vi.mock('@/services/db', () => ({
	fetchOwnedDocuments: (...args: any[]) => fetchOwned(...args),
	fetchSharedDocuments: (...args: any[]) => fetchShared(...args),
	fetchPendingInvitations: (...args: any[]) => fetchInvites(...args),
	createDocument: (...args: any[]) => createDocument(...args),
	deleteDocument: vi.fn(),
	updateDocumentTitle: vi.fn(),
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

function renderDashboard() {
	return render(
		<GlobalHeaderProvider>
			<Dashboard user={user} />
		</GlobalHeaderProvider>
	)
}

describe('Dashboard refetch on auth', () => {
	beforeEach(() => {
		authCallback = null
		fetchOwned.mockReset()
		fetchShared.mockReset()
		fetchInvites.mockReset()
		fetchOwned.mockResolvedValue([])
		fetchShared.mockResolvedValue([])
		fetchInvites.mockResolvedValue([])
	})

	it('refetches documents when a fresh session is established (SIGNED_IN)', async () => {
		renderDashboard()

		await waitFor(() => expect(fetchOwned).toHaveBeenCalledTimes(1))

		act(() => {
			authCallback?.('SIGNED_IN', { user: { id: 'user-1', email: 'author@example.com' } })
		})

		await waitFor(() => expect(fetchOwned).toHaveBeenCalledTimes(2))
	})

	it('does not refetch on unrelated auth events', async () => {
		renderDashboard()

		await waitFor(() => expect(fetchOwned).toHaveBeenCalledTimes(1))

		act(() => {
			authCallback?.('TOKEN_REFRESHED', { user: { id: 'user-1', email: 'author@example.com' } })
			authCallback?.('USER_UPDATED', { user: { id: 'user-1', email: 'author@example.com' } })
		})

		expect(fetchOwned).toHaveBeenCalledTimes(1)
	})

	it('shows a retryable error state instead of the empty state when fetching fails', async () => {
		fetchOwned.mockRejectedValueOnce(new Error('PGRST303'))

		renderDashboard()

		expect(await screen.findByText(/couldn't load your documents/i)).toBeInTheDocument()
		expect(screen.queryByText(/welcome to lekhan/i)).not.toBeInTheDocument()

		fetchOwned.mockResolvedValueOnce([{ id: 'doc-1', title: 'My Doc', owner_id: 'user-1', updated_at: new Date().toISOString() }])

		act(() => {
			screen.getByRole('button', { name: /try again/i }).click()
		})

		await waitFor(() => expect(fetchOwned).toHaveBeenCalledTimes(2))
		expect(screen.queryByText(/couldn't load your documents/i)).not.toBeInTheDocument()
	})

	it('replaces the error view with a loading state during a retry', async () => {
		fetchOwned.mockRejectedValueOnce(new Error('PGRST303'))

		renderDashboard()

		expect(await screen.findByText(/couldn't load your documents/i)).toBeInTheDocument()

		const ownedDeferred = deferred<any[]>()
		const sharedDeferred = deferred<any[]>()
		const invitesDeferred = deferred<any[]>()

		fetchOwned.mockImplementationOnce(() => ownedDeferred.promise)
		fetchShared.mockImplementationOnce(() => sharedDeferred.promise)
		fetchInvites.mockImplementationOnce(() => invitesDeferred.promise)

		act(() => {
			screen.getByRole('button', { name: /try again/i }).click()
		})

		expect(screen.queryByText(/couldn't load your documents/i)).not.toBeInTheDocument()
		expect(screen.getByText('Loading dashboard...')).toBeInTheDocument()

		await act(async () => {
			ownedDeferred.resolve([{ id: 'doc-1', title: 'My Doc', owner_id: 'user-1', updated_at: new Date().toISOString() }])
			sharedDeferred.resolve([])
			invitesDeferred.resolve([])
		})

		expect(screen.queryByText('Loading dashboard...')).not.toBeInTheDocument()
		expect(screen.queryByText(/couldn't load your documents/i)).not.toBeInTheDocument()
	})

	it('keeps the newer result when a refreshed request resolves before the original', async () => {
		const firstOwned = deferred<any[]>()
		const firstShared = deferred<any[]>()
		const firstInvites = deferred<any[]>()
		const secondOwned = deferred<any[]>()
		const secondShared = deferred<any[]>()
		const secondInvites = deferred<any[]>()

		fetchOwned.mockImplementationOnce(() => firstOwned.promise)
		fetchShared.mockImplementationOnce(() => firstShared.promise)
		fetchInvites.mockImplementationOnce(() => firstInvites.promise)

		renderDashboard()

		await waitFor(() => expect(fetchOwned).toHaveBeenCalledTimes(1))

		fetchOwned.mockImplementationOnce(() => secondOwned.promise)
		fetchShared.mockImplementationOnce(() => secondShared.promise)
		fetchInvites.mockImplementationOnce(() => secondInvites.promise)

		act(() => {
			authCallback?.('SIGNED_IN', { user: { id: 'user-1', email: 'author@example.com' } })
		})

		await waitFor(() => expect(fetchOwned).toHaveBeenCalledTimes(2))

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
