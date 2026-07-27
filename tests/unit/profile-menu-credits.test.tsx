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
	},
}))

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push: vi.fn() }),
}))

describe('ProfileMenu Credit Badge', () => {
	it('displays AI Credits status pill when dropdown is opened', () => {
		render(<ProfileMenu user={{ email: 'user@example.com', full_name: 'Test User' }} />)
		const avatarBtn = screen.getByRole('button', { name: /TU/i })
		fireEvent.click(avatarBtn)

		expect(screen.getByText(/AI Credits/i)).toBeInTheDocument()
		expect(screen.getByText(/50 Left/i)).toBeInTheDocument()
	})
})
