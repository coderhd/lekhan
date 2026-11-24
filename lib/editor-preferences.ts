export const editorPreferenceKey = 'lekhan:editor-preferences'
export const editorThemes = ['light', 'dark', 'system'] as const
export const editorFonts = ['serif', 'sans', 'mono'] as const
export const editorSpacing = ['compact', 'normal', 'relaxed'] as const

export type EditorPreferences = {
  theme: typeof editorThemes[number]
  font: typeof editorFonts[number]
  spacing: typeof editorSpacing[number]
  spellcheck: boolean
}

export const defaultEditorPreferences: EditorPreferences = {
  theme: 'light', font: 'sans', spacing: 'normal', spellcheck: false,
}

export function parseEditorPreferences(serialized: string | null): EditorPreferences {
  try {
    const value = JSON.parse(serialized ?? 'null')
    if (!value || typeof value !== 'object') return defaultEditorPreferences
    return {
      theme: editorThemes.includes(value.theme) ? value.theme : defaultEditorPreferences.theme,
      font: editorFonts.includes(value.font) ? value.font : defaultEditorPreferences.font,
      spacing: editorSpacing.includes(value.spacing) ? value.spacing : defaultEditorPreferences.spacing,
      spellcheck: value.spellcheck === true,
    }
  } catch {
    return defaultEditorPreferences
  }
}
