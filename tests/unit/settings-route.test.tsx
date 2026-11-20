import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import SettingsPage from '@/app/settings/page'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
	useRouter: () => ({ replace }),
	useSearchParams: () => new URLSearchParams(window.location.search),
}))
vi.mock('@/app/page', () => ({ default: () => <main>Workspace</main> }))
vi.mock('@/components/settings/settings-provider', () => ({
	SettingsDialog: ({ tab, onClose }: { tab: string; onClose: () => void }) =>
		<button onClick={onClose}>Close {tab}</button>,
}))

describe('Direct settings links', () => {
	it.each([
		['', 'profile'],
		['?billing=portal_return', 'billing'],
		['?billing=checkout_success', 'billing'],
		['?transfer=signed', 'collaborators'],
	])('opens the correct section for /settings%s', (query, tab) => {
		window.history.replaceState({}, '', '/settings' + query)
		render(<SettingsPage />)
		fireEvent.click(screen.getByRole('button', { name: 'Close ' + tab }))
		expect(replace).toHaveBeenCalledWith('/')
	})
})
