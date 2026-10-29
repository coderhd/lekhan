import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, it, expect, vi } from 'vitest'
import PricingMatrix from '@/components/pricing-plans'
import React from 'react'

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/lib/supabase', () => ({
	supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}))

describe('PricingMatrix Landing Page & Collaborator Limits', () => {
	it('displays Get started for the Free plan CTA on the landing page', () => {
		render(<PricingMatrix isLandingPage={true} defaultCurrency="USD" />)
		expect(screen.getByRole('button', { name: /Get started/i })).toBeInTheDocument()
	})

	it('displays collaborator limits in feature lists', () => {
		render(<PricingMatrix defaultCurrency="USD" />)
		expect(screen.getByText(/2 collaborators per page/i)).toBeInTheDocument()
		expect(screen.getByText(/10 collaborators per page/i)).toBeInTheDocument()
		expect(screen.getByText(/25 collaborators per page/i)).toBeInTheDocument()
	})
})
