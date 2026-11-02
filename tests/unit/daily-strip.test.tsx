import '@testing-library/jest-dom'
import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
import DailyStrip from '@/components/daily-strip'
import * as dailyNotes from '@/lib/daily-notes'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const ensureDailyPage = vi.fn()
const fetchDailyPages = vi.fn()

vi.mock('@/lib/daily-notes', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/daily-notes')>()
	return {
		...actual,
		ensureDailyPage: (...args: any[]) => ensureDailyPage(...args),
		fetchDailyPages: (...args: any[]) => fetchDailyPages(...args),
	}
})

const TODAY = new Date(2026, 10, 2) // Monday, 2026-11-02
const baseProps = {
	workspaceId: 'ws-1',
	ownerId: 'user-1',
	today: TODAY,
}

const renderStrip = (props: Partial<React.ComponentProps<typeof DailyStrip>> = {}) =>
	render(<DailyStrip {...baseProps} {...props} />)

const affordance = () => screen.getByRole('button', { name: /daily page for/i })

describe('DailyStrip', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		fetchDailyPages.mockResolvedValue(new Map())
		ensureDailyPage.mockResolvedValue({ id: 'page-new', title: '2026-11-02' })
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('shows today and loads dots for the visible week', async () => {
		renderStrip()

		await waitFor(() => expect(fetchDailyPages).toHaveBeenCalledTimes(1))

		const [workspaceId, days] = fetchDailyPages.mock.calls[0]
		expect(workspaceId).toBe('ws-1')
		expect(days).toHaveLength(7)
		expect(days.map((d: Date) => dailyNotes.dailyTitle(d))).toContain('2026-11-02')
		expect(screen.getByText(/today/i)).toBeInTheDocument()
	})

	it('renders a dot for every day that already has a daily page', async () => {
		const pages = new Map([
			['2026-11-01', { id: 'p-1', title: '2026-11-01' }],
			['2026-11-02', { id: 'p-2', title: '2026-11-02' }],
		])
		fetchDailyPages.mockResolvedValue(pages)

		renderStrip()

		await waitFor(() => expect(screen.getAllByTestId('daily-dot')).toHaveLength(2))

		// The dot is not colour-only: the day button's name announces the page.
		expect(screen.getByRole('button', { name: /november 2, 2026, daily page exists/i })).toBeInTheDocument()
	})

	it('moves the selected day forward and backward with labeled buttons', async () => {
		fetchDailyPages.mockResolvedValue(new Map())
		renderStrip()

		await waitFor(() => expect(fetchDailyPages).toHaveBeenCalledTimes(1))

		expect(affordance()).toHaveAttribute('aria-label', expect.stringContaining('November 2, 2026'))

		fireEvent.click(screen.getByRole('button', { name: /next day/i }))
		await waitFor(() =>
			expect(affordance()).toHaveAttribute('aria-label', expect.stringContaining('November 3, 2026'))
		)

		fireEvent.click(screen.getByRole('button', { name: /previous day/i }))
		await waitFor(() =>
			expect(affordance()).toHaveAttribute('aria-label', expect.stringContaining('November 2, 2026'))
		)
	})

	it('reloads dots for the shifted window after day navigation', async () => {
		fetchDailyPages.mockResolvedValue(new Map())
		renderStrip()

		await waitFor(() => expect(fetchDailyPages).toHaveBeenCalledTimes(1))

		fireEvent.click(screen.getByRole('button', { name: /next day/i }))

		await waitFor(() => expect(fetchDailyPages).toHaveBeenCalledTimes(2))
		const nextDays: Date[] = fetchDailyPages.mock.calls[1][1]
		expect(nextDays.map(d => dailyNotes.dailyTitle(d))).toContain('2026-11-06')
	})

	it('creates the missing daily page then redirects to it', async () => {
		fetchDailyPages.mockResolvedValue(new Map())
		renderStrip()

		await waitFor(() => expect(fetchDailyPages).toHaveBeenCalledTimes(1))

		fireEvent.click(screen.getByRole('button', { name: /create daily page for/i }))

		await waitFor(() => expect(push).toHaveBeenCalledWith('/page/page-new'))
		expect(ensureDailyPage).toHaveBeenCalledWith(
			{ id: 'ws-1', owner_id: 'user-1' },
			TODAY
		)
	})

	it('opens the existing daily page without creating one', async () => {
		fetchDailyPages.mockResolvedValue(
			new Map([['2026-11-02', { id: 'page-existing', title: '2026-11-02' }]])
		)
		renderStrip()

		await waitFor(() => expect(screen.getByRole('button', { name: /open daily page for/i })).toBeInTheDocument())
		fireEvent.click(screen.getByRole('button', { name: /open daily page for/i }))

		expect(push).toHaveBeenCalledWith('/page/page-existing')
		expect(ensureDailyPage).not.toHaveBeenCalled()
	})

	it('opens or creates a specific day picked from the week strip', async () => {
		fetchDailyPages.mockResolvedValue(new Map())
		renderStrip()

		await waitFor(() => expect(fetchDailyPages).toHaveBeenCalledTimes(1))

		fireEvent.click(screen.getByRole('button', { name: /october 31, 2026/i }))

		await waitFor(() => expect(push).toHaveBeenCalledWith('/page/page-new'))
		expect(dailyNotes.dailyTitle(ensureDailyPage.mock.calls[0][1])).toBe('2026-10-31')
	})

	it('recovers from a network failure with a retry that succeeds', async () => {
		fetchDailyPages.mockResolvedValue(new Map())
		ensureDailyPage.mockRejectedValueOnce(new Error('network down'))
		vi.spyOn(console, 'error').mockImplementation(() => {})

		renderStrip()

		await waitFor(() => expect(fetchDailyPages).toHaveBeenCalledTimes(1))

		fireEvent.click(screen.getByRole('button', { name: /create daily page for/i }))

		expect(await screen.findByRole('alert')).toHaveTextContent(/could not/i)
		expect(toast.error).toHaveBeenCalled()
		expect(push).not.toHaveBeenCalled()

		fireEvent.click(screen.getByRole('button', { name: /retry/i }))

		await waitFor(() => expect(push).toHaveBeenCalledWith('/page/page-new'))
		expect(screen.queryByRole('alert')).not.toBeInTheDocument()
	})

	it('dismisses the failure alert when the selected day changes', async () => {
		fetchDailyPages.mockResolvedValue(new Map())
		ensureDailyPage.mockRejectedValueOnce(new Error('network down'))
		vi.spyOn(console, 'error').mockImplementation(() => {})

		renderStrip()

		await waitFor(() => expect(fetchDailyPages).toHaveBeenCalledTimes(1))

		fireEvent.click(screen.getByRole('button', { name: /create daily page for/i }))
		expect(await screen.findByRole('alert')).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: /next day/i }))
		await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
	})

	it('keeps every control a native keyboard-reachable button', async () => {
		fetchDailyPages.mockResolvedValue(new Map())
		renderStrip()

		await waitFor(() => expect(fetchDailyPages).toHaveBeenCalledTimes(1))

		for (const name of [/previous day/i, /next day/i, /daily page for/i]) {
			const button = screen.getByRole('button', { name })
			expect(button.tagName).toBe('BUTTON')
			expect(button).not.toHaveAttribute('tabindex', '-1')
		}
		expect(screen.getByRole('navigation', { name: /daily notes/i })).toBeInTheDocument()
	})

	it('does not load or create anything before the workspace is known', async () => {
		renderStrip({ workspaceId: null })

		expect(fetchDailyPages).not.toHaveBeenCalled()
		fireEvent.click(screen.getByRole('button', { name: /create daily page for/i }))

		expect(ensureDailyPage).not.toHaveBeenCalled()
		expect(push).not.toHaveBeenCalled()
	})
})
