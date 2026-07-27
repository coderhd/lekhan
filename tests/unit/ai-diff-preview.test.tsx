import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, it, expect, vi } from 'vitest'
import AIDiffPreview from '@/components/ai-diff-preview'
import React from 'react'

vi.mock('sonner', () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
}))

describe('AIDiffPreview Component', () => {
	const mockEditor = {
		state: {
			doc: { textContent: 'Original sample text' },
			selection: { from: 1, to: 20 },
		},
		chain: () => ({
			focus: () => ({
				setTextSelection: () => ({
					insertContent: () => ({
						run: vi.fn(),
					}),
				}),
				insertContent: () => ({
					run: vi.fn(),
				}),
			}),
		}),
	}

	it('renders original text, result text and action buttons', () => {
		render(
			<AIDiffPreview
				editor={mockEditor as any}
				actionId="improve-flow"
				originalText="Original sample text"
				resultText="Rewritten clear sample text"
				position={{ x: 100, y: 300 }}
				onClose={vi.fn()}
			/>
		)

		expect(screen.getByText(/Rewrite/i)).toBeInTheDocument()
		expect(screen.getByText(/Original sample text/i)).toBeInTheDocument()
		expect(screen.getByText(/Rewritten clear sample text/i)).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /Accept/i })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: /Insert Below/i })).toBeInTheDocument()
	})

	it('calls onClose when close button is clicked', () => {
		const handleClose = vi.fn()
		render(
			<AIDiffPreview
				editor={mockEditor as any}
				actionId="summarize"
				originalText="Long paragraph text"
				resultText="Short summary"
				position={{ x: 150, y: 200 }}
				onClose={handleClose}
			/>
		)

		const closeBtn = screen.getByRole('button', { name: /close/i })
		fireEvent.click(closeBtn)
		expect(handleClose).toHaveBeenCalled()
	})
})
