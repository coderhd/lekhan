import { describe, it, expect } from 'vitest'
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import PublicAccessDenied from '../../components/public-access-denied'

describe('PublicAccessDenied', () => {
	it('shows the locked-out copy and login/signup actions for a signed-out visitor', () => {
		render(<PublicAccessDenied variant="public" />)
		expect(screen.getByText(/This page isn't available/i)).toBeInTheDocument()
		expect(
			screen.getByText(/link may be wrong, or the owner hasn't shared this page publicly/i)
		).toBeInTheDocument()
		expect(screen.getByRole('link', { name: /log in/i })).toHaveAttribute('href', '/login')
		expect(screen.getByRole('link', { name: /create your workspace/i })).toHaveAttribute('href', '/signup')
	})

	it('offers a back-home action for a signed-in user who lacks access', () => {
		render(<PublicAccessDenied variant="internal" />)
		expect(screen.getByRole('link', { name: /back home/i })).toHaveAttribute('href', '/')
	})
})
