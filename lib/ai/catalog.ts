import { ModelCard, AIProviderType, CostTier, ModelCategory, AIRegistryState } from './types'
import { HardwareTier } from './hardware'

export const DEFAULT_MODEL_CATALOG: ModelCard[] = [
	{
		id: 'gemini-3.7-flash',
		name: 'Gemini 3.7 Flash',
		provider: 'gemini',
		contextWindow: 1000000,
		costTier: 'free',
		hardwareTier: 'light',
		speedTokPerSec: 150,
		category: 'general',
		description: 'Google, 1M context, free, light, 150 tok/s, general',
		isPreset: true
	},
	{
		id: 'llama-4-maverick',
		name: 'Llama 4 Maverick',
		provider: 'groq',
		contextWindow: 128000,
		costTier: 'free',
		hardwareTier: 'light',
		speedTokPerSec: 300,
		category: 'general',
		description: 'Groq, 128k context, free, light, 300 tok/s, general',
		isPreset: true
	},
	{
		id: 'deepseek-v4-flash',
		name: 'DeepSeek V4 Flash',
		provider: 'openrouter',
		contextWindow: 1000000,
		costTier: 'free',
		hardwareTier: 'light',
		speedTokPerSec: 90,
		category: 'general',
		description: 'OpenRouter, 1M context, free, light, 90 tok/s, general',
		isPreset: true
	},
	{
		id: 'glm-5.3-flash',
		name: 'GLM 5.3 Flash',
		provider: 'zai',
		contextWindow: 128000,
		costTier: 'free',
		hardwareTier: 'light',
		speedTokPerSec: 110,
		category: 'general',
		description: 'Z.AI, 128k context, free, light, 110 tok/s, general',
		isPreset: true
	},
	{
		id: 'llama-4-scout',
		name: 'Llama 4 Scout',
		provider: 'ollama',
		contextWindow: 128000,
		costTier: 'local',
		hardwareTier: 'medium',
		speedTokPerSec: 45,
		category: 'general',
		description: 'Ollama, 128k context, local, medium, 45 tok/s, general',
		isPreset: true
	},
	{
		id: 'qwen3.8-27b',
		name: 'Qwen 3.8 27B',
		provider: 'ollama',
		contextWindow: 64000,
		costTier: 'local',
		hardwareTier: 'heavy',
		speedTokPerSec: 30,
		category: 'coding',
		description: 'Ollama, 64k context, local, heavy, 30 tok/s, coding',
		isPreset: true
	},
	{
		id: 'ministral-3-14b',
		name: 'Ministral 3 14B',
		provider: 'ollama',
		contextWindow: 64000,
		costTier: 'local',
		hardwareTier: 'medium',
		speedTokPerSec: 40,
		category: 'reasoning',
		description: 'Ollama, 64k context, local, medium, 40 tok/s, reasoning',
		isPreset: true
	},
	{
		id: 'llama3.2:3b',
		name: 'Llama 3.2 3B',
		provider: 'ollama',
		contextWindow: 128000,
		costTier: 'local',
		hardwareTier: 'light',
		speedTokPerSec: 80,
		category: 'general',
		description: 'Ollama, 128k context, local, light, 80 tok/s, general',
		isPreset: true
	},
	{
		id: 'gpt-5.6-sol',
		name: 'GPT 5.6 Sol',
		provider: 'openai',
		contextWindow: 1050000,
		costTier: 'paid',
		hardwareTier: 'light',
		speedTokPerSec: 85,
		category: 'reasoning',
		description: 'OpenAI, 1.05M context, paid, light, 85 tok/s, reasoning',
		pricing: { inputPer1M: 3.0, outputPer1M: 15.0 },
		isPreset: true
	},
	{
		id: 'gpt-5.6-terra',
		name: 'GPT 5.6 Terra',
		provider: 'openai',
		contextWindow: 1050000,
		costTier: 'paid',
		hardwareTier: 'light',
		speedTokPerSec: 120,
		category: 'general',
		description: 'OpenAI, 1.05M context, paid, light, 120 tok/s, general',
		pricing: { inputPer1M: 1.0, outputPer1M: 5.0 },
		isPreset: true
	},
	{
		id: 'gpt-5.6-luna',
		name: 'GPT 5.6 Luna',
		provider: 'openai',
		contextWindow: 1050000,
		costTier: 'paid',
		hardwareTier: 'light',
		speedTokPerSec: 160,
		category: 'general',
		description: 'OpenAI, 1.05M context, paid, light, 160 tok/s, general',
		pricing: { inputPer1M: 0.25, outputPer1M: 1.0 },
		isPreset: true
	},
	{
		id: 'claude-opus-5',
		name: 'Claude Opus 5',
		provider: 'anthropic',
		contextWindow: 1000000,
		costTier: 'paid',
		hardwareTier: 'light',
		speedTokPerSec: 75,
		category: 'reasoning',
		description: 'Anthropic, 1M context, paid, light, 75 tok/s, reasoning',
		pricing: { inputPer1M: 5.0, outputPer1M: 25.0 },
		isPreset: true
	},
	{
		id: 'claude-sonnet-5',
		name: 'Claude Sonnet 5',
		provider: 'anthropic',
		contextWindow: 200000,
		costTier: 'paid',
		hardwareTier: 'light',
		speedTokPerSec: 100,
		category: 'general',
		description: 'Anthropic, 200k context, paid, light, 100 tok/s, general',
		pricing: { inputPer1M: 2.0, outputPer1M: 10.0 },
		isPreset: true
	},
	{
		id: 'claude-haiku-4-5-20251001',
		name: 'Claude Haiku 4.5',
		provider: 'anthropic',
		contextWindow: 200000,
		costTier: 'paid',
		hardwareTier: 'light',
		speedTokPerSec: 180,
		category: 'general',
		description: 'Anthropic, 200k context, paid, light, 180 tok/s, general',
		pricing: { inputPer1M: 0.5, outputPer1M: 2.5 },
		isPreset: true
	},
	{
		id: 'gemini-3.1-pro-preview',
		name: 'Gemini 3.1 Pro Preview',
		provider: 'gemini',
		contextWindow: 2000000,
		costTier: 'paid',
		hardwareTier: 'light',
		speedTokPerSec: 90,
		category: 'reasoning',
		description: 'Google, 2M context, paid, light, 90 tok/s, reasoning',
		pricing: { inputPer1M: 2.0, outputPer1M: 8.0 },
		isPreset: true
	},
	{
		id: 'deepseek-v4-pro',
		name: 'DeepSeek V4 Pro',
		provider: 'deepseek',
		contextWindow: 1000000,
		costTier: 'paid',
		hardwareTier: 'light',
		speedTokPerSec: 80,
		category: 'reasoning',
		description: 'DeepSeek, 1M context, paid, light, 80 tok/s, reasoning',
		pricing: { inputPer1M: 1.5, outputPer1M: 6.0 },
		isPreset: true
	},
	{
		id: 'qwen3.8-max',
		name: 'Qwen 3.8 Max',
		provider: 'qwen',
		contextWindow: 128000,
		costTier: 'paid',
		hardwareTier: 'light',
		speedTokPerSec: 95,
		category: 'general',
		description: 'Qwen, 128k context, paid, light, 95 tok/s, general',
		pricing: { inputPer1M: 1.8, outputPer1M: 7.2 },
		isPreset: true
	},
	{
		id: 'glm-5.3',
		name: 'GLM 5.3',
		provider: 'zai',
		contextWindow: 128000,
		costTier: 'paid',
		hardwareTier: 'light',
		speedTokPerSec: 100,
		category: 'coding',
		description: 'Z.AI, 128k context, paid, light, 100 tok/s, coding',
		pricing: { inputPer1M: 2.0, outputPer1M: 8.0 },
		isPreset: true
	},
	{
		id: 'sarvam-2b',
		name: 'Sarvam 2B',
		provider: 'sarvam',
		contextWindow: 8000,
		costTier: 'paid',
		hardwareTier: 'light',
		speedTokPerSec: 120,
		category: 'indic',
		description: 'Sarvam, 8k context, paid, light, 120 tok/s, indic',
		pricing: { inputPer1M: 0.1, outputPer1M: 0.4 },
		isPreset: true
	},
	{
		id: 'sarvam-translate',
		name: 'Sarvam Translate',
		provider: 'sarvam',
		contextWindow: 8000,
		costTier: 'paid',
		hardwareTier: 'light',
		speedTokPerSec: 130,
		category: 'indic',
		description: 'Sarvam, 8k context, paid, light, 130 tok/s, indic',
		pricing: { inputPer1M: 0.15, outputPer1M: 0.6 },
		isPreset: true
	}
]

