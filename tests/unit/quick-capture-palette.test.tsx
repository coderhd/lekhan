import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import React from 'react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

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

const ensureWorkspace = vi.fn()
const fetchPageDetails = vi.fn()
const fetchPageMemberRole = vi.fn()
vi.mock('@/services/graph', () => ({
	ensureWorkspace: (...args: any[]) => ensureWorkspace(...args),
	fetchPageDetails: (...args: any[]) => fetchPageDetails(...args),
	fetchPageMemberRole: (...args: any[]) => fetchPageMemberRole(...args),
}))

const searchPages = vi.fn()
const fetchRecentPages = vi.fn()
vi.mock('@/services/search', () => ({
	searchPages: (...args: any[]) => searchPages(...args),
	fetchRecentPages: (...args: any[]) => fetchRecentPages(...args),
}))

const ensureDailyPage = vi.fn()
vi.mock('@/lib/daily-notes', () => ({
	ensureDailyPage: (...args: any[]) => ensureDailyPage(...args),
	dailyTitle: (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
}))

const appendCaptureBlock = vi.fn()
vi.mock('@/lib/quick-capture', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/quick-capture')>()
	return {
		...actual,
		appendCaptureBlock: (...args: any[]) => appendCaptureBlock(...args),
	}
})

import QuickCapturePalette, { useQuickCapture } from '@/components/quick-capture-palette'

const Trigger = () => {
	const { open } = useQuickCapture()
	return <button onClick={open}>Open capture</button>
}

const renderPalette = () => render(
	<QuickCapturePalette>
		<Trigger />
	</QuickCapturePalette>,
)

const flushSession = () => act(async () => {})

const openViaKey = async () => {
	await flushSession()
	await act(async () => {
		document.dispatchEvent(new KeyboardEvent('keydown', {
			key: 'c',
			metaKey: true,
			shiftKey: true,
			cancelable: true,
		}))
	})
}

const captureInput = () => screen.getByLabelText(/capture text/i)

