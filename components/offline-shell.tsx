'use client'

import { useEffect, useSyncExternalStore, type ReactNode } from 'react'
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'
import { localeCookie, localeDirection, resolveLocale, type Locale } from '@/lib/i18n/locales'

export type OfflineCatalogs = Partial<Record<Locale, AbstractIntlMessages>>

export function watchOfflineCookies(check: () => void) {
  const timer = setInterval(check, 1000)
  window.addEventListener('focus', check)
  window.addEventListener('pageshow', check)
  window.addEventListener(localeCookie, check)
  return () => {
    clearInterval(timer)
    window.removeEventListener('focus', check)
    window.removeEventListener('pageshow', check)
    window.removeEventListener(localeCookie, check)
  }
}

function browserLocale() {
  const prefix = localeCookie + '='
  const value = document.cookie.split(/;\s*/).find(entry => entry.startsWith(prefix))
  return resolveLocale(value?.slice(prefix.length))
}

export async function setOfflineLocale(locale: Locale) {
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = localeCookie + '=' + locale + '; Path=/; SameSite=Lax; Max-Age=31536000' + secure
  if (browserLocale() !== locale) throw new Error('Could not save the locale.')
  window.dispatchEvent(new Event(localeCookie))
}

export default function OfflineShell({ catalogs, children }: { catalogs: OfflineCatalogs; children: ReactNode }) {
  const locale = useSyncExternalStore(watchOfflineCookies, browserLocale, () => 'en' as const)
  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = localeDirection(locale)
  }, [locale])

  return <NextIntlClientProvider locale={locale} messages={catalogs[locale]} timeZone="UTC">
    {children}
  </NextIntlClientProvider>
}
