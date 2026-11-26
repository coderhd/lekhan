import { FREE_PRESETS, PROVIDERS } from './provider-registry'
import type { AIRegistryState, ModelCard, ModelFilters } from './types'

const checked = '2026-11-24'
const deepseek = { access: 'byok', provider: 'deepseek', sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing/' } as const
const qwen = { access: 'byok', provider: 'qwen', sourceUrl: 'https://www.alibabacloud.com/help/en/model-studio/text-generation-model' } as const
const sarvam = { access: 'byok', provider: 'sarvam', sourceUrl: 'https://docs.sarvam.ai/api/token-factory/models' } as const
const anthropic = { access: 'byok', provider: 'anthropic', sourceUrl: 'https://platform.claude.com/docs/en/models/overview' } as const
const ollama = { access: 'local', provider: 'ollama' } as const
const qwenLocal = { ...ollama, sourceUrl: 'https://ollama.com/library/qwen2.5' }
const llamaLocal = { ...ollama, sourceUrl: 'https://ollama.com/library/llama3.2' }
const gemmaLocal = { ...ollama, sourceUrl: 'https://ollama.com/library/gemma3' }
const writing = ['writing'] as const
const multilingual = ['writing', 'multilingual'] as const
const indic = ['writing', 'multilingual', 'indic'] as const

const verifiedModels: ModelCard[] = [
  { verifiedDate: checked, ...qwenLocal, model: 'qwen2.5:0.5b', label: 'Qwen 2.5 0.5B', contextTokens: 32_768, hardware: 'compact', capabilities: multilingual },
  { verifiedDate: checked, ...qwenLocal, model: 'qwen2.5:1.5b', label: 'Qwen 2.5 1.5B', contextTokens: 32_768, hardware: 'compact', capabilities: multilingual },
  { verifiedDate: checked, ...qwenLocal, model: 'qwen2.5:3b', label: 'Qwen 2.5 3B', contextTokens: 32_768, hardware: 'standard', capabilities: multilingual },
  { verifiedDate: checked, ...llamaLocal, model: 'llama3.2:1b', label: 'Llama 3.2 1B', contextTokens: 131_072, hardware: 'compact', capabilities: multilingual },
  { verifiedDate: checked, ...llamaLocal, model: 'llama3.2:3b', label: 'Llama 3.2 3B', contextTokens: 131_072, hardware: 'standard', capabilities: multilingual },
  { verifiedDate: checked, ...gemmaLocal, model: 'gemma3:1b', label: 'Gemma 3 1B', contextTokens: 32_768, hardware: 'compact', capabilities: multilingual },
  { verifiedDate: checked, ...gemmaLocal, model: 'gemma3:4b', label: 'Gemma 3 4B', contextTokens: 131_072, hardware: 'standard', capabilities: multilingual },
  { verifiedDate: checked, ...deepseek, model: 'deepseek-flash', label: 'DeepSeek Flash', contextTokens: 1_000_000, capabilities: writing },
  { verifiedDate: checked, ...deepseek, model: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', contextTokens: 1_000_000, capabilities: writing },
  { verifiedDate: checked, ...qwen, model: 'qwen-flash', label: 'Qwen Flash', contextTokens: 1_000_000, capabilities: multilingual },
  { verifiedDate: checked, ...qwen, model: 'qwen-plus', label: 'Qwen Plus', contextTokens: 1_000_000, capabilities: multilingual },
  { verifiedDate: checked, ...sarvam, model: 'sarvam-105b', label: 'Sarvam 105B', contextTokens: 128_000, capabilities: indic },
  { verifiedDate: checked, ...sarvam, model: 'sarvam-105b-conversations', label: 'Sarvam 105B Conversations', contextTokens: 32_000, capabilities: indic },
  { verifiedDate: checked, ...sarvam, model: 'glm5.3-flash', label: 'GLM 5.3 Flash', contextTokens: 1_048_576, capabilities: writing },
  { verifiedDate: checked, ...sarvam, model: 'gemma4', label: 'Gemma 4', contextTokens: 262_144, capabilities: multilingual },
  { verifiedDate: checked, ...anthropic, model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', contextTokens: 1_000_000, capabilities: multilingual },
  { verifiedDate: checked, ...anthropic, model: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', contextTokens: 1_000_000, capabilities: multilingual },
  { verifiedDate: checked, access: 'byok', provider: 'mistral', model: 'mistral-small-2603', label: 'Mistral Small 4', contextTokens: 256_000, capabilities: multilingual, sourceUrl: 'https://docs.mistral.ai/models/mistral-small-4-0-26-03' },
]

export const AI_REGISTRY: AIRegistryState = {
  models: [
    ...FREE_PRESETS.map(preset => ({ ...preset, access: 'free' as const, capabilities: writing })),
    ...verifiedModels,
  ],
}

export function filterModels(filters: ModelFilters): readonly ModelCard[] {
  const words = filters.query?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? []
  return AI_REGISTRY.models.filter(model => {
    const local = model.access === 'local'
    if (filters.access && model.access !== filters.access) return false
    if (filters.locality && local !== (filters.locality === 'device')) return false
    if (filters.hardware && model.hardware !== filters.hardware) return false
    if (filters.minContextTokens && (model.contextTokens ?? 0) < filters.minContextTokens) return false
    if (filters.capability && !model.capabilities.includes(filters.capability)) return false
    const searchable = `${model.label} ${model.model} ${PROVIDERS[model.provider].label}`.toLowerCase()
    return words.every(word => searchable.includes(word))
  })
}