describe('QuickCapturePalette', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
		getSession.mockResolvedValue({
			data: { session: { access_token: 'token-1', user: { id: 'user-1' } } },
			error: null,
		})
		reauth.useSessionReauth.mockReturnValue({ isLocked: false, lockSession: vi.fn(), unlockSession: vi.fn() })
		ensureWorkspace.mockResolvedValue({ id: 'ws-1', owner_id: 'user-1' })
		fetchPageDetails.mockResolvedValue({ id: 'page-9', owner_id: 'user-1' })
		fetchPageMemberRole.mockResolvedValue(null)
		ensureDailyPage.mockResolvedValue({ id: 'daily-1', title: '2026-11-02' })
		appendCaptureBlock.mockResolvedValue({ bulletText: '09:41 Buy milk #inbox' })
		searchPages.mockResolvedValue([
			{ id: 'page-9', title: 'Project Apollo', icon: null, workspace_id: 'ws-1', updated_at: '2026-11-02T00:00:00Z', surface: 'title', context: null },
		])
		fetchRecentPages.mockResolvedValue([])
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('opens with the global ⌘⇧C shortcut and traps focus in the labelled dialog', async () => {
		renderPalette()
		await openViaKey()

		const dialog = screen.getByRole('dialog', { name: /quick capture/i })
		expect(dialog).toBeTruthy()
		expect(screen.getByLabelText(/capture text/i)).toBeTruthy()
		expect(document.activeElement).toBe(captureInput())
		expect(screen.getByRole('button', { name: /^capture$/i })).toBeTruthy()
		expect(screen.getByRole('button', { name: /send to a page/i })).toBeTruthy()
	})

	it('does not open when signed out', async () => {
		getSession.mockResolvedValue({ data: { session: null }, error: null })
		renderPalette()
		await flushSession()
		await act(async () => {
			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, shiftKey: true, cancelable: true }))
		})
		expect(screen.queryByRole('dialog')).toBeNull()
	})

	it('does not open when the session is locked', async () => {
		reauth.useSessionReauth.mockReturnValue({ isLocked: true, lockSession: vi.fn(), unlockSession: vi.fn() })
		renderPalette()
		await flushSession()
		await act(async () => {
			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true, shiftKey: true, cancelable: true }))
		})
		expect(screen.queryByRole('dialog')).toBeNull()
	})

	it('captures into today\'s daily page and keeps #tag/[[link]] grammar verbatim', async () => {
		renderPalette()
		await openViaKey()

		fireEvent.change(captureInput(), { target: { value: 'Call [[Alice Chen]] about #launch' } })
		await act(async () => {
			fireEvent.keyDown(captureInput(), { key: 'Enter' })
		})

		expect(ensureDailyPage).toHaveBeenCalledWith({ id: 'ws-1', owner_id: 'user-1' }, expect.any(Date))
		expect(appendCaptureBlock).toHaveBeenCalledWith({
			pageId: 'daily-1',
			token: 'token-1',
			text: 'Call [[Alice Chen]] about #launch',
		})
		expect(toast.success).toHaveBeenCalledWith(
			expect.stringContaining('2026-11-02'),
			expect.objectContaining({ action: expect.objectContaining({ label: 'Open' }) }),
		)
		expect(screen.queryByRole('dialog')).toBeNull()
	})

	it('closes on Escape without capturing', async () => {
		renderPalette()
		await openViaKey()

		fireEvent.change(captureInput(), { target: { value: 'discard me' } })
		await act(async () => {
			fireEvent.keyDown(captureInput(), { key: 'Escape' })
		})

		expect(screen.queryByRole('dialog')).toBeNull()
		expect(appendCaptureBlock).not.toHaveBeenCalled()
	})

	it('does not submit an empty capture', async () => {
		renderPalette()
		await openViaKey()

		await act(async () => {
			fireEvent.keyDown(captureInput(), { key: 'Enter' })
		})

		expect(appendCaptureBlock).not.toHaveBeenCalled()
	})

	it('hands the capture to a chosen page through the page search', async () => {
		renderPalette()
		await openViaKey()

		fireEvent.change(captureInput(), { target: { value: 'Ship the captions' } })
		fireEvent.click(screen.getByRole('button', { name: /send to a page/i }))

		const pageSearch = screen.getByLabelText(/find a page/i)
		fireEvent.change(pageSearch, { target: { value: 'apollo' } })
		await act(async () => { await vi.advanceTimersByTimeAsync(210) })
		expect(searchPages).toHaveBeenCalledWith('apollo', expect.any(Number))

		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: /project apollo/i }))
		})

		await act(async () => {
			fireEvent.keyDown(captureInput(), { key: 'Enter' })
		})

		expect(ensureDailyPage).not.toHaveBeenCalled()
		expect(appendCaptureBlock).toHaveBeenCalledWith(expect.objectContaining({
			pageId: 'page-9',
			text: 'Ship the captions',
		}))
	})

	it('hides the Capture button while the page picker is open', async () => {
		renderPalette()
		await openViaKey()

		fireEvent.click(screen.getByRole('button', { name: /send to a page/i }))

		expect(screen.getByLabelText(/find a page/i)).toBeTruthy()
		expect(screen.queryByRole('button', { name: /^capture$/i })).toBeNull()
	})

	it('refuses to capture into a page the user can only view', async () => {
		fetchPageDetails.mockResolvedValue({ id: 'page-9', owner_id: 'someone-else' })
		fetchPageMemberRole.mockResolvedValue('viewer')
		renderPalette()
		await openViaKey()

		fireEvent.change(captureInput(), { target: { value: 'Should not land' } })
		fireEvent.click(screen.getByRole('button', { name: /send to a page/i }))
		fireEvent.change(screen.getByLabelText(/find a page/i), { target: { value: 'apollo' } })
		await act(async () => { await vi.advanceTimersByTimeAsync(210) })
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: /project apollo/i }))
		})
		await act(async () => {
			fireEvent.keyDown(captureInput(), { key: 'Enter' })
		})

		expect(fetchPageMemberRole).toHaveBeenCalledWith('page-9', 'user-1')
		expect(appendCaptureBlock).not.toHaveBeenCalled()
		expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/edit access/i))
		expect(screen.getByRole('dialog')).toBeTruthy()
	})

	it('surfaces a failure and keeps the palette open for a retry', async () => {
		appendCaptureBlock.mockRejectedValueOnce(new Error('socket closed'))
		renderPalette()
		await openViaKey()

		fireEvent.change(captureInput(), { target: { value: 'Buy milk' } })
		await act(async () => {
			fireEvent.keyDown(captureInput(), { key: 'Enter' })
		})

		expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/could not capture/i))
		expect(screen.getByRole('dialog')).toBeTruthy()
		expect((captureInput() as HTMLInputElement).value).toBe('Buy milk')
	})

	it('opens from the dashboard trigger button', async () => {
		renderPalette()
		await flushSession()
		fireEvent.click(screen.getByText('Open capture'))
		expect(screen.getByRole('dialog')).toBeTruthy()
	})

	it('warns rather than capturing when the session has no token', async () => {
		getSession.mockResolvedValue({ data: { session: null }, error: null })
		renderPalette()
		await openViaKey()
		expect(screen.queryByRole('dialog')).toBeNull()

		await act(async () => {
			fireEvent.click(screen.getByText('Open capture'))
		})
		expect(screen.queryByRole('dialog')).toBeNull()
	})
})
