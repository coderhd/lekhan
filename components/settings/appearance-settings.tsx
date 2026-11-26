'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
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

  return <div className="settings-fields">
    <label>{t('theme')}
      <select value={value.theme} onChange={event => change({ theme: event.target.value as EditorPreferences['theme'] })}>
        {editorThemes.map(theme => <option key={theme} value={theme}>{t('theme_' + theme)}</option>)}
      </select>
    </label>
    <label>{t('editorFont')}
      <select value={value.font} onChange={event => change({ font: event.target.value as EditorPreferences['font'] })}>
        {editorFonts.map(font => <option key={font} value={font}>{t('font_' + font)}</option>)}
      </select>
    </label>
    <label>{t('lineSpacing')}
      <select value={value.spacing} onChange={event => change({ spacing: event.target.value as EditorPreferences['spacing'] })}>
        {editorSpacing.map(spacing => <option key={spacing} value={spacing}>{t('spacing_' + spacing)}</option>)}
      </select>
    </label>
    <label className="settings-check"><input type="checkbox" checked={value.spellcheck}
      onChange={event => change({ spellcheck: event.target.checked })} /> {t('spellcheck')}</label>
    {failed && <p role="alert">{t('appearanceSaveFailed')}</p>}
  </div>
}
