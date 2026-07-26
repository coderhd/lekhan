import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import BYOKSettings from '@/components/byok-settings'
import React from 'react'

vi.mock('sonner', () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}))

describe('BYOKSettings Component', () => {
	beforeEach(() => {
		localStorage.clear()
		vi.clearAllMocks()
	})

	it('renders Sarvam BYOK UI with Connect button disabled initially', () => {
		render(<BYOKSettings />)
		expect(screen.getByText(/Sarvam AI Key \(BYOK\)/i)).toBeInTheDocument()
		expect(screen.getByText(/AES-256-GCM Encrypted/i)).toBeInTheDocument()

		const connectBtn = screen.getByRole('button', { name: /Connect/i })
		expect(connectBtn).toBeDisabled()
	})

	it('enables Connect button when key starting with sk_ is entered', () => {
		render(<BYOKSettings />)
		const input = screen.getByPlaceholderText(/sk_sarvam.../i)
		fireEvent.change(input, { target: { value: 'sk_test_key_12345' } })

		const connectBtn = screen.getByRole('button', { name: /Connect/i })
		expect(connectBtn).not.toBeDisabled()
	})
})
