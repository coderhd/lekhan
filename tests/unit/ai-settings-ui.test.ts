import { describe, expect, it } from 'vitest'
import { FREE_PRESETS, providerConnectionKind } from '../../lib/ai/provider-registry'

describe('settings provider groups', () => {
  it('opens configured on-device connections under their local providers', () => {
    for (const provider of ['ollama', 'lmstudio', 'llamacpp'] as const) {
      expect(providerConnectionKind({ provider, model: 'installed-model' })).toBe('local')
    }
  })

  it('recognizes only verified presets as free-key connections', () => {
    for (const preset of FREE_PRESETS) expect(providerConnectionKind(preset)).toBe('free')
    expect(providerConnectionKind({ provider: 'openrouter', model: 'another-model' })).toBe('cloud')
    expect(providerConnectionKind({ provider: 'openai', model: FREE_PRESETS[0].model })).toBe('cloud')
    expect(providerConnectionKind({ provider: 'custom', model: 'external-model' })).toBe('cloud')
  })
})
