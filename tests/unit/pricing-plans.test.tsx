import { render, screen, fireEvent } from '@testing-library/react'
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

describe('PricingMatrix (T12 rebuild)', () => {
	it('renders the Plus / Pro / Free cards — the retired Go tier is gone', () => {
		render(<PricingMatrix defaultCurrency="USD" />)
		expect(screen.getByRole('button', { name: /^Individual$/i })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /^Team and Enterprise$/i })).toBeInTheDocument()

		expect(screen.getByRole('heading', { name: 'Free' })).toBeInTheDocument()
		expect(screen.getByRole('heading', { name: 'Plus' })).toBeInTheDocument()
		expect(screen.getByRole('heading', { name: 'Pro' })).toBeInTheDocument()
		expect(screen.queryByText('Go')).not.toBeInTheDocument()

		// GA annual effective monthly prices (catalogue is the single source).
		expect(screen.getByText('$5')).toBeInTheDocument()
		expect(screen.getByText('$10')).toBeInTheDocument()
		expect(screen.getByText(/Everything in Free, plus:/i)).toBeInTheDocument()
		expect(screen.getByText(/Everything in Plus, plus:/i)).toBeInTheDocument()
	})

	it('never shows a credit allowance on any plan card', () => {
		render(<PricingMatrix defaultCurrency="USD" />)
		expect(screen.queryByText(/credits?/i)).not.toBeInTheDocument()
	})

	it('switches to the Team and Enterprise category and picks seats', () => {
		render(<PricingMatrix defaultCurrency="USD" />)
		fireEvent.click(screen.getByRole('button', { name: /^Team and Enterprise$/i }))

		expect(screen.getByText('Team')).toBeInTheDocument()
		expect(screen.getByText('Enterprise')).toBeInTheDocument()
		expect(screen.getByText('2–25 seats')).toBeInTheDocument()
		expect(screen.getByText('25+ seats')).toBeInTheDocument()
		expect(screen.getByText(/Everything in Pro, plus:/i)).toBeInTheDocument()
		expect(screen.getByText(/All Team features, plus:/i)).toBeInTheDocument()

		const seats = screen.getByLabelText('Seats') as HTMLSelectElement
		expect(seats.value).toBe('2')
		fireEvent.change(seats, { target: { value: '5' } })
		expect(seats.value).toBe('5')
	})

	it('shows the founding badge and founding prices when the workspace is founding', () => {
		render(<PricingMatrix isFounding defaultCurrency="USD" />)
		expect(screen.getAllByText('Founding price').length).toBeGreaterThan(0)
		expect(screen.getByText('$3.33')).toBeInTheDocument()
	})

	it('offers an explicit currency escape hatch instead of silently switching Team to INR', () => {
		render(<PricingMatrix defaultCurrency="USD" />)
		fireEvent.click(screen.getByRole('button', { name: /₹ INR/i }))
		fireEvent.click(screen.getByRole('button', { name: /^Team and Enterprise$/i }))

		expect(screen.getByText('USD only')).toBeInTheDocument()
		const escape = screen.getByRole('button', { name: /Pay internationally in USD/i })
		expect(escape).toBeInTheDocument()

		fireEvent.click(escape)
		expect(screen.queryByText('USD only')).not.toBeInTheDocument()
	})

	it('prices Team per seat and keeps the seat total consistent', () => {
		render(<PricingMatrix defaultCurrency="USD" />)
		fireEvent.click(screen.getByRole('button', { name: /^Team and Enterprise$/i }))

		// GA annual effective monthly per seat: $100/seat/yr → $8.33/mo.
		expect(screen.getByText('$8.33')).toBeInTheDocument()
		expect(screen.getByText(/billed annually at \$200\/yr for 2 seats/i)).toBeInTheDocument()

		const seats = screen.getByLabelText('Seats') as HTMLSelectElement
		fireEvent.change(seats, { target: { value: '5' } })
		expect(screen.getByText(/billed annually at \$500\/yr for 5 seats/i)).toBeInTheDocument()
	})

	it('uses buttons (not divs) for every money CTA', () => {
		render(<PricingMatrix isLandingPage defaultCurrency="USD" />)
		const ctas = screen.getAllByRole('button').filter((el) => /Get .*plan|Get started|Contact Sales/i.test(el.textContent ?? ''))
		expect(ctas.length).toBeGreaterThan(0)
		for (const cta of ctas) {
			expect(cta.tagName).toBe('BUTTON')
			expect(cta).toHaveAttribute('type', 'button')
		}
	})
})