export function filterModels(
	catalog: ModelCard[],
	filters: {
		costTier?: CostTier
		hardwareTier?: HardwareTier
		category?: ModelCategory
		provider?: AIProviderType
		searchQuery?: string
	}
): ModelCard[] {
	return catalog.filter(model => {
		if (filters.costTier && model.costTier !== filters.costTier) return false
		if (filters.hardwareTier && model.hardwareTier !== filters.hardwareTier) return false
		if (filters.category && model.category !== filters.category) return false
		if (filters.provider && model.provider !== filters.provider) return false
		if (filters.searchQuery) {
			const query = filters.searchQuery.toLowerCase()
			const matchesName = model.name.toLowerCase().includes(query)
			const matchesId = model.id.toLowerCase().includes(query)
			const matchesDescription = model.description.toLowerCase().includes(query)
			if (!matchesName && !matchesId && !matchesDescription) return false
		}
		return true
	})
}

export function getModelById(modelId: string, customCatalog?: ModelCard[]): ModelCard | undefined {
	const allModels = customCatalog ? [...DEFAULT_MODEL_CATALOG, ...customCatalog] : DEFAULT_MODEL_CATALOG
	return allModels.find(m => m.id === modelId)
}

export function getDefaultAIRegistryState(): AIRegistryState {
	const defaultProviders: AIProviderType[] = [
		'openrouter',
		'gemini',
		'groq',
		'ollama',
		'openai',
		'anthropic',
		'deepseek',
		'sarvam'
	]

	const providers: Record<string, any> = {}

	defaultProviders.forEach(p => {
		providers[p] = {
			id: p,
			provider: p,
			name: p.charAt(0).toUpperCase() + p.slice(1),
			enabled: true,
			defaultModel: '',
			availableModels: [],
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		}
	})

	return {
		activeProviderId: 'openai',
		activeModelId: 'gpt-5.6-luna',
		fallbackModelIds: [],
		providers
	}
}
