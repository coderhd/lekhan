import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, it, expect, vi } from 'vitest'
import SettingsClient from '@/components/settings-client'
import { GlobalHeaderProvider } from '@/components/layout/global-header-context'
import React from 'react'

vi.mock('@/lib/supabase', () => ({
	supabase: {
		auth: { updateUser: vi.fn(), signOut: vi.fn() }
	}
}))

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push: vi.fn() }),
}))

describe('SettingsClient Tabbed Navigation', () => {
	const user = { id: 'u1', email: 'test@example.com', full_name: 'Test User' }
	const documents: any[] = []

	it('renders tab buttons and switches between tabs', () => {
		render(
			<GlobalHeaderProvider>
				<SettingsClient user={user} documents={documents} setDocuments={vi.fn()} />
			</GlobalHeaderProvider>
		)
		expect(screen.getByRole('button', { name: /Profile & Security/i })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /Collaborators & Access/i })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /Billing & Subscription/i })).toBeInTheDocument()

		fireEvent.click(screen.getByRole('button', { name: /Billing & Subscription/i }))
		expect(screen.getByText(/Subscription & Billing Plans/i)).toBeInTheDocument()
	})
})
