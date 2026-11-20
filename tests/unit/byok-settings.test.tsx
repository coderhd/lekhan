import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import BYOKSettings from '@/components/byok-settings'
import React from 'react'
import * as crypto from '@/lib/crypto'

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
	it('revalidates a saved key without requiring an edit', async () => {
		const load = vi.spyOn(crypto, 'getDecryptedApiKey').mockResolvedValue('sk_saved_key_123')
		const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
		try {
			render(<BYOKSettings />)
			const test = await screen.findByRole('button', { name: 'Test saved key' })
			fireEvent.click(test)
			expect(request).toHaveBeenCalledWith('/api/ai', expect.objectContaining({
				body: JSON.stringify({ action: 'validate-key', key: 'sk_saved_key_123' }),
			}))
			expect(await screen.findByRole('button', { name: 'Test saved key' })).toBeEnabled()
			expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled()
		} finally {
			load.mockRestore()
			request.mockRestore()
		}
	})

})
