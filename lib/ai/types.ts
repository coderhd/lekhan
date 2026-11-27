import type { ProviderId } from './provider-registry'

export type AIProviderType = ProviderId
export type ModelAccess = 'free' | 'byok' | 'local'
export type ModelHardware = 'compact' | 'standard'
export type ModelCapability = 'writing' | 'multilingual' | 'indic'

interface ModelDetails {
  provider: AIProviderType
  model: string
  label: string
  contextTokens: number | null
  capabilities: readonly ModelCapability[]
  sourceUrl: string
  verifiedDate: string
}

export type ModelCard = ModelDetails & (
  | { access: 'local'; hardware: ModelHardware }
  | { access: 'free' | 'byok'; hardware?: never }
)

export interface AIRegistryState {
  models: readonly ModelCard[]
}

export interface ModelFilters {
  query?: string
  access?: ModelAccess
  locality?: 'device' | 'cloud'
  hardware?: ModelHardware
  minContextTokens?: number
  capability?: ModelCapability
}
