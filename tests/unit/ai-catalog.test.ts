import { describe, expect, it } from 'vitest'
import { AI_REGISTRY, filterModels } from '../../lib/ai/model-catalog'
import { endpointFor, FREE_PRESETS, providerConnectionKind, type ProviderConfig } from '../../lib/ai/provider-registry'

describe('model catalog', () => {
  it('lists 20 or more unique, sourced presets that route to the correct connection form', () => {
    expect(AI_REGISTRY.models.length).toBeGreaterThanOrEqual(20)
    expect(new Set(AI_REGISTRY.models.map(({ provider, model }) => provider + '/' + model)).size).toBe(AI_REGISTRY.models.length)
    for (const model of AI_REGISTRY.models) {
      expect(new URL(model.sourceUrl).protocol).toBe('https:')
      expect(model.verifiedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(providerConnectionKind(model)).toBe(model.access === 'byok' ? 'cloud' : model.access)
    }
    expect(filterModels({ access: 'free' }).map(model => model.model)).toEqual(FREE_PRESETS.map(model => model.model))
  })

  it('combines search, hardware, locality, cost, and the published context limit', () => {
    expect(filterModels({ query: ' Ollama  llama ', locality: 'device', access: 'local', hardware: 'compact', minContextTokens: 128_000 })
      .map(model => model.model)).toEqual(['llama3.2:1b'])
    expect(filterModels({ access: 'free', minContextTokens: 1_000_000 }).map(model => model.provider)).toEqual(['gemini'])
    expect(filterModels({ access: 'local', locality: 'cloud' })).toEqual([])
    expect(filterModels({ locality: 'cloud', hardware: 'compact' })).toEqual([])
    expect(filterModels({ capability: 'indic' }).map(model => model.model)).toEqual(['sarvam-105b', 'sarvam-105b-conversations'])
    expect(filterModels({ query: 'mistral', access: 'free' })).toEqual([])
    expect(filterModels({ query: 'mistral', access: 'byok' }).map(model => model.model)).toEqual(['mistral-small-2603'])
  })
})

describe('cloud endpoint validation', () => {
  const qwen: ProviderConfig = { id: 'test', provider: 'qwen', model: 'qwen-flash' }

  it('accepts the default and a workspace-specific Model Studio endpoint', () => {
    expect(endpointFor(qwen)).toBe('https://dashscope-intl.aliyuncs.com/compatible-mode/v1')
    const base = 'https://ws-example.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'
    expect(endpointFor({ ...qwen, baseUrl: base + '/' })).toBe(base)
    expect(endpointFor({ ...qwen, provider: 'deepseek' })).toBe('https://api.deepseek.com')
  })

  it.each([
    'https://dashscope.aliyuncs.com.other.example/compatible-mode/v1',
    'https://extra.ws-example.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
    'https://-workspace.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
    'https://dashscope.aliyuncs.com:444/compatible-mode/v1',
    'http://localhost/compatible-mode/v1',
    'https://dashscope.aliyuncs.com/other',
    'https://dashscope.aliyuncs.com/compatible-mode/v1?token=secret',
  ])('rejects an unexpected Qwen endpoint %s', baseUrl => {
    expect(() => endpointFor({ ...qwen, baseUrl })).toThrow()
  })
})
