import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, it, expect, vi } from 'vitest'
import SettingsClient from '@/components/settings-client'
import { GlobalHeaderProvider } from '@/components/layout/global-header-context'
import React from 'react'

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push: vi.fn() }),
	usePathname: () => '/settings',
}))

vi.mock('@/lib/supabase', () => ({
	supabase: {
		auth: {
			getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }),
			getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null }),
			onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
		},
	},
}))

describe('Settings AI Usage Tab (T12 credits retirement)', () => {
	it('renders the tabs and shows the de-metered AI access panel', () => {
		render(
			<GlobalHeaderProvider>
				<SettingsClient user={{ email: 'test@example.com' }} token="mock" />
			</GlobalHeaderProvider>
		)
		const usageTab = screen.getByRole('tab', { name: /AI Usage/i })
		expect(usageTab).toBeInTheDocument()

		fireEvent.click(usageTab)
		expect(screen.getByText(/^AI access$/i)).toBeInTheDocument()
		expect(screen.getByText(/Lekhan never meters AI/i)).toBeInTheDocument()
		expect(screen.queryByText(/AI Credit Consumption/i)).not.toBeInTheDocument()
		expect(screen.queryByText(/Credits Remaining/i)).not.toBeInTheDocument()
	})
})
