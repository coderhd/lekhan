import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, it, expect, vi } from 'vitest'
import PricingMatrix from '@/components/pricing-plans'
import React from 'react'

describe('PricingMatrix', () => {
	it('renders 5 INR pricing tiers', () => {
		render(<PricingMatrix />)
		expect(screen.getByText('Free')).toBeInTheDocument()
		expect(screen.getByText('Go')).toBeInTheDocument()
		expect(screen.getByText('Pro')).toBeInTheDocument()
		expect(screen.getByText('Team')).toBeInTheDocument()
		expect(screen.getByText('Enterprise')).toBeInTheDocument()
		expect(screen.getByText('₹99')).toBeInTheDocument()
		expect(screen.getAllByText('₹499')[0]).toBeInTheDocument()
	})

	it('toggles billing cycle between monthly and yearly', () => {
		render(<PricingMatrix />)
		const toggleBtn = screen.getByRole('button', { name: /Toggle Yearly Billing/i })
		fireEvent.click(toggleBtn)
		expect(screen.getByText(/Save 20%/i)).toBeInTheDocument()
	})
})
