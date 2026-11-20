import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, it, expect, vi } from 'vitest'
import SettingsPage from '@/app/settings/page'
import SettingsClient from '@/components/settings-client'
import type { SettingsTab } from '@/components/settings/settings-provider'

const replace = vi.fn()
const router = { replace }
vi.mock('next/navigation', () => ({
	useRouter: () => router,
	useSearchParams: () => new URLSearchParams(window.location.search),
}))
vi.mock('@/app/page', () => ({ default: () => <main>Workspace</main> }))
vi.mock('@/components/session-reauth-provider', () => ({ useSessionReauth: () => ({ isLocked: false }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }))
vi.mock('@/components/settings/settings-content', () => ({
	default: ({ initialTab }: { initialTab: SettingsTab }) =>
		<SettingsClient initialTab={initialTab} user={{ email: 'writer@example.test' }} />,
}))

describe('Direct settings links', () => {
	it.each([
		['', 'Profile & Security'],
		['?billing=portal_return', 'Billing & Subscription'],
		['?billing=checkout_success', 'Billing & Subscription'],
		['?transfer=signed', 'Collaborators & Access'],
	])('opens the correct section for /settings%s', async (query, tab) => {
		window.history.replaceState({}, '', '/settings' + query)
		render(<SettingsPage />)
		expect(await screen.findByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true')
		fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
		expect(replace).toHaveBeenCalledWith('/')
	})

	it('applies a changed query and reopens an invitation dismissed on an earlier token', async () => {
		window.history.replaceState({}, '', '/settings?billing=portal_return')
		const view = render(<SettingsPage />)
		expect(await screen.findByRole('tab', { name: 'Billing & Subscription' })).toHaveAttribute('aria-selected', 'true')
		window.history.replaceState({}, '', '/settings?transfer=first')
		view.rerender(<SettingsPage />)
		fireEvent.click(await screen.findByRole('button', { name: 'Not now' }))
		expect(screen.queryByRole('button', { name: 'Accept ownership' })).toBeNull()
		window.history.replaceState({}, '', '/settings?transfer=second')
		view.rerender(<SettingsPage />)
		expect(await screen.findByRole('button', { name: 'Accept ownership' })).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Accept ownership' }))
		await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
		fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
		await waitFor(() => expect(screen.getByRole('button', { name: 'Accept ownership' })).toHaveFocus())
	})
})
