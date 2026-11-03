import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import OwnershipTransferCard from '@/components/billing/ownership-transfer-card'

vi.mock('@/lib/supabase', () => ({
	supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }) } },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

const fetchMock = vi.fn()

beforeEach(() => {
	fetchMock.mockReset()
	vi.stubGlobal('fetch', fetchMock)
	window.history.replaceState({}, '', '/settings')
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('OwnershipTransferCard (T13)', () => {
	it('offers only collaborator candidates and requires an explicit prepare step', async () => {
		render(
			<OwnershipTransferCard
				candidates={[
					{ id: 'u-2', email: 'maya@example.com', name: 'Maya' },
					{ id: 'u-2', email: 'maya@example.com', name: 'Maya' },
				]}
			/>,
		)

		const select = screen.getByLabelText('New owner') as HTMLSelectElement
		// Duplicate collaborator rows collapse to one candidate.
		expect(select.querySelectorAll('option')).toHaveLength(2)
		expect(screen.getByRole('button', { name: /Prepare transfer/i })).toBeDisabled()

		fireEvent.change(select, { target: { value: 'u-2' } })
		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				token: 'tok',
				acceptPath: '/settings?transfer=tok',
				expiresAt: '2026-11-01T00:00:00.000Z',
				outgoingSubscription: 'detaching',
			}),
		})
		fireEvent.click(screen.getByRole('button', { name: /Prepare transfer/i }))

		await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/billing/transfer', expect.objectContaining({ method: 'POST' })))
		expect(await screen.findByText(/Transfer prepared/i)).toBeInTheDocument()
		expect(screen.getByLabelText('Transfer accept link')).toHaveValue(
			`${window.location.origin}/settings?transfer=tok`,
		)
		expect(screen.getByText(/never deleted/i)).toBeInTheDocument()
	})

	it('shows the successor acceptance card when the invite link is opened', () => {
		window.history.replaceState({}, '', '/settings?transfer=signed-token')
		render(<OwnershipTransferCard candidates={[]} />)

		expect(screen.getByText(/Accept workspace ownership/i)).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /Accept ownership/i })).toBeInTheDocument()
	})

	it('explains that a transfer needs a collaborator when none exist', () => {
		render(<OwnershipTransferCard candidates={[]} />)
		expect(screen.getByText(/Invite someone to a page first/i)).toBeInTheDocument()
	})
})
