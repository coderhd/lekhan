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
import { SHORTCUT_GROUPS, browserReservedNote } from '@/lib/shortcuts'

const flushSession = async () => { await act(async () => {}) }

const renderPalette = (children: React.ReactNode = null) => render(
	<GlobalSearchPalette>
		{children}
	</GlobalSearchPalette>
)

const pressQuestionMark = async (target: EventTarget = document) => {
	let event!: KeyboardEvent
	await act(async () => {
		event = new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true })
		target.dispatchEvent(event)
	})
	return event
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
		const input = screen.getByLabelText('note')
		input.focus()
		const event = await pressQuestionMark(input)
		expect(event.defaultPrevented).toBe(false)
		expect(document.activeElement).toBe(input)
		expect(screen.queryByRole('dialog', { name: /keyboard shortcuts/i })).toBeNull()
	})

	it('does not open on ? while typing in the editor (contenteditable)', async () => {
		renderPalette(<div contentEditable suppressContentEditableWarning aria-label="editor" />)
		await flushSession()
		const editor = screen.getByLabelText('editor')
		editor.focus()
		const event = await pressQuestionMark(editor)
		expect(event.defaultPrevented).toBe(false)
		expect(screen.queryByRole('dialog', { name: /keyboard shortcuts/i })).toBeNull()
	})

	it('does not open on ? when signed out', async () => {
		getSession.mockResolvedValue({ data: { session: null }, error: null })
		renderPalette()
		await flushSession()
		await pressQuestionMark()
		expect(screen.queryByRole('dialog', { name: /keyboard shortcuts/i })).toBeNull()
	})

	it('closes on Escape and restores focus to the opener', async () => {
		renderPalette(<button type="button">Before</button>)
		await flushSession()
		const before = screen.getByRole('button', { name: 'Before' })
		before.focus()
		await pressQuestionMark(before)
		const dialog = screen.getByRole('dialog', { name: /keyboard shortcuts/i })
		expect(dialog.contains(document.activeElement)).toBe(true)
		await act(async () => {
			fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
		})
		expect(screen.queryByRole('dialog', { name: /keyboard shortcuts/i })).toBeNull()
		expect(document.activeElement).toBe(before)
	})

	it('opens from the palette footer hint, closes the palette, and takes focus', async () => {
		renderPalette()
		await flushSession()
		await act(async () => {
			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true }))
		})
		fireEvent.click(screen.getByRole('button', { name: /shortcuts/i }))
		expect(screen.queryByPlaceholderText(/search pages/i)).toBeNull()
		const dialog = screen.getByRole('dialog', { name: /keyboard shortcuts/i })
		expect(dialog).toBeTruthy()
		expect(dialog.contains(document.activeElement)).toBe(true)
	})

	it('does not stack help on top of another open dialog', async () => {
		renderPalette(
			<div role="dialog" data-state="open" aria-label="other">
				<button type="button">Inside</button>
			</div>
		)
		await flushSession()
		await pressQuestionMark()
		expect(screen.queryByRole('dialog', { name: /keyboard shortcuts/i })).toBeNull()
	})

	it('swaps help for the palette on Cmd/Ctrl+K instead of stacking', async () => {
		renderPalette()
		await flushSession()
		await pressQuestionMark()
		expect(screen.getByRole('dialog', { name: /keyboard shortcuts/i })).toBeTruthy()

		await act(async () => {
			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true }))
		})

		expect(screen.queryByRole('dialog', { name: /keyboard shortcuts/i })).toBeNull()
		expect(screen.getByPlaceholderText(/search pages/i)).toBeTruthy()
		expect(screen.getAllByRole('dialog')).toHaveLength(1)
		expect(screen.getByRole('dialog', { name: /search pages/i }).contains(document.activeElement)).toBe(true)
	})

	it('does not open the palette over an unrelated dialog', async () => {
		renderPalette(
			<div role="dialog" data-state="open" aria-label="other">
				<button type="button">Inside</button>
			</div>
		)
		await flushSession()

		await act(async () => {
			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true }))
		})

		expect(screen.queryByPlaceholderText(/search pages/i)).toBeNull()
	})

	it('returns focus to the pre-palette element after opening help from the footer', async () => {
		renderPalette(<button type="button">Before</button>)
		await flushSession()
		const before = screen.getByRole('button', { name: 'Before' })
		before.focus()

		await act(async () => {
			document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true }))
		})
		expect(screen.getByPlaceholderText(/search pages/i)).toBeTruthy()

		fireEvent.click(screen.getByRole('button', { name: /shortcuts/i }))
		const dialog = screen.getByRole('dialog', { name: /keyboard shortcuts/i })
		expect(dialog.contains(document.activeElement)).toBe(true)

		await act(async () => {
			fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
		})

		expect(screen.queryByRole('dialog', { name: /keyboard shortcuts/i })).toBeNull()
		expect(document.activeElement).toBe(before)
	})

	it('renders the real shortcut inventory, not a hand-written list', async () => {
		renderPalette()
		await flushSession()
		await pressQuestionMark()
		const dialog = screen.getByRole('dialog', { name: /keyboard shortcuts/i })
		const text = dialog.textContent ?? ''
		for (const group of SHORTCUT_GROUPS) {
			for (const item of group.items) {
				expect(text).toContain(item.label)
			}
		}
		expect(text).toContain('K')
		expect(text).toContain(browserReservedNote('other'))
	})

	it('is a modal dialog that traps focus inside', async () => {
		renderPalette()
		await flushSession()
		await pressQuestionMark()
		const dialog = screen.getByRole('dialog', { name: /keyboard shortcuts/i })
		expect(dialog.getAttribute('aria-modal')).toBe('true')
		const focusable = dialog.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])')
		expect(focusable.length).toBeGreaterThan(0)
		const last = focusable[focusable.length - 1]
		last.focus()
		await act(async () => {
			fireEvent.keyDown(last, { key: 'Tab' })
		})
		expect(dialog.contains(document.activeElement)).toBe(true)
	})

	it('does not open while the session is locked', async () => {
		reauth.useSessionReauth.mockReturnValue({ isLocked: true, lockSession: vi.fn(), unlockSession: vi.fn() })
		renderPalette()
		await flushSession()
		await pressQuestionMark()
		expect(screen.queryByRole('dialog', { name: /keyboard shortcuts/i })).toBeNull()
	})
})
