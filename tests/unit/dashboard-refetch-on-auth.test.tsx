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
})
