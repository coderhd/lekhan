import { describe, expect, it } from 'vitest'
import { usageTokenCount } from '../../lib/ai/editor-actions'

describe('model picker telemetry', () => {
  it('shows the provider total or sums separately reported input and output', () => {
    expect(usageTokenCount({ totalTokens: 32 })).toBe(32)
    expect(usageTokenCount({ inputTokens: 12, outputTokens: 8 })).toBe(20)
  })

  it('leaves token count unavailable when a provider sends only one count', () => {
    expect(usageTokenCount({ outputTokens: 15 })).toBeUndefined()
    expect(usageTokenCount()).toBeUndefined()
    expect(usageTokenCount({ inputTokens: 0, outputTokens: 0 })).toBe(0)
  })
})
