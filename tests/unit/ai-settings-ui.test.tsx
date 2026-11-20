import { describe, it, expect, vi } from 'vitest'
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AIProviderSettings } from '../../components/settings/ai-provider-settings'
import { providerRegistry } from '../../lib/ai/provider-registry'
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
	it('renders the unified provider and model sections', async () => {
		const registryState = getDefaultAIRegistryState()
		render(<AIProviderSettings registryState={registryState} onSaveRegistry={vi.fn()} />)
		
		await screen.findByText(/Hardware/i)
		expect(screen.getByText(/Providers & Keys/i)).toBeInTheDocument()
		expect(screen.getByText(/All models/i)).toBeInTheDocument()
		expect(screen.getAllByText(/Local models/i).length).toBeGreaterThan(0)
	})

	it('shows the active model name and a static selected state', async () => {
		const registryState = getDefaultAIRegistryState()
		const model = providerRegistry.catalog.find(model =>
			model.provider === registryState.activeProviderId && model.id === registryState.activeModelId
		)!
		render(<AIProviderSettings registryState={registryState} />)
		await screen.findByText(/Hardware/i)
		expect(screen.getByRole('heading', { name: model.name })).toBeInTheDocument()
		expect(screen.getByText('Active', { exact: true })).toBeVisible()
		expect(screen.queryByRole('button', { name: 'Active' })).toBeNull()
	})

	it('renders the hardware status banner', async () => {
		const registryState = getDefaultAIRegistryState()
		render(<AIProviderSettings registryState={registryState} onSaveRegistry={vi.fn()} />)
		
		expect(await screen.findByText(/Hardware/i)).toBeInTheDocument()
	})

	it('renders API key inputs and test buttons in BYOK tier', async () => {
		const registryState = getDefaultAIRegistryState()
		render(<AIProviderSettings registryState={registryState} onSaveRegistry={vi.fn()} />)
		
		await screen.findByText(/Hardware/i)
		const passwordInputs = screen.getAllByPlaceholderText(/API Key/i)
		expect(passwordInputs).toHaveLength(1)
		fireEvent.change(screen.getByRole('combobox', { name: 'Provider' }), { target: { value: 'anthropic' } })
		expect(screen.getByLabelText('Anthropic API key')).toHaveAttribute('type', 'password')
		expect(screen.queryByLabelText('OpenAI API key')).toBeNull()
		
		const testButtons = screen.getAllByRole('button', { name: /^Test$/i })
		expect(testButtons.length).toBeGreaterThan(0)
	})
	it('tests and saves the selected provider key and persists a new model choice', async () => {
		const registryState = getDefaultAIRegistryState()
		const save = vi.fn().mockResolvedValue(undefined)
		const testConnection = vi.spyOn(providerRegistry, 'testConnection').mockResolvedValue({ success: true, latencyMs: 10 })
		try {
			render(<AIProviderSettings registryState={registryState} onSaveRegistry={save} />)
			await screen.findByText(/Hardware/i)
			fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'anthropic' } })
			fireEvent.change(screen.getByLabelText('Anthropic API key'), { target: { value: 'test-key' } })
			fireEvent.click(screen.getByRole('button', { name: 'Test' }))
			await waitFor(() => expect(testConnection).toHaveBeenCalledWith('anthropic', 'test-key', undefined))
			fireEvent.click(screen.getByRole('button', { name: 'Save' }))
			expect(save.mock.lastCall?.[0].providers.anthropic.apiKey).toBe('test-key')

			const model = providerRegistry.catalog.find(model => model.provider === 'anthropic')!
			fireEvent.change(screen.getByLabelText('Model'), { target: { value: `${model.provider}:${model.id}` } })
			fireEvent.click(screen.getByRole('button', { name: 'Use this model' }))
			expect(save).toHaveBeenLastCalledWith({ ...registryState, activeModelId: model.id, activeProviderId: model.provider })
		} finally {
			testConnection.mockRestore()
		}
	})

})
