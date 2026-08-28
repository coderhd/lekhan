import { describe, it, expect, vi } from 'vitest'
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { AIProviderSettings } from '../../components/settings/ai-provider-settings'
import { getDefaultAIRegistryState } from '../../lib/ai/catalog'

// Mock the prober since we don't want to make real network requests in tests
vi.mock('../../lib/ai/prober', () => ({
	probeLocalRuntime: vi.fn().mockResolvedValue({
		status: 'connected',
		runtime: 'ollama',
		port: 11434,
		baseUrl: 'http://127.0.0.1:11434',
		models: ['llama3', 'mistral'],
		latencyMs: 15,
		osCommand: { macos: '', linux: '', windows: '' }
	})
}))

describe('AIProviderSettings UI', () => {
	it('renders the unified provider and model sections', () => {
		const registryState = getDefaultAIRegistryState()
		render(<AIProviderSettings registryState={registryState} onSaveRegistry={vi.fn()} />)
		
		expect(screen.getByText(/Providers & Keys/i)).toBeInTheDocument()
		expect(screen.getByText(/All models/i)).toBeInTheDocument()
		expect(screen.getAllByText(/Local models/i).length).toBeGreaterThan(0)
	})

	it('renders the hardware status banner', async () => {
		const registryState = getDefaultAIRegistryState()
		render(<AIProviderSettings registryState={registryState} onSaveRegistry={vi.fn()} />)
		
		expect(await screen.findByText(/Hardware/i)).toBeInTheDocument()
	})

	it('renders API key inputs and test buttons in BYOK tier', () => {
		const registryState = getDefaultAIRegistryState()
		render(<AIProviderSettings registryState={registryState} onSaveRegistry={vi.fn()} />)
		
		const passwordInputs = screen.getAllByPlaceholderText(/API Key/i)
		expect(passwordInputs.length).toBeGreaterThan(0)
		
		const testButtons = screen.getAllByRole('button', { name: /^Test$/i })
		expect(testButtons.length).toBeGreaterThan(0)
	})
})
