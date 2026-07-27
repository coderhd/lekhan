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
				<SettingsClient user={user} token="mock" documents={documents} setDocuments={vi.fn()} />
			</GlobalHeaderProvider>
		)
		expect(screen.getByRole('button', { name: /Profile & Security/i })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /Collaborators & Access/i })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /Usage & Credits/i })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /Billing & Subscription/i })).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: /Billing & Subscription/i }))
		expect(screen.getByText(/Subscription & Plan/i)).toBeInTheDocument()
	})
})
