import '@testing-library/jest-dom'
import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import BacklinkPane, { BacklinkList, type BacklinkRow } from '@/components/backlink-pane'
import { fetchPageBacklinks } from '@/services/graph'

const router = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

vi.mock('@/services/graph', () => ({ fetchPageBacklinks: vi.fn() }))

const backlinks = fetchPageBacklinks as unknown as ReturnType<typeof vi.fn>

const row = (fromPageId: string, fromTitle: string): { from_page_id: string; from_title: string } => ({
	from_page_id: fromPageId,
	from_title: fromTitle,
})

describe('BacklinkPane', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		cleanup()
	})

	it('reads the existing fetchPageBacklinks query for the page (no new query)', async () => {
		backlinks.mockResolvedValue([])
		render(<BacklinkPane pageId="p-42" onClose={vi.fn()} />)

		await waitFor(() => expect(backlinks).toHaveBeenCalledWith('p-42'))
	})

	it('shows a labelled loading skeleton while the backlinks are in flight', () => {
		backlinks.mockReturnValue(new Promise(() => {}))
		render(<BacklinkPane pageId="p-42" onClose={vi.fn()} />)

		expect(screen.getByRole('status', { name: /loading backlinks/i })).toBeInTheDocument()
	})

	it('shows the empty state when the page has no backlinks yet', async () => {
		backlinks.mockResolvedValue([])
		render(<BacklinkPane pageId="p-42" onClose={vi.fn()} />)

		expect(await screen.findByText('No backlinks yet')).toBeInTheDocument()
	})

	it('renders resolved rows with the linking page title and routes on click-through', async () => {
		backlinks.mockResolvedValue([row('p-1', 'Alpha'), row('p-2', 'Beta')])
		render(<BacklinkPane pageId="p-42" onClose={vi.fn()} />)

		const alpha = await screen.findByRole('button', { name: /\bAlpha\b/ })
		expect(screen.getByRole('button', { name: /\bBeta\b/ })).toBeInTheDocument()

		fireEvent.click(alpha)
		expect(router.push).toHaveBeenCalledWith('/page/p-1')
	})

	it('renders unresolved rows as non-interactive, title-only rows', async () => {
		backlinks.mockResolvedValue([row('', 'Ghost note')])
		render(<BacklinkPane pageId="p-42" onClose={vi.fn()} />)

		const title = await screen.findByText('Ghost note')
		expect(screen.queryByRole('button', { name: /Ghost note/ })).not.toBeInTheDocument()
		expect(title.closest('[aria-disabled="true"]')).not.toBeNull()

		fireEvent.click(title)
		expect(router.push).not.toHaveBeenCalled()
	})

	it('renders a <=120-char context line when linking-page bodies are available', async () => {
		backlinks.mockResolvedValue([row('p-1', 'Alpha')])
		const body = `${'prefix '.repeat(30)}[[Alpha]]${' suffix'.repeat(30)}`
		render(<BacklinkPane pageId="p-42" onClose={vi.fn()} bodyByPage={{ 'p-1': body }} />)

		const context = await screen.findByText(/\[\[Alpha\]\]/)
		expect(context.textContent!.length).toBeLessThanOrEqual(120)
	})

	it('exposes a labelled close button that calls onClose', () => {
		backlinks.mockReturnValue(new Promise(() => {}))
		const onClose = vi.fn()
		render(<BacklinkPane pageId="p-42" onClose={onClose} />)

		fireEvent.click(screen.getByRole('button', { name: /close backlinks/i }))
		expect(onClose).toHaveBeenCalledTimes(1)
	})

	it('traps focus inside the drawer and closes on Escape', async () => {
		backlinks.mockResolvedValue([row('p-1', 'Alpha'), row('p-2', 'Beta')])
		const onClose = vi.fn()
		render(<BacklinkPane pageId="p-42" onClose={onClose} />)

		const dialog = screen.getByRole('dialog', { name: 'Backlinks' })
		const close = screen.getByRole('button', { name: /close backlinks/i })
		await screen.findByRole('button', { name: /\bBeta\b/ })

		await waitFor(() => expect(close).toHaveFocus())

		// Shift+Tab from the first focusable wraps to the last row.
		fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
		expect(screen.getByRole('button', { name: /\bBeta\b/ })).toHaveFocus()

		// Tab from the last focusable wraps back to the close button.
		fireEvent.keyDown(dialog, { key: 'Tab' })
		expect(close).toHaveFocus()

		fireEvent.keyDown(dialog, { key: 'Escape' })
		expect(onClose).toHaveBeenCalledTimes(1)
	})
})

describe('BacklinkList', () => {
	it('renders the one-line context under a resolved row when body context is available', () => {
		const rows: BacklinkRow[] = [
			{ pageId: 'p-1', title: 'Alpha', context: '…a note that links to [[Target]] in passing…' },
		]
		const onNavigate = vi.fn()
		render(<BacklinkList rows={rows} onNavigate={onNavigate} />)

		expect(screen.getByText('Alpha')).toBeInTheDocument()
		expect(screen.getByText(/a note that links to \[\[Target\]\] in passing/)).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: /Alpha/ }))
		expect(onNavigate).toHaveBeenCalledWith('p-1')
	})

	it('omits the context line for title-only rows', () => {
		const rows: BacklinkRow[] = [{ pageId: 'p-1', title: 'Alpha' }]
		render(<BacklinkList rows={rows} onNavigate={vi.fn()} />)

		expect(screen.getByText('Alpha')).toBeInTheDocument()
		expect(screen.getByRole('listitem').querySelectorAll('p')).toHaveLength(0)
	})
})
