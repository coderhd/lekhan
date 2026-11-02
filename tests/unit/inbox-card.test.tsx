import '@testing-library/jest-dom'
import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InboxCard from '@/components/inbox-card'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }))

const fetchInboxItems = vi.fn()
const ensureDailyPage = vi.fn()

vi.mock('@/lib/inbox', () => ({
	fetchInboxItems: (...args: any[]) => fetchInboxItems(...args),
}))

vi.mock('@/lib/daily-notes', () => ({
	ensureDailyPage: (...args: any[]) => ensureDailyPage(...args),
	dailyTitle: () => '2026-11-02',
}))

const TODAY = new Date(2026, 10, 2) // 2026-11-02

const item = (index: number) => ({
	pageId: 'today',
	pageTitle: '2026-11-02',
	text: `0${index}:00 Capture ${index} #inbox`,
})

const renderCard = (props: Partial<React.ComponentProps<typeof InboxCard>> = {}) =>
	render(
		<InboxCard
			workspaceId="ws-1"
			ownerId="user-1"
			today={TODAY}
			{...props}
		/>,
	)

describe('InboxCard', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		fetchInboxItems.mockResolvedValue([])
		ensureDailyPage.mockResolvedValue({ id: 'page-today', title: '2026-11-02' })
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it('shows the pending count and only the five newest items', async () => {
		fetchInboxItems.mockResolvedValue(Array.from({ length: 7 }, (_, i) => item(i)))

		renderCard()

		await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument())
		expect(screen.getByText(/Capture 0 #inbox/)).toBeInTheDocument()
		expect(screen.getByText(/Capture 4 #inbox/)).toBeInTheDocument()
		expect(screen.queryByText(/Capture 5 #inbox/)).not.toBeInTheDocument()
		expect(screen.getByText(/2 more pending/i)).toBeInTheDocument()
		expect(fetchInboxItems).toHaveBeenCalledWith('ws-1', { now: TODAY })
	})

	it('renders the empty state when nothing is pending', async () => {
		renderCard()

		expect(await screen.findByText(/inbox zero/i)).toBeInTheDocument()
		expect(screen.getByText(/captures land here/i)).toBeInTheDocument()
		expect(screen.getByText('0')).toBeInTheDocument()
	})

	it('shows a loading state while the first fetch is in flight', async () => {
		fetchInboxItems.mockReturnValue(new Promise(() => {}))

		renderCard()

		expect(await screen.findByRole('status')).toHaveTextContent(/loading inbox/i)
	})

	it('shows an error with a retry that recovers', async () => {
		fetchInboxItems.mockRejectedValueOnce(new Error('network down'))
		fetchInboxItems.mockResolvedValueOnce([item(0)])

		renderCard()

		expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load your inbox/i)

		fireEvent.click(screen.getByRole('button', { name: /try again/i }))

		await waitFor(() => expect(screen.getByText(/Capture 0 #inbox/)).toBeInTheDocument())
		expect(fetchInboxItems).toHaveBeenCalledTimes(2)
	})

	it('refetches when the capture palette reports a new capture', async () => {
		fetchInboxItems.mockResolvedValueOnce([])
		fetchInboxItems.mockResolvedValueOnce([item(0)])

		renderCard()

		expect(await screen.findByText(/inbox zero/i)).toBeInTheDocument()

		act(() => {
			window.dispatchEvent(new Event('lekhan:inbox-changed'))
		})

		await waitFor(() => expect(fetchInboxItems).toHaveBeenCalledTimes(2))
		expect(await screen.findByText(/Capture 0 #inbox/)).toBeInTheDocument()
	})

	it('opens today\'s daily page scrolled to the Inbox section', async () => {
		fetchInboxItems.mockResolvedValue([item(0)])

		renderCard()

		const open = await screen.findByRole('button', { name: /open today's inbox/i })
		fireEvent.click(open)

		await waitFor(() => expect(ensureDailyPage).toHaveBeenCalledWith(
			{ id: 'ws-1', owner_id: 'user-1' },
			TODAY,
		))
		expect(push).toHaveBeenCalledWith('/page/page-today?section=inbox')
	})

	it('surfaces an error when opening the daily page fails and lets the user retry', async () => {
		fetchInboxItems.mockResolvedValue([item(0)])
		ensureDailyPage.mockRejectedValueOnce(new Error('offline'))

		renderCard()

		fireEvent.click(await screen.findByRole('button', { name: /open today's inbox/i }))

		expect(await screen.findByText(/could not open today's daily page/i)).toBeInTheDocument()
		expect(push).not.toHaveBeenCalled()
	})
})
