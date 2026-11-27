'use client'

import { useState, type ReactNode } from 'react'
import { Moon, Sun } from 'lucide-react'
import { IconButton } from '@astryxdesign/core/IconButton'
import { useTranslations } from '@/lib/i18n/client'

export default function PublicReadingLayout({ children }: { children: ReactNode }) {
  const t = useTranslations('public-page')
  const [theme, setTheme] = useState<'light' | 'dark' | undefined>()

  function toggleTheme() {
    const dark = theme === 'dark' || (!theme && matchMedia('(prefers-color-scheme: dark)').matches)
    setTheme(dark ? 'light' : 'dark')
  }

  return (
    <main className="public-reading" data-reading-theme={theme}>
      <div className="public-reading-inner">
        <IconButton
          type="button"
          variant="ghost"
          size="sm"
          className="public-theme"
          label={t('theme')}
          tooltip={t('theme')}
          aria-pressed={theme === undefined ? undefined : theme === 'dark'}
          onClick={toggleTheme}
          icon={
            <>
              <Moon className="public-theme-moon" size={19} aria-hidden="true" />
              <Sun className="public-theme-sun" size={19} aria-hidden="true" />
            </>
          }
        />
        {children}
      </div>
    </main>
  )
}
