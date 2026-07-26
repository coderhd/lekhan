import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, it, expect } from 'vitest'
import PricingMatrix from '@/components/pricing-plans'
import React from 'react'

describe('Anthropic-Style PricingMatrix', () => {
	it('renders category switcher tabs and displays Individual plans by default', () => {
		render(<PricingMatrix />)
		expect(screen.getByRole('button', { name: /^Individual$/i })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /^Team and Enterprise$/i })).toBeInTheDocument()

		// Individual category cards
		expect(screen.getByText('Free')).toBeInTheDocument()
		expect(screen.getByText('Go')).toBeInTheDocument()
		expect(screen.getByText('Pro')).toBeInTheDocument()

		// Effective monthly prices billed annually
		expect(screen.getByText('₹83')).toBeInTheDocument()
		expect(screen.getByText('₹417')).toBeInTheDocument()
		expect(screen.getByText(/Everything in Free, plus:/i)).toBeInTheDocument()
		expect(screen.getByText(/Everything in Go, plus:/i)).toBeInTheDocument()
	})

	it('switches to Team and Enterprise category tab', () => {
		render(<PricingMatrix />)
		const teamTab = screen.getByRole('button', { name: /^Team and Enterprise$/i })
		fireEvent.click(teamTab)

		expect(screen.getByText('Team')).toBeInTheDocument()
		expect(screen.getByText('Enterprise')).toBeInTheDocument()
		expect(screen.getByText('2-150 users')).toBeInTheDocument()
		expect(screen.getByText('20+ users')).toBeInTheDocument()
		expect(screen.getByText(/Everything in Pro, plus:/i)).toBeInTheDocument()
		expect(screen.getByText(/All Team features, plus:/i)).toBeInTheDocument()
	})
})
