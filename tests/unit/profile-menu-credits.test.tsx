import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, it, expect, vi } from 'vitest'
import ProfileMenu from '@/components/profile-menu'
import React from 'react'

vi.mock('@/lib/supabase', () => ({
	supabase: {
		auth: {
			signOut: vi.fn().mockResolvedValue({ error: null }),
		},
		from: vi.fn(() => {
			throw new Error('no entitlement in this test')
		}),
	},
}))

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push: vi.fn() }),
}))

describe('ProfileMenu plan badge (T12)', () => {
	it('shows the plan badge, not a credit counter', () => {
		render(<ProfileMenu user={{ email: 'user@example.com', full_name: 'Test User' }} />)
		const avatarBtn = screen.getByRole('button', { name: /Account menu/ })
		fireEvent.click(avatarBtn)

		expect(screen.getByText('Plan')).toBeInTheDocument()
		expect(screen.getByText('free')).toBeInTheDocument()
		expect(screen.queryByText(/credits/i)).not.toBeInTheDocument()
	})
})
