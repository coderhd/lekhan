import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, it, expect, vi } from 'vitest'
import SettingsClient from '@/components/settings-client'
import { GlobalHeaderProvider } from '@/components/layout/global-header-context'

vi.mock('@/lib/supabase', () => ({
	supabase: {
		auth: {
			updateUser: vi.fn(),
			signOut: vi.fn(),
			getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }),
			getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null }),
			onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
		},
	},
}))

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push: vi.fn() }),
	usePathname: () => '/settings',
}))

describe('SettingsClient Tabbed Navigation', () => {
	const user = { email: 'test@example.com', full_name: 'Test User' }
	const documents: any[] = []

	it('renders tab buttons and switches between tabs', () => {
		render(
			<GlobalHeaderProvider>
				<SettingsClient user={user} token="mock" pages={documents} setPages={vi.fn()} />
			</GlobalHeaderProvider>
		)
		expect(screen.getByRole('tab', { name: /Profile & Security/i })).toBeInTheDocument()
		expect(screen.getByRole('tab', { name: /Collaborators & Access/i })).toBeInTheDocument()
		expect(screen.getByRole('tab', { name: /AI Usage/i })).toBeInTheDocument()
		expect(screen.getByRole('tab', { name: /Billing & Subscription/i })).toBeInTheDocument()

		fireEvent.click(screen.getByRole('tab', { name: /Billing & Subscription/i }))
		expect(screen.getByText(/Subscription & Plan/i)).toBeInTheDocument()
		const billing = screen.getByRole('tab', { name: /Billing & Subscription/i })
		billing.focus()
		fireEvent.keyDown(billing, { key: 'ArrowRight' })
		expect(screen.getByRole('tab', { name: /AI & Models/i })).toHaveFocus()
		expect(screen.getByRole('tab', { name: /AI & Models/i })).toHaveAttribute('tabindex', '0')
		expect(billing).toHaveAttribute('tabindex', '-1')
		expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'settings-tab-ai')
		expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
	})
})

vi.mock('@/components/global-search-palette', () => ({ useGlobalSearch: () => ({ open: vi.fn() }) }))
vi.mock('@/components/quick-capture-palette', () => ({ useQuickCapture: () => ({ open: vi.fn() }) }))
