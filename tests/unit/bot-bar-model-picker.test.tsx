import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { BotBarModelPicker } from '../../components/editor/bot-bar-model-picker'

describe('BotBarModelPicker', () => {
	const defaultProps = {
		activeModelId: 'gpt-4o',
		activeProvider: 'OpenAI',
		onSelectModel: vi.fn(),
		onOpenSettings: vi.fn(),
	}

	it('renders active model name and provider badge', () => {
		render(<BotBarModelPicker {...defaultProps} />)
		expect(screen.getByText(/gpt-4o/i)).toBeInTheDocument()
		expect(screen.getByText(/OpenAI/i)).toBeInTheDocument()
	})

	it('opens model popover on click and calls onSelectModel', () => {
		render(<BotBarModelPicker {...defaultProps} />)
		
		const trigger = screen.getByRole('button', { name: /model picker/i })
		fireEvent.click(trigger)

		expect(screen.getByText(/Free Presets/i)).toBeInTheDocument()
		
		const option = screen.getByText(/Claude 3.5 Sonnet/i)
		fireEvent.click(option)
		
		expect(defaultProps.onSelectModel).toHaveBeenCalledWith('claude-3-5-sonnet', 'Anthropic')
	})

	it('calls onOpenSettings when Configure Providers is clicked', () => {
		render(<BotBarModelPicker {...defaultProps} />)
		
		const trigger = screen.getByRole('button', { name: /model picker/i })
		fireEvent.click(trigger)

		const configureBtn = screen.getByText(/Configure Providers/i)
		fireEvent.click(configureBtn)
		
		expect(defaultProps.onOpenSettings).toHaveBeenCalled()
	})

	it('renders telemetry HUD when telemetry props are provided', () => {
		render(
			<BotBarModelPicker 
				{...defaultProps} 
				telemetry={{ totalTokens: 150, latencyMs: 1200, speedTokPerSec: 25 }} 
			/>
		)
		
		expect(screen.getByText(/150 tok/i)).toBeInTheDocument()
		expect(screen.getByText(/1200 ms/i)).toBeInTheDocument()
	})
})
