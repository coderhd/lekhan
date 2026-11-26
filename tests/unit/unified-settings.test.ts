import { describe, expect, it } from 'vitest'
import { defaultEditorPreferences, parseEditorPreferences } from '../../lib/editor-preferences'

describe('editor appearance preferences', () => {
  it('keeps default appearance for a fresh device or unreadable storage', () => {
    expect(parseEditorPreferences(null)).toEqual(defaultEditorPreferences)
    expect(parseEditorPreferences('invalid JSON')).toEqual(defaultEditorPreferences)
  })

  it('round trips valid preferences and guards every value independently', () => {
    const settings = { theme: 'dark', font: 'mono', spacing: 'relaxed', spellcheck: true }
    expect(parseEditorPreferences(JSON.stringify(settings))).toEqual(settings)
    expect(parseEditorPreferences(JSON.stringify({ theme: 'unexpected', font: 'serif', spacing: 20, spellcheck: 'true' })))
      .toEqual({ ...defaultEditorPreferences, font: 'serif' })
  })
})
