'use client'

import { Languages } from 'lucide-react'
import { useState, useTransition } from 'react'
import { useLocale, useTranslations } from '@/lib/i18n/client'
import { localeNames, locales, resolveLocale, type Locale } from '@/lib/i18n/locales'

export default function LocaleSelect({ onSelect }: { onSelect: (locale: Locale) => Promise<void> }) {
  const t = useTranslations('settings')
  const locale = useLocale()
  const [pending, startTransition] = useTransition()
  const [failure, setFailure] = useState(false)
  return (
    <div>
      <label className="locale-switcher">
        <Languages size={15} aria-hidden="true" />
        <select aria-label={t('language')} value={locale} disabled={pending} onChange={event => {
          const selected = resolveLocale(event.target.value)
          setFailure(false)
          startTransition(async () => {
            try {
              await onSelect(selected)
            } catch {
              setFailure(true)
            }
          })
        }}>
          {locales.map(language => <option key={language} value={language} lang={language}>{localeNames[language]}</option>)}
        </select>
      </label>
      {failure && <p className="locale-error" role="alert">{t('switchFailed')}</p>}
    </div>
  )
}
