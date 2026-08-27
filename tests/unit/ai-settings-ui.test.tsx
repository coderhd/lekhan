import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AIProviderSettings } from '../../components/settings/ai-provider-settings'
import { getDefaultAIRegistryState } from '../../lib/ai/catalog'

// Mock the prober since we don't want to make real network requests in tests
jest.mock('../../lib/ai/prober', () => ({
	probeLocalRuntime: jest.fn().mockResolvedValue({
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
	it('renders the 3 tiers', () => {
		const registryState = getDefaultAIRegistryState()
		render(<AIProviderSettings registryState={registryState} onSaveRegistry={jest.fn()} />)
		
		expect(screen.getByText(/Tier 1: Local Offline Hub/i)).toBeInTheDocument()
		expect(screen.getByText(/Tier 2: Free On-Ramp/i)).toBeInTheDocument()
		expect(screen.getByText(/Tier 3: Cloud BYOK/i)).toBeInTheDocument()
	})

	it('renders the hardware status banner', () => {
		const registryState = getDefaultAIRegistryState()
		render(<AIProviderSettings registryState={registryState} onSaveRegistry={jest.fn()} />)
		
		expect(screen.getByText(/Hardware Status/i)).toBeInTheDocument()
	})

	it('renders API key inputs and test buttons in BYOK tier', () => {
		const registryState = getDefaultAIRegistryState()
		render(<AIProviderSettings registryState={registryState} onSaveRegistry={jest.fn()} />)
		
		// Find Tier 3 section (might require expanding if it's an accordion, assuming it's expanded by default for this test or we can expand it)
		// Assuming we can find 'OpenAI' and a password field
		const passwordInputs = screen.getAllByPlaceholderText(/API Key/i)
		expect(passwordInputs.length).toBeGreaterThan(0)
		
		const testButtons = screen.getAllByRole('button', { name: /Test Connection/i })
		expect(testButtons.length).toBeGreaterThan(0)
	})
})
