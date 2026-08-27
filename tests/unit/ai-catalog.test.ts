import { describe, it, expect } from 'vitest'
import { filterModels, getModelById, getDefaultAIRegistryState, DEFAULT_MODEL_CATALOG } from '../../lib/ai/catalog'
import { ModelCard } from '../../lib/ai/types'

describe('ai-catalog', () => {
	describe('filterModels', () => {
		it('should filter by costTier', () => {
			const freeModels = filterModels(DEFAULT_MODEL_CATALOG, { costTier: 'free' })
			expect(freeModels.every(m => m.costTier === 'free')).toBe(true)
			expect(freeModels.length).toBeGreaterThan(0)
		})

		it('should filter by category', () => {
			const reasoningModels = filterModels(DEFAULT_MODEL_CATALOG, { category: 'reasoning' })
			expect(reasoningModels.every(m => m.category === 'reasoning')).toBe(true)
		})

		it('should filter by provider', () => {
			const openaiModels = filterModels(DEFAULT_MODEL_CATALOG, { provider: 'openai' })
			expect(openaiModels.every(m => m.provider === 'openai')).toBe(true)
		})

		it('should filter by search query', () => {
			const results = filterModels(DEFAULT_MODEL_CATALOG, { searchQuery: 'gpt' })
			expect(results.every(m => m.name.toLowerCase().includes('gpt') || m.id.toLowerCase().includes('gpt'))).toBe(true)
		})
	})

	describe('getModelById', () => {
		it('should resolve presets from the default catalog', () => {
			const model = getModelById('gpt-5.6-luna')
			expect(model).toBeDefined()
			expect(model?.id).toBe('gpt-5.6-luna')
		})

		it('should resolve custom models if provided', () => {
			const customCatalog: ModelCard[] = [{
				id: 'custom-model',
				name: 'Custom',
				provider: 'custom',
				contextWindow: 4096,
				costTier: 'free',
				hardwareTier: 'light',
				speedTokPerSec: 10,
				category: 'general',
				description: 'A custom model'
			}]
			const model = getModelById('custom-model', customCatalog)
			expect(model).toBeDefined()
			expect(model?.id).toBe('custom-model')
		})

		it('should return undefined for unknown models', () => {
			const model = getModelById('unknown-model')
			expect(model).toBeUndefined()
		})
	})

	describe('getDefaultAIRegistryState', () => {
		it('should have correct default providers enabled', () => {
			const state = getDefaultAIRegistryState()
			expect(state.providers['openai']?.enabled).toBe(true)
			expect(state.providers['anthropic']?.enabled).toBe(true)
			expect(state.providers['custom']?.enabled).toBeUndefined()
		})
	})
})
