import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { AIActionsMenu } from '../../components/editor/ai-actions-menu'

describe('AIActionsMenu', () => {
	const defaultProps = {
		isOpen: true,
		onAction: vi.fn(),
		onClose: vi.fn(),
		position: { top: 100, left: 200 }
	}

	it('renders correctly when open', () => {
		render(<AIActionsMenu {...defaultProps} />)
		expect(screen.getByText('Rewrite & Polish')).toBeInTheDocument()
		expect(screen.getByText('Summarize')).toBeInTheDocument()
		expect(screen.getByText('Translate')).toBeInTheDocument()
		expect(screen.getByText('Fix Grammar')).toBeInTheDocument()
		expect(screen.getByText('Continue Writing')).toBeInTheDocument()
	})

	it('does not render when closed', () => {
		render(<AIActionsMenu {...defaultProps} isOpen={false} />)
		expect(screen.queryByText('Rewrite & Polish')).not.toBeInTheDocument()
	})

	it('calls onAction when an action is clicked', () => {
		render(<AIActionsMenu {...defaultProps} />)
		fireEvent.click(screen.getByText('Rewrite & Polish'))
		expect(defaultProps.onAction).toHaveBeenCalledWith('rewrite')

		fireEvent.click(screen.getByText('Summarize'))
		expect(defaultProps.onAction).toHaveBeenCalledWith('summarize')
	})
})
