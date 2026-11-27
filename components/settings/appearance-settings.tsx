'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Banner } from '@astryxdesign/core/Banner'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Selector } from '@astryxdesign/core/Selector'
import { VStack } from '@astryxdesign/core/Stack'
import { useTranslations } from '@/lib/i18n/client'
import { editorFonts, editorPreferenceKey, editorSpacing, editorThemes, parseEditorPreferences, type EditorPreferences } from '@/lib/editor-preferences'

function snapshot() {
  try { return localStorage.getItem(editorPreferenceKey) } catch { return null }
}

function subscribe(change: () => void) {
  window.addEventListener(editorPreferenceKey, change)
  window.addEventListener('storage', change)
  return () => {
    window.removeEventListener(editorPreferenceKey, change)
    window.removeEventListener('storage', change)
  }
}

export function useEditorPreferences() {
  const serialized = useSyncExternalStore(subscribe, snapshot, () => null)
  return useMemo(() => parseEditorPreferences(serialized), [serialized])
}

export function EditorAppearance() {
  const { theme, font, spacing } = useEditorPreferences()
  useEffect(() => {
    const preference = window.matchMedia('(prefers-color-scheme: dark)')
    function apply() {
      const root = document.documentElement.dataset
      root.editorTheme = theme === 'system' ? preference.matches ? 'dark' : 'light' : theme
      root.editorFont = font
      root.editorSpacing = spacing
    }
    apply()
    preference.addEventListener('change', apply)
    return () => preference.removeEventListener('change', apply)
  }, [theme, font, spacing])
  return null
}

export function AppearanceSettings() {
  const t = useTranslations('settings')
  const value = useEditorPreferences()
  const [failed, setFailed] = useState(false)

  function change(next: Partial<EditorPreferences>) {
    try {
      localStorage.setItem(editorPreferenceKey, JSON.stringify({ ...parseEditorPreferences(snapshot()), ...next }))
      window.dispatchEvent(new Event(editorPreferenceKey))
      setFailed(false)
    } catch { setFailed(true) }
  }

  return (
    <VStack gap={3} className="settings-fields">
      <Selector
        label={t('theme')}
        value={value.theme}
        width="100%"
        options={editorThemes.map(theme => ({ value: theme, label: t('theme_' + theme) }))}
        onChange={next => change({ theme: next as EditorPreferences['theme'] })}
      />
      <Selector
        label={t('editorFont')}
        value={value.font}
        width="100%"
        options={editorFonts.map(font => ({ value: font, label: t('font_' + font) }))}
        onChange={next => change({ font: next as EditorPreferences['font'] })}
      />
      <Selector
        label={t('lineSpacing')}
        value={value.spacing}
        width="100%"
        options={editorSpacing.map(spacing => ({ value: spacing, label: t('spacing_' + spacing) }))}
        onChange={next => change({ spacing: next as EditorPreferences['spacing'] })}
      />
      <CheckboxInput
        label={t('spellcheck')}
        value={value.spellcheck}
        size="sm"
        onChange={checked => change({ spellcheck: checked })}
      />
      {failed && (
        <div role="alert">
          <Banner status="error" collapsible={false} title={t('appearanceSaveFailed')} />
        </div>
      )}
    </VStack>
  )
}
