import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, it, expect, vi } from 'vitest'
import PricingMatrix from '@/components/pricing-plans'
import React from 'react'

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push: vi.fn() }),
}))

describe('PricingMatrix Landing Page & Collaborator Limits', () => {
	it('displays Get started for Free plan CTA on landing page', () => {
		render(<PricingMatrix isLandingPage={true} />)
		const freeCta = screen.getByRole('button', { name: /Get started/i })
		expect(freeCta).toBeInTheDocument()
	})

	it('displays collaborator limits in feature lists', () => {
		render(<PricingMatrix />)
		expect(screen.getByText(/2 Collaborators max \/ document/i)).toBeInTheDocument()
		expect(screen.getByText(/10 Collaborators max \/ document/i)).toBeInTheDocument()
		expect(screen.getByText(/25 Collaborators max \/ document/i)).toBeInTheDocument()
	})
})
