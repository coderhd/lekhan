'use client'

import { useState, type ReactNode } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTranslations } from '@/lib/i18n/client'

export default function PublicReadingLayout({ children }: { children: ReactNode }) {
  const t = useTranslations('public-page')
  const [theme, setTheme] = useState<'light' | 'dark' | undefined>()

  function toggleTheme() {
    const dark = theme === 'dark' || (!theme && matchMedia('(prefers-color-scheme: dark)').matches)
    const next = dark ? 'light' : 'dark'
    setTheme(next)
  }

  return <main className="public-reading" data-reading-theme={theme}>
    <div className="public-reading-inner">
      <button type="button" className="public-theme icon-button" onClick={toggleTheme}
        aria-label={t('theme')} aria-pressed={theme === undefined ? undefined : theme === 'dark'}>
        <Moon className="public-theme-moon" size={19} aria-hidden="true" />
        <Sun className="public-theme-sun" size={19} aria-hidden="true" />
      </button>
      {children}
    </div>
  </main>
}
