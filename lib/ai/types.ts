import { HardwareTier } from './hardware'

export type AIProviderType = 'ollama' | 'lmstudio' | 'openrouter' | 'gemini' | 'groq' | 'anthropic' | 'openai' | 'deepseek' | 'qwen' | 'zai' | 'sarvam' | 'custom'

export type CostTier = 'free' | 'paid' | 'local'

export type ModelCategory = 'general' | 'reasoning' | 'coding' | 'indic'

export interface ModelCard {
	id: string
	name: string
	provider: AIProviderType
	contextWindow: number
	costTier: CostTier
	hardwareTier: HardwareTier
	speedTokPerSec: number
	category: ModelCategory
	description: string
	pricing?: { inputPer1M: number; outputPer1M: number }
	deepLinkUrl?: string
	isPreset?: boolean
}

export interface AIProviderConfig {
	id: string
	provider: AIProviderType
	name: string
	enabled: boolean
	baseUrl?: string
	apiKey?: string
	defaultModel: string
	availableModels: string[]
	createdAt: string
	updatedAt: string
}

export interface AIRegistryState {
	activeProviderId: string
	activeModelId: string
	fallbackModelIds: string[]
	providers: Record<string, AIProviderConfig>
}
