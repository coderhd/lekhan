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

describe('Settings Usage & Credits Tab', () => {
	it('renders 4 tabs and switches to Usage & Credits tab', () => {
		render(
			<GlobalHeaderProvider>
				<SettingsClient user={{ email: 'test@example.com' }} token="mock" />
			</GlobalHeaderProvider>
		)
		const usageTab = screen.getByRole('tab', { name: /Usage & Credits/i })
		expect(usageTab).toBeInTheDocument()

		fireEvent.click(usageTab)
		expect(screen.getByText(/^AI Credit Consumption$/i)).toBeInTheDocument()
		expect(screen.getByText(/Sarvam AI Credit Consumption Rates/i)).toBeInTheDocument()
	})
})
