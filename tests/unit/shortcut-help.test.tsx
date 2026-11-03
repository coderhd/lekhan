import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import React from 'react'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

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

import GlobalSearchPalette from '@/components/global-search-palette'
import { SHORTCUT_GROUPS, BROWSER_RESERVED_NOTE } from '@/lib/shortcuts'

const flushSession = async () => { await act(async () => {}) }

const renderPalette = (children: React.ReactNode = null) => render(
	<GlobalSearchPalette>
		{children}
	</GlobalSearchPalette>
)

const pressQuestionMark = async () => {
	await act(async () => {
		document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true }))
	})
}

describe('shortcut help', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
		getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null })
		fetchRecentPages.mockResolvedValue([])
		searchPages.mockResolvedValue([])
		reauth.useSessionReauth.mockReturnValue({ isLocked: false, lockSession: vi.fn(), unlockSession: vi.fn() })
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('opens on ? from anywhere that is not a text field', async () => {
		renderPalette()
		await flushSession()
		await pressQuestionMark()
		expect(screen.getByRole('dialog', { name: /keyboard shortcuts/i })).toBeTruthy()
	})

	it('does not open on ? while typing in an input', async () => {
		renderPalette(<input aria-label="note" />)
		await flushSession()
		screen.getByLabelText('note').focus()
		await pressQuestionMark()
		expect(screen.queryByRole('dialog', { name: /keyboard shortcuts/i })).toBeNull()
	})

	it('does not open on ? while typing in the editor (contenteditable)', async () => {
		renderPalette(<div contentEditable suppressContentEditableWarning aria-label="editor" />)
		await flushSession()
		screen.getByLabelText('editor').focus()
		await pressQuestionMark()
		expect(screen.queryByRole('dialog', { name: /keyboard shortcuts/i })).toBeNull()
	})

	it('closes on Escape and restores focus', async () => {
		renderPalette()
		await flushSession()
		await pressQuestionMark()
		const dialog = screen.getByRole('dialog', { name: /keyboard shortcuts/i })
		expect(dialog.contains(document.activeElement)).toBe(true)
		await act(async () => {
			fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
		})
		expect(screen.queryByRole('dialog', { name: /keyboard shortcuts/i })).toBeNull()
	})

	it('opens from the palette footer hint and closes the palette', async () => {
		renderPalette()
		await flushSession()
		await act(async () => {
			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true }))
		})
		fireEvent.click(screen.getByRole('button', { name: /shortcuts/i }))
		expect(screen.queryByPlaceholderText(/search pages/i)).toBeNull()
		expect(screen.getByRole('dialog', { name: /keyboard shortcuts/i })).toBeTruthy()
	})

	it('renders the real shortcut inventory, not a hand-written list', async () => {
		renderPalette()
		await flushSession()
		await pressQuestionMark()
		const text = screen.getByRole('dialog', { name: /keyboard shortcuts/i }).textContent ?? ''
		for (const group of SHORTCUT_GROUPS) {
			for (const item of group.items) {
				expect(text).toContain(item.label)
			}
		}
		expect(text).toContain('K')
		expect(text).toContain(BROWSER_RESERVED_NOTE)
	})

	it('is a modal dialog that traps focus inside', async () => {
		renderPalette()
		await flushSession()
		await pressQuestionMark()
		const dialog = screen.getByRole('dialog', { name: /keyboard shortcuts/i })
		expect(dialog.getAttribute('aria-modal')).toBe('true')
		const focusable = dialog.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])')
		expect(focusable.length).toBeGreaterThan(0)
	})

	it('does not open while the session is locked', async () => {
		reauth.useSessionReauth.mockReturnValue({ isLocked: true, lockSession: vi.fn(), unlockSession: vi.fn() })
		renderPalette()
		await flushSession()
		await pressQuestionMark()
		expect(screen.queryByRole('dialog', { name: /keyboard shortcuts/i })).toBeNull()
	})
})
